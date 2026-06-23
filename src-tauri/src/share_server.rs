//! "快传" 内嵌 HTTP server。
//!
//! 启动时随机监听一个空闲端口、生成 256-bit token、起一个 tiny_http
//! 实例在独立线程跑。每收到一个匹配 token 的 GET 请求：
//! 1. 检查路径前缀是 `/w/<token>`；
//! 2. 检查 Host header 命中本机 IP（防 DNS rebinding）；
//! 3. 阻塞 8KB 块流式读取视频文件 → HTTP 200 + Content-Disposition: attachment；
//! 4. 通过 Tauri 事件 `wui://share_downloaded` 通知前端。
//!
//! **3 分钟无活动**自动关闭（清掉 last_request 计时）。
//!
//! 启动/停止通过 Tauri state 持有（`ShareServerHandle`），命令通过
//! `app.state::<ShareServerState>()` 拿。

use std::fs::File;
use std::net::Ipv4Addr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use base64::Engine;
use rand::RngCore;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::lan_ip;

/// 启动 server 后返回给前端的"拨号盘"信息。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareServerInfo {
    pub port: u16,
    pub token: String,
    pub url: String,
    pub lan_ip: String,
    /// QR 内容（直接是 URL，手机扫码即用）。前端不用自己再生成。
    pub qr_svg: String,
    pub video_name: String,
    pub video_size: u64,
    /// Unix epoch 秒。给前端用作倒计时的起点；Rust 端 3 分钟空闲
    /// 超时基于 `last_request` 而非这个时间。
    pub started_at_unix: u64,
}

/// 启动失败 / 停止原因。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareServerStatus {
    pub running: bool,
    pub info: Option<ShareServerInfo>,
    pub download_count: u64,
    pub last_error: Option<String>,
}

/// 内部状态：要么有 server 句柄，要么有错误。
struct Inner {
    info: ShareServerInfo,
    /// 关闭信号
    stop_tx: Sender<()>,
    /// 下载计数器
    downloads: Arc<AtomicU64>,
    /// 最近一次请求时间（用于空闲超时）
    /// 由 spawn 出去的 server 线程读 / 写；这里仅持有所有权。
    #[allow(dead_code)]
    last_request: Arc<Mutex<Instant>>,
}

pub struct ShareServerState {
    inner: Mutex<Option<Inner>>,
    /// 空闲超时
    idle_timeout: Duration,
}

impl ShareServerState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
            idle_timeout: Duration::from_secs(3 * 60), // 3 分钟
        }
    }
}

impl Default for ShareServerState {
    fn default() -> Self {
        Self::new()
    }
}

/// 找一个空闲端口。
fn pick_free_port() -> Result<u16, String> {
    use std::net::TcpListener;
    let listener = TcpListener::bind("0.0.0.0:0")
        .map_err(|e| format!("bind 0.0.0.0:0: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("local_addr: {e}"))?
        .port();
    drop(listener);
    Ok(port)
}

/// 生成 256-bit base64url token（URL 安全，43 字符）。
fn make_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// 生成圆点 QR SVG 字符串（v0.14 API）。错误返回空字符串让前端兜底。
///
/// **圆点风格**：qrcode 0.14 默认用 `<rect>` 画每个 module，看起来像工业
/// 二维码。手动遍历 QrCode 矩阵 + 用 `<circle r=0.5>` 画每个 dark module，
/// 立刻有"产品感"——圆点之间的留白比方块呼吸感强得多。Rust 端直接输出
/// 圆点 SVG，前端不用 post-process。
///
/// **容错 + 静默区**：`EcLevel::H` (30% 容错) + 4-module 静默区。
/// iPhone / Android 原生扫码在镜头抖动 / 屏幕划痕 / 偏光贴膜等场景下
/// 都能可靠识别。
fn make_qr_svg(content: &str) -> String {
    use qrcode::EcLevel;
    use qrcode::QrCode;

    let code = match QrCode::with_error_correction_level(content, EcLevel::H) {
        Ok(c) => c,
        Err(_) => match QrCode::new(content) {
            Ok(c) => c,
            Err(_) => return String::new(),
        },
    };

    let width = code.width() as i32; // module 数（不含静默区）
    let quiet: i32 = 4; // 标准 4-module 静默区
    let total = width + quiet * 2; // 完整 viewBox 边长

    let mut svg = String::with_capacity((width * width * 32) as usize);
    svg.push_str(&format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" version=\"1.1\" \
         viewBox=\"0 0 {total} {total}\" width=\"280\" height=\"280\" \
         shape-rendering=\"geometricPrecision\">"
    ));
    // 白色背景
    svg.push_str(&format!(
        "<rect width=\"{total}\" height=\"{total}\" fill=\"#fff\"/>"
    ));

    // 画每个 dark module 为圆点（r=0.45，半径 0.45 留 0.05 间隙 — 视觉上
    // 是"圆点"而不是"圆盘"）。色值用主题主色 —— 前端用 --accent 覆盖。
    // Rust 端给一个 fallback hex，前端 inject 真实颜色。
    let module_color = "#d23a3a"; // 与前端 var(--accent, #d04040) 同步
    let radius = 0.45_f64;
    for y in 0..width {
        for x in 0..width {
            if code[(x as usize, y as usize)] == qrcode::Color::Dark {
                let cx = (x + quiet) as f64 + 0.5;
                let cy = (y + quiet) as f64 + 0.5;
                svg.push_str(&format!(
                    "<circle cx=\"{:.2}\" cy=\"{:.2}\" r=\"{:.2}\" fill=\"{}\"/>",
                    cx, cy, radius, module_color
                ));
            }
        }
    }
    svg.push_str("</svg>");
    svg
}

/// 启动 server。结果返回 `ShareServerInfo` 给前端展示。
pub fn start_server(
    app: &AppHandle,
    state: &ShareServerState,
    video_path: PathBuf,
) -> Result<ShareServerInfo, String> {
    crate::app_log::write(
        crate::app_log::LogLevel::Info,
        "share",
        format!("start requested: path={}", video_path.display()),
    );
    // 如果已经有 server 在跑，先停掉旧的（防止双 server 冲突）
    {
        let mut guard = state.inner.lock().map_err(|e| format!("lock: {e}"))?;
        if let Some(old) = guard.take() {
            crate::app_log::write(
                crate::app_log::LogLevel::Info,
                "share",
                "replacing existing server",
            );
            let _ = old.stop_tx.send(());
        }
    }

    if !video_path.exists() {
        crate::app_log::write(
            crate::app_log::LogLevel::Error,
            "share",
            format!("source missing: {}", video_path.display()),
        );
        return Err(format!("源文件丢失: {}", video_path.display()));
    }
    let video_size = std::fs::metadata(&video_path)
        .map_err(|e| format!("stat video: {e}"))?
        .len();
    let video_name = video_path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("video.mp4")
        .to_string();

    let port = pick_free_port().map_err(|e| {
        crate::app_log::write(crate::app_log::LogLevel::Error, "share", format!("port pick: {e}"));
        e
    })?;
    let token = make_token();
    let lan_ip = lan_ip::detect_lan_ipv4().unwrap_or_else(|| "127.0.0.1".to_string());
    let url = format!("http://{}:{}/w/{}", lan_ip, port, token);

    let qr_svg = make_qr_svg(&url);
    crate::app_log::write(
        crate::app_log::LogLevel::Info,
        "share",
        format!("listening on {lan_ip}:{port} size={video_size} name={video_name}"),
    );

    // 起一个独立线程跑 server；通过 channel 控制停止
    let (stop_tx, stop_rx) = channel::<()>();
    let downloads = Arc::new(AtomicU64::new(0));
    let last_request = Arc::new(Mutex::new(Instant::now()));
    let idle_timeout = state.idle_timeout;

    let app_for_thread = app.clone();
    let path_for_thread = video_path.clone();
    let token_for_thread = token.clone();
    let name_for_thread = video_name.clone();
    let downloads_for_thread = downloads.clone();
    let last_request_for_thread = last_request.clone();

    // 闭包里用 clone 拿一份 Sender —— 原始 stop_tx 还要存到 Inner
    // 里给 stop_server() 用（用户在 GUI 上点"停止"时用）。
    let stop_tx_for_thread = stop_tx.clone();
    thread::Builder::new()
        .name("wui-share-server".into())
        .spawn(move || {
            if let Err(e) = run_server(
                port,
                &path_for_thread,
                &token_for_thread,
                &name_for_thread,
                &app_for_thread,
                stop_tx_for_thread, // Sender：handle_request 首次下载完用它发停机信号
                stop_rx,           // Receiver：主循环用它等用户主动关
                downloads_for_thread,
                last_request_for_thread,
                idle_timeout,
            ) {
                crate::app_log::write(
                    crate::app_log::LogLevel::Error,
                    "share",
                    format!("server thread exited with error: {e}"),
                );
                let _ = app_for_thread.emit(
                    "wui://share_server_stopped",
                    serde_json::json!({ "reason": "error", "message": e }),
                );
            } else {
                crate::app_log::write(
                    crate::app_log::LogLevel::Info,
                    "share",
                    "server thread exited normally",
                );
                let _ = app_for_thread.emit(
                    "wui://share_server_stopped",
                    serde_json::json!({ "reason": "stopped" }),
                );
            }
        })
        .map_err(|e| {
            crate::app_log::write(
                crate::app_log::LogLevel::Error,
                "share",
                format!("spawn server thread: {e}"),
            );
            format!("spawn server thread: {e}")
        })?;
    let info = ShareServerInfo {
        port,
        token,
        url,
        lan_ip,
        qr_svg,
        video_name,
        video_size,
        started_at_unix: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
    };
    let mut guard = state.inner.lock().map_err(|e| format!("lock: {e}"))?;
    *guard = Some(Inner {
        info: info.clone(),
        stop_tx,
        downloads,
        last_request,
    });
    Ok(info)
}

fn run_server(
    port: u16,
    video_path: &PathBuf,
    token: &str,
    video_name: &str,
    app: &AppHandle,
    stop_tx: Sender<()>,
    stop_rx: std::sync::mpsc::Receiver<()>,
    downloads: Arc<AtomicU64>,
    last_request: Arc<Mutex<Instant>>,
    idle_timeout: Duration,
) -> Result<(), String> {
    let server = tiny_http::Server::http(("0.0.0.0", port))
        .map_err(|e| format!("bind 0.0.0.0:{port}: {e}"))?;

    // 鉴权辅助：检查 Host header 是不是本机
    let lan_ip_v4: Option<Ipv4Addr> = lan_ip::detect_lan_ipv4()
        .and_then(|s| s.parse().ok());

    // 期望的 path 前缀
    let expected_prefix = format!("/w/{token}");

    // tiny_http 0.12 的 Server 阻塞在 recv() 上，且没有 try_recv(timeout)。
    // 把 recv 放到一个独立线程，主循环靠 stop_rx 的 try_recv
    // 1ms 轮询 + 空闲超时检查。请求通过 crossbeam-style 通道传过来。
    let (req_tx, req_rx) = channel::<tiny_http::Request>();
    let server_path = expected_prefix.clone();
    let server_lan_ip = lan_ip_v4;
    let server_app = app.clone();
    let server_downloads = downloads.clone();
    let server_last_request = last_request.clone();
    let server_video_path = video_path.clone();
    let server_video_name = video_name.to_string();

    let accept_thread = thread::Builder::new()
        .name("wui-share-accept".into())
        .spawn(move || {
            loop {
                let req = match server.recv() {
                    Ok(r) => r,
                    Err(_) => return,
                };
                if req_tx.send(req).is_err() {
                    return;
                }
            }
        })
        .map_err(|e| format!("spawn accept thread: {e}"))?;

    let server_stop_rx = stop_rx;

    loop {
        // 空闲超时检查
        {
            let last = *last_request.lock().map_err(|e| format!("lock: {e}"))?;
            if last.elapsed() > idle_timeout {
                crate::app_log::write(
                    crate::app_log::LogLevel::Info,
                    "share",
                    format!(
                        "idle timeout after {}s, shutting down",
                        last.elapsed().as_secs()
                    ),
                );
                break; // 优雅退出
            }
        }

        // 短轮询：看用户是否手动关
        match server_stop_rx.try_recv() {
            Ok(()) => break,
            Err(std::sync::mpsc::TryRecvError::Empty) => {}
            Err(std::sync::mpsc::TryRecvError::Disconnected) => break,
        }

        // 看 accept 线程是否送来新请求
        match req_rx.recv_timeout(Duration::from_millis(200)) {
            Ok(req) => {
                handle_request(
                    req,
                    &server_path,
                    server_lan_ip,
                    &server_video_path,
                    &server_video_name,
                    &server_app,
                    &server_downloads,
                    &server_last_request,
                );
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                continue;
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }

    // 让 accept 线程自然退出（recv 失败时它就 return）
    drop(req_rx);
    let _ = accept_thread.join();
    Ok(())
}

fn handle_request(
    req: tiny_http::Request,
    expected_prefix: &str,
    lan_ip_v4: Option<Ipv4Addr>,
    video_path: &PathBuf,
    video_name: &str,
    app: &AppHandle,
    downloads: &Arc<AtomicU64>,
    last_request: &Arc<Mutex<Instant>>,
) {
    // 更新 last_request
    {
        if let Ok(mut last) = last_request.lock() {
            *last = Instant::now();
        }
    }

    // 非 GET 方法 → 405
    if *req.method() != tiny_http::Method::Get {
        crate::app_log::write(
            crate::app_log::LogLevel::Warn,
            "share",
            format!("method not allowed: {} {}", req.method(), req.url()),
        );
        let _ = req.respond(
            tiny_http::Response::from_string("method not allowed")
                .with_status_code(405),
        );
        return;
    }

    // 路径检查
    if !req.url().starts_with(expected_prefix) {
        crate::app_log::write(
            crate::app_log::LogLevel::Warn,
            "share",
            format!("path mismatch: {}", req.url()),
        );
        let _ = req.respond(
            tiny_http::Response::from_string("not found")
                .with_status_code(404),
        );
        return;
    }

    // Host header 防 DNS rebinding
    let host_ok = req
        .headers()
        .iter()
        .find(|h| h.field.equiv("Host"))
        .map(|h| {
            let host = h.value.as_str().trim_start_matches("http://");
            let host = host.split(':').next().unwrap_or("");
            host == "localhost"
                || host == "127.0.0.1"
                || lan_ip_v4.map(|ip| host == ip.to_string()).unwrap_or(false)
        })
        .unwrap_or(false);
    if !host_ok {
        let host = req
            .headers()
            .iter()
            .find(|h| h.field.equiv("Host"))
            .map(|h| h.value.as_str().to_string())
            .unwrap_or_default();
        crate::app_log::write(
            crate::app_log::LogLevel::Warn,
            "share",
            format!("host rejected (possible DNS rebinding?): {host}"),
        );
        let _ = req.respond(
            tiny_http::Response::from_string("forbidden")
                .with_status_code(403),
        );
        return;
    }

    // 用 Response::from_file 直接 serve 文件（tiny_http 0.12 提供的
    // 最干净的"流式发送本地文件"路径，自己控制 Content-Type 头）。
    let file = match File::open(video_path) {
        Ok(f) => f,
        Err(e) => {
            let _ = req.respond(
                tiny_http::Response::from_string(format!("open file: {e}"))
                    .with_status_code(500),
            );
            return;
        }
    };
    let mime = guess_mime(video_name);
    let disposition = format!("attachment; filename=\"{}\"", video_name);

    let response = tiny_http::Response::from_file(file)
        .with_header(
            tiny_http::Header::from_bytes(
                &b"Content-Type"[..],
                mime.as_bytes(),
            )
            .expect("static header"),
        )
        .with_header(
            tiny_http::Header::from_bytes(
                &b"Content-Disposition"[..],
                disposition.as_bytes(),
            )
            .expect("static header"),
        );
    // **真正把文件流式发出去**。tiny_http 的 `respond()` 同步等文件
    // 读完 + 写到 socket 才返回。**只有成功返回才算"下载完成"**。
    // 微信场景里只 GET 不下载完 → respond 会因 BrokenPipe 提早返回
    // 错误，count 不会 +1，UI 保持"等待扫码"。这是有意的：
    // "下载完成"必须对应实际传输成功，不能是"URL 被打开过"。
    let size = std::fs::metadata(video_path).map(|m| m.len()).unwrap_or(0);
    crate::app_log::write(
        crate::app_log::LogLevel::Info,
        "share",
        format!("download started: {video_name} ({size} bytes)"),
    );
    let resp_result = req.respond(response);
    if let Err(e) = resp_result {
        crate::app_log::write(
            crate::app_log::LogLevel::Warn,
            "share",
            format!("download aborted mid-stream: {e}"),
        );
        return;
    }
    crate::app_log::write(
        crate::app_log::LogLevel::Info,
        "share",
        format!("download completed: {video_name} ({size} bytes)"),
    );

    // **下载完成 → 仅通知前端，server 生命周期由模态控制**
    // （用户关模态 → share.stop() 显式关 server；3 分钟空闲兜底
    // 在主循环里，防用户开模态后不关）。
    let count = downloads.fetch_add(1, Ordering::SeqCst) + 1;
    let _ = app.emit(
        "wui://share_downloaded",
        serde_json::json!({
            "count": count,
            "filename": video_name,
            "sizeBytes": size,
        }),
    );
}

fn guess_mime(name: &str) -> &'static str {
    let lower = name.to_ascii_lowercase();
    if lower.ends_with(".mp4") { "video/mp4" }
    else if lower.ends_with(".webm") { "video/webm" }
    else if lower.ends_with(".mkv") { "video/x-matroska" }
    else { "application/octet-stream" }
}

pub fn stop_server(state: &ShareServerState) -> Result<(), String> {
    let mut guard = state.inner.lock().map_err(|e| format!("lock: {e}"))?;
    if let Some(inner) = guard.take() {
        let _ = inner.stop_tx.send(());
    }
    Ok(())
}

pub fn status(state: &ShareServerState) -> ShareServerStatus {
    let guard = match state.inner.lock() {
        Ok(g) => g,
        Err(_) => {
            return ShareServerStatus {
                running: false,
                info: None,
                download_count: 0,
                last_error: Some("state poisoned".into()),
            };
        }
    };
    match guard.as_ref() {
        Some(inner) => ShareServerStatus {
            running: true,
            info: Some(inner.info.clone()),
            download_count: inner.downloads.load(Ordering::SeqCst),
            last_error: None,
        },
        None => ShareServerStatus {
            running: false,
            info: None,
            download_count: 0,
            last_error: None,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn make_token_is_unique_and_url_safe() {
        let t1 = make_token();
        let t2 = make_token();
        assert_ne!(t1, t2, "token must be unique per call");
        // 32 bytes base64url-no-pad = 43 chars, no padding
        assert_eq!(t1.len(), 43);
        assert!(
            t1.chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'),
            "token must be base64url charset"
        );
    }

    #[test]
    fn make_qr_svg_returns_dotted_svg() {
        // Rust 端用 <circle> 画每个 dark module（圆点 QR），不用 rect。
        let svg = make_qr_svg("http://192.168.1.42:53124/w/abc123");
        assert!(svg.contains("<svg"), "got: {svg}");
        assert!(svg.contains("</svg>"));
        // 圆点风格：每 dark module 是 <circle cx=.. cy=.. r=0.45/>
        assert!(svg.contains("<circle"), "expected circle-based modules");
        // 包含白色背景 rect（让前端 QR 框有底色，iPhone 扫码可靠）
        assert!(svg.contains("fill=\"#fff\""), "expected white background");
        assert!(!svg.is_empty());
    }

    #[test]
    fn pick_free_port_returns_unused_port() {
        // 先占一个端口
        let listener = std::net::TcpListener::bind("0.0.0.0:0").unwrap();
        let taken = listener.local_addr().unwrap().port();
        // pick_free_port 应该拿一个不同的（系统会自动跳过已占的）
        let free = pick_free_port().unwrap();
        assert_ne!(free, taken, "expected different port");
        drop(listener);
    }

    #[test]
    fn guess_mime_for_video_files() {
        assert_eq!(guess_mime("highlight.mp4"), "video/mp4");
        assert_eq!(guess_mime("clip.WebM"), "video/webm");
        assert_eq!(guess_mime("recording.MKV"), "video/x-matroska");
        assert_eq!(guess_mime("unknown.xyz"), "application/octet-stream");
    }

    #[test]
    fn is_lan_ipv4_classifies_correctly() {
        use crate::lan_ip::is_lan_ipv4;
        // 私有网段
        assert!(is_lan_ipv4(&"10.0.0.1".parse().unwrap()));
        assert!(is_lan_ipv4(&"172.16.5.5".parse().unwrap()));
        assert!(is_lan_ipv4(&"172.31.255.254".parse().unwrap()));
        assert!(is_lan_ipv4(&"192.168.1.1".parse().unwrap()));
        // 非私有
        assert!(!is_lan_ipv4(&"127.0.0.1".parse().unwrap()));
        assert!(!is_lan_ipv4(&"8.8.8.8".parse().unwrap()));
        assert!(!is_lan_ipv4(&"172.32.0.1".parse().unwrap())); // 172.16/12 之外
    }
}
