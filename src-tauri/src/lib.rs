mod app_log;
mod frame_capture;
mod lan_ip;
mod library;
mod media_protocol;
mod os_shell;
mod parser;
mod share_server;

use std::collections::HashMap;
use std::path::PathBuf;

use library::sha256_hex;
use library::stats::LibraryStats;
use parser::model::{LoadResult, MatchRecord};
use tauri::Emitter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        // 注册"快传" server 状态。所有 share 相关命令通过
        // `app.state::<...>()` 访问 —— 这里 .manage() 必须在 build
        // 路径上（任何 .invoke_handler / .run 之前）先调一次，否则
        // 任何 Tauri command 一旦尝试 state::<ShareServerState>()
        // 就会 panic "state() called before manage()"。
        .manage(share_server::ShareServerState::new())
        .invoke_handler(tauri::generate_handler![
        scan_shell,
        scan_all,
        scrape_library,
        load_library,
        get_match_rounds,
        save_account_order,
        rename_account,
        play_video,
        cache_hero_image,
        cache_asset,
        cache_assets,
        reveal_in_explorer,
        get_log_status,
        reveal_logs_dir,
        get_library_stats,
        aclos_status,
        start_share_server,
        stop_share_server,
        share_server_status,
        log_event,
        capture_video_frame,
    ]);

    #[cfg(feature = "updater")]
    let app = app.plugin(tauri_plugin_updater::Builder::new().build());

    #[cfg(feature = "process")]
    let app = app.plugin(tauri_plugin_process::init());

    // Screenshot save: native Save As + write user-chosen path.
    let app = app
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init());

    // CORS + Range local media for in-app player (canvas-exportable screenshots).
    let app = app.register_asynchronous_uri_scheme_protocol(
        media_protocol::SCHEME,
        |_ctx, request, responder| {
            std::thread::spawn(move || {
                responder.respond(media_protocol::handle_request(request));
            });
        },
    );

    app_log::write(app_log::LogLevel::Info, "app", "WonderfulUI starting");

    app.run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn default_wonderful_dir() -> PathBuf {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_default();
    PathBuf::from(home)
        .join("AppData")
        .join("Roaming")
        .join("ACLOS")
        .join("WonderfulDb")
}

fn load_after_startup_scrape(
    conn: &rusqlite::Connection,
    base: &std::path::Path,
    app: Option<&tauri::AppHandle>,
) -> Result<LoadResult, String> {
    let dir = base.to_string_lossy().into_owned();
    match library::scraper::scrape_wonderful_dir_with_mode(
        conn,
        base,
        "startup",
        library::scraper::ScrapeMode::Incremental,
        app,
    ) {
        Ok(_) => {
            library::db::load_library_view(conn, dir).map_err(|e| format!("load library: {}", e))
        }
        Err(scrape_error) => {
            let view = library::db::load_library_view(conn, dir)
                .map_err(|e| format!("load library after scrape failure: {}", e))?;
            if view.accounts.is_empty() && view.matches.is_empty() {
                Err(scrape_error)
            } else {
                Ok(view)
            }
        }
    }
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanShellPayload {
    accounts: Vec<parser::model::Account>,
    dir: String,
    total_errors: usize,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AclosStatusPayload {
    /// The directory WonderfulUI is currently configured to read from. May
    /// be the platform default (`%USERPROFILE%\AppData\Roaming\ACLOS\WonderfulDb`)
    /// or a user-selected override (not yet exposed in the GUI).
    dir: String,
    /// True if `dir` exists on disk. The frontend uses this to decide
    /// whether to show the onboarding / first-run screen.
    dir_exists: bool,
    /// True if any account file (`<openid>`) is present in `dir`. `dir_exists`
    /// can be true while this is false if the directory is empty / newly
    /// created. Distinguishes "ACLOS never wrote here" from "directory
    /// missing entirely".
    has_accounts: bool,
}

/// Probe the ACLOS WonderfulDb directory so the GUI can detect first-run
/// state without running a full scan. Returns the path, whether it exists,
/// and whether it contains any account files. This is read-only: it does
/// not create, modify, or touch the directory in any way.
#[tauri::command]
fn aclos_status(dir: Option<String>) -> Result<AclosStatusPayload, String> {
    let base = match dir {
        Some(d) => PathBuf::from(d),
        None => default_wonderful_dir(),
    };
    let dir_str = base.to_string_lossy().into_owned();
    let dir_exists = base.is_dir();
    let has_accounts = if dir_exists {
        std::fs::read_dir(&base)
            .map(|rd| {
                rd.filter_map(Result::ok).any(|entry| {
                    let name = entry.file_name();
                    let name = name.to_string_lossy();
                    // ACLOS writes a single file per account named after the
                    // openid; any sibling file that is not a hidden / index /
                    // snapshot file is treated as an account shell.
                    !name.starts_with('.')
                        && !name.starts_with("snapshot")
                        && !name.eq_ignore_ascii_case("index")
                })
            })
            .unwrap_or(false)
    } else {
        false
    };
    Ok(AclosStatusPayload {
        dir: dir_str,
        dir_exists,
        has_accounts,
    })
}

/// Return existing library state immediately, then spawn a background
/// thread to refresh from WonderfulDb. The frontend receives the account
/// shell in the return value and streams per-account scrape results via
/// `wui://account_loaded` events. This keeps the UI responsive during
/// first launch.
#[tauri::command]
fn scan_shell(app: tauri::AppHandle, dir: Option<String>) -> Result<ScanShellPayload, String> {
    app_log::write(
        app_log::LogLevel::Info,
        "scan_shell",
        "loading library shell",
    );
    let base = match dir {
        Some(d) => PathBuf::from(d),
        None => default_wonderful_dir(),
    };
    let dir_str = base.to_string_lossy().into_owned();
    let conn = library::db::open_library().map_err(|e| format!("open library: {}", e))?;

    let _ = app.emit(
        "wui://phase",
        serde_json::json!({
            "phase": "opening",
            "label": "正在打开 WonderfulUI\u{2026}",
        }),
    );

    // Phase 1: return existing accounts immediately
    let view = library::db::load_library_view(&conn, dir_str.clone())
        .map_err(|e| format!("load library: {}", e))?;

    // Phase 2: scrape in background
    let app2 = app.clone();
    let base2 = base.clone();
    std::thread::spawn(move || {
        let conn = match library::db::open_library() {
            Ok(c) => c,
            Err(e) => {
                app_log::write(
                    app_log::LogLevel::Error,
                    "scan_shell",
                    format!("background open library failed: {}", e),
                );
                let _ = app2.emit(
                    "wui://phase",
                    serde_json::json!({
                        "phase": "error",
                        "label": "资料库打开失败",
                        "sub": e.to_string(),
                    }),
                );
                return;
            }
        };
        let _ = load_after_startup_scrape(&conn, &base2, Some(&app2));
    });

    Ok(ScanShellPayload {
        accounts: view.accounts,
        dir: dir_str,
        total_errors: view.total_errors,
    })
}

/// Refresh the local SQLite library from the configured WonderfulDb source,
/// then return the library view. WonderfulDb is only read by the source
/// adapter; this command no longer has a direct parser fallback.
#[tauri::command]
fn scan_all(app: tauri::AppHandle, dir: Option<String>) -> Result<LoadResult, String> {
    app_log::write(
        app_log::LogLevel::Info,
        "scan_all",
        "startup incremental scan requested",
    );
    let base = match dir {
        Some(d) => PathBuf::from(d),
        None => default_wonderful_dir(),
    };
    let conn = library::db::open_library()?;
    load_after_startup_scrape(&conn, &base, Some(&app))
}

#[tauri::command]
fn scrape_library(
    app: tauri::AppHandle,
    dir: Option<String>,
    trigger: Option<String>,
    mode: Option<String>,
) -> Result<LoadResult, String> {
    let mode_label = mode.as_deref().unwrap_or("incremental");
    app_log::write(
        app_log::LogLevel::Info,
        "scrape_library",
        format!("manual scrape requested mode={mode_label}"),
    );
    let base = match dir {
        Some(d) => PathBuf::from(d),
        None => default_wonderful_dir(),
    };
    let conn = library::db::open_library()?;
    library::scraper::scrape_wonderful_dir_with_mode(
        &conn,
        &base,
        trigger.as_deref().unwrap_or("manual"),
        library::scraper::ScrapeMode::from_arg(mode.as_deref()),
        Some(&app),
    )?;
    app_log::write(
        app_log::LogLevel::Info,
        "scrape_library",
        format!("manual scrape finished mode={mode_label}"),
    );
    library::db::load_library_view(&conn, base.to_string_lossy().into_owned())
        .map_err(|e| format!("load library: {}", e))
}

#[tauri::command]
fn load_library() -> Result<LoadResult, String> {
    app_log::write(
        app_log::LogLevel::Info,
        "load_library",
        "loading sqlite library view",
    );
    let conn = library::db::open_library()?;
    library::db::load_library_view(
        &conn,
        default_wonderful_dir().to_string_lossy().into_owned(),
    )
    .map_err(|e| format!("load library: {}", e))
}

/// Return the single match with full round / clip / event data from the
/// local SQLite library. The source adapter is responsible for refreshing
/// the library from WonderfulDb; this command does not directly read
/// WonderfulDb.
#[tauri::command]
fn get_match_rounds(openid: String, match_id: String) -> Result<MatchRecord, String> {
    app_log::write(
        app_log::LogLevel::Info,
        "get_match_rounds",
        format!("loading rounds match_id={match_id} openid={openid}"),
    );
    let conn = library::db::open_library()?;
    library::db::load_match_rounds(&conn, &openid, &match_id)
}

#[tauri::command]
fn save_account_order(openids: Vec<String>) -> Result<(), String> {
    let conn = library::db::open_library()?;
    library::db::save_account_order(&conn, &openids)
        .map_err(|e| format!("save account order: {}", e))
}

#[tauri::command]
fn rename_account(openid: String, custom_name: Option<String>) -> Result<(), String> {
    let conn = library::db::open_library()?;
    library::db::set_account_custom_name(&conn, &openid, custom_name.as_deref())
        .map_err(|e| format!("rename account: {}", e))
}

/// Open a local file with the OS-associated default app. **Fire-and-forget,
/// native Win32 path** — `ShellExecuteW` runs in-process (no `cmd.exe`,
/// no `start` builtin parsing, no `cmd /c` `""` placeholder). It is the
/// same API Explorer / the taskbar "Open" button use, so the call
/// returns in milliseconds after handing the file off to the shell.
#[tauri::command]
fn play_video(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(format!("源文件丢失: {}", path));
    }
    os_shell::shell_open(&path)
}

/// Open Explorer with the given file selected. Fire-and-forget: see
/// `play_video` for why `.status()` was the lag source. `explorer.exe` is a
/// real binary so we skip the `cmd /c` wrapper entirely.
#[tauri::command]
fn reveal_in_explorer(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(format!("文件不存在: {}", path));
    }
    std::process::Command::new("explorer")
        .arg(format!("/select,{}", p.display()))
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("spawn explorer: {}", e))?;
    // explorer.exe 在 /select 模式下会 fork 新进程后立即返回，
    // 退出码不可靠（spawn 成功 + 文件存在即视为成功）。
    Ok(())
}

#[tauri::command]
fn get_log_status() -> Result<app_log::LogStatus, String> {
    app_log::write(app_log::LogLevel::Info, "logs", "status requested");
    app_log::status()
}

#[tauri::command]
fn reveal_logs_dir() -> Result<(), String> {
    let dir = app_log::log_dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir {}: {}", dir.display(), e))?;
    app_log::write(app_log::LogLevel::Info, "logs", "opening log directory");
    std::process::Command::new("explorer")
        .arg(&dir)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("open logs dir {}: {}", dir.display(), e))?;
    Ok(())
}

#[tauri::command]
fn get_library_stats() -> Result<LibraryStats, String> {
    app_log::write(app_log::LogLevel::Info, "stats", "library stats requested");
    let conn = library::db::open_library()?;
    library::stats::compute(&conn)
}

fn assets_dir(kind: &str) -> Result<std::path::PathBuf, String> {
    let local = std::env::var("LOCALAPPDATA").map_err(|_| "LOCALAPPDATA not set".to_string())?;
    Ok(std::path::PathBuf::from(local)
        .join("wonderful-ui")
        .join("assets")
        .join(kind))
}

fn cache_asset_inner(kind: &str, url: &str) -> Result<(String, u64, bool), String> {
    let dir = assets_dir(kind)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir {}: {}", dir.display(), e))?;

    let hash = sha256_hex(url);
    let ext = std::path::Path::new(url)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("png");
    let cached = dir.join(format!("{hash}.{ext}"));

    if cached.exists() {
        if let Ok(conn) = library::db::open_library() {
            let _ = library::db::upsert_asset(&conn, kind, url, &cached.to_string_lossy(), &hash);
        }
        let size = std::fs::metadata(&cached).map(|m| m.len()).unwrap_or(0);
        return Ok((cached.to_string_lossy().into_owned(), size, true));
    }

    let resp = ureq::get(url)
        .call()
        .map_err(|e| format!("download {}: {}", url, e))?;
    let content_length: u64 = resp
        .header("Content-Length")
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let mut out =
        std::fs::File::create(&cached).map_err(|e| format!("create cache file: {}", e))?;
    let mut reader = resp.into_reader();
    std::io::copy(&mut reader, &mut out).map_err(|e| format!("write cache file: {}", e))?;

    let size = std::fs::metadata(&cached)
        .map(|m| m.len())
        .unwrap_or(content_length);

    if let Ok(conn) = library::db::open_library() {
        let _ = library::db::upsert_asset(&conn, kind, url, &cached.to_string_lossy(), &hash);
    }

    Ok((cached.to_string_lossy().into_owned(), size, false))
}

/// Download (or hit cache for) an agent head icon URL. Delegates to the
/// unified asset cache under kind `hero_image`. Returns the absolute local
/// path to the cached file.
#[tauri::command]
fn cache_hero_image(url: String) -> Result<String, String> {
    cache_asset_inner("hero_image", &url).map(|(p, _, _)| p)
}

/// Download (or hit cache for) a remote asset by kind and URL. Kind is
/// one of `hero_image`, `map_image`, `game_mode_icon`. Returns the
/// absolute local path to the cached file.
#[tauri::command]
fn cache_asset(kind: String, url: String) -> Result<String, String> {
    cache_asset_inner(&kind, &url).map(|(p, _, _)| p)
}

#[derive(serde::Serialize, serde::Deserialize)]
struct CacheEntry {
    kind: String,
    url: String,
}

/// Batch version of `cache_asset`. Returns a map of url → local_path for
/// every successful download. Failed entries are silently omitted —
/// callers already have graceful fallbacks.
#[derive(Clone, serde::Serialize)]
struct CacheAssetProgress {
    url: String,
    kind: String,
    index: usize,
    total: usize,
    file_size: u64,  // size of THIS file (0 if unknown)
    bytes_done: u64, // running total of all completed files
    status: String,  // "started" | "finished" | "cached" | "failed"
}

const CACHE_CONCURRENCY: usize = 6;

#[tauri::command]
fn cache_assets(app: tauri::AppHandle, entries: Vec<CacheEntry>) -> HashMap<String, String> {
    use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
    use std::sync::Mutex;

    let total = entries.len();
    if total == 0 {
        return HashMap::new();
    }

    let results: Mutex<HashMap<String, String>> = Mutex::new(HashMap::new());
    let next_idx = AtomicUsize::new(0);
    let bytes_done = AtomicU64::new(0);

    // Pre-dedupe by url; later entries with the same url are skipped
    // (they'd produce the same file and rewrite SQLite needlessly).
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let work: Vec<(usize, CacheEntry)> = entries
        .into_iter()
        .enumerate()
        .filter(|(_, e)| seen.insert(e.url.clone()))
        .map(|(i, e)| (i + 1, e))
        .collect();

    std::thread::scope(|s| {
        for _ in 0..CACHE_CONCURRENCY.min(work.len()) {
            s.spawn(|| loop {
                let idx = next_idx.fetch_add(1, Ordering::Relaxed);
                if idx >= work.len() {
                    break;
                }
                let (index, entry) = &work[idx];

                let _ = app.emit(
                    "wui://cache_asset_progress",
                    CacheAssetProgress {
                        url: entry.url.clone(),
                        kind: entry.kind.clone(),
                        index: *index,
                        total,
                        file_size: 0,
                        bytes_done: bytes_done.load(Ordering::Relaxed),
                        status: "started".into(),
                    },
                );

                if let Ok((path, file_size, was_cached)) =
                    cache_asset_inner(&entry.kind, &entry.url)
                {
                    bytes_done.fetch_add(file_size, Ordering::Relaxed);
                    let status = if was_cached { "cached" } else { "finished" };
                    let _ = results
                        .lock()
                        .map(|mut g| g.insert(entry.url.clone(), path));
                    let _ = app.emit(
                        "wui://cache_asset_progress",
                        CacheAssetProgress {
                            url: entry.url.clone(),
                            kind: entry.kind.clone(),
                            index: *index,
                            total,
                            file_size,
                            bytes_done: bytes_done.load(Ordering::Relaxed),
                            status: status.into(),
                        },
                    );
                } else {
                    app_log::write(
                        app_log::LogLevel::Warn,
                        "cache_assets",
                        format!("asset cache failed kind={} index={}", entry.kind, index),
                    );
                    let _ = app.emit(
                        "wui://cache_asset_progress",
                        CacheAssetProgress {
                            url: entry.url.clone(),
                            kind: entry.kind.clone(),
                            index: *index,
                            total,
                            file_size: 0,
                            bytes_done: bytes_done.load(Ordering::Relaxed),
                            status: "failed".into(),
                        },
                    );
                }
            });
        }
    });

    results.into_inner().unwrap_or_default()
}

// ============================================================================
// "快传" 跨设备分享（HTTP server + 二维码）
// ============================================================================
//
// 启动一个内嵌的 HTTP server，监听自动挑选的空闲端口、生成带 token 的
// URL 和 SVG 二维码；手机/电脑扫码或复制链接即可在浏览器里下载视频。
// 详见 src-tauri/src/share_server.rs 的模块级注释和
// docs/plans/2026-06-23-lan-qr-share.md 的设计。

fn share_state(app: &tauri::AppHandle) -> tauri::State<'_, share_server::ShareServerState> {
    use tauri::Manager;
    app.state::<share_server::ShareServerState>()
}

#[tauri::command]
fn start_share_server(
    app: tauri::AppHandle,
    path: String,
) -> Result<share_server::ShareServerInfo, String> {
    let state = share_state(&app);
    let path = std::path::PathBuf::from(&path);
    share_server::start_server(&app, state.inner(), path)
}

#[tauri::command]
fn stop_share_server(app: tauri::AppHandle) -> Result<(), String> {
    share_server::stop_server(share_state(&app).inner())
}

#[tauri::command]
fn share_server_status(app: tauri::AppHandle) -> share_server::ShareServerStatus {
    share_server::status(share_state(&app).inner())
}

/// Grab one PNG frame from a local video at `time_ms` via Windows Media APIs.
/// Returns standard base64 (not data-URL). Runs blocking decode off the UI
/// thread via `spawn_blocking` so the player shell stays responsive.
#[tauri::command]
async fn capture_video_frame(path: String, time_ms: u64) -> Result<String, String> {
    let path = path;
    tauri::async_runtime::spawn_blocking(move || {
        frame_capture::capture_frame_png_base64(&path, time_ms)
    })
    .await
    .map_err(|e| format!("截图任务失败: {}", e))?
}

/// 通用日志 command：让前端能写一行到 app_log（"share" tag 之类）。
/// 包装 `app_log::write`，让前后端日志格式统一。
#[tauri::command]
fn log_event(level: String, scope: String, message: String) {
    let parsed = match level.as_str() {
        "error" | "ERROR" => app_log::LogLevel::Error,
        "warn" | "WARN" => app_log::LogLevel::Warn,
        _ => app_log::LogLevel::Info,
    };
    app_log::write(parsed, &scope, &message);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn _setup_marker() {} // keep module-scope tool happy

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::db::{migrate, open_memory_for_test};
    use crate::parser::model::{MatchRecord, MatchStats};
    use rusqlite::params;

    fn missing_dir() -> PathBuf {
        std::env::temp_dir().join(format!("wonderful-ui-missing-{}", uuid::Uuid::new_v4()))
    }

    fn seed_library_match(conn: &rusqlite::Connection) {
        let raw = serde_json::to_string(&MatchRecord {
            matches_id: "match-1".into(),
            matches_time: 123,
            open_id: "openid-1".into(),
            stats: MatchStats {
                mode_name: "竞技模式".into(),
                ..Default::default()
            },
            ..Default::default()
        })
        .expect("match serializes");
        conn.execute(
            "INSERT INTO accounts(openid, source_id, source_path, last_seen_at)
             VALUES('openid-1', 'aclos_wonderfuldb', 'missing-source', 1)",
            [],
        )
        .expect("account inserted");
        conn.execute(
            "INSERT INTO matches(
                id, source_id, source_match_id, openid, matches_time,
                stats_json, raw_json, last_seen_at
             )
             VALUES(?1, 'aclos_wonderfuldb', ?1, 'openid-1', 123, '{}', ?2, 1)",
            params!["match-1", raw],
        )
        .expect("match inserted");
    }

    #[test]
    fn startup_scan_loads_existing_library_when_source_dir_is_missing() {
        let conn = open_memory_for_test().expect("memory db opens");
        migrate(&conn).expect("migration succeeds");
        seed_library_match(&conn);

        let view =
            load_after_startup_scrape(&conn, &missing_dir(), None).expect("library view loads");

        assert_eq!(view.accounts.len(), 1);
        assert_eq!(view.matches.len(), 1);
        assert_eq!(view.matches[0].matches_id, "match-1");
    }

    #[test]
    fn startup_scan_errors_when_source_dir_is_missing_and_library_is_empty() {
        let conn = open_memory_for_test().expect("memory db opens");
        migrate(&conn).expect("migration succeeds");

        let err = load_after_startup_scrape(&conn, &missing_dir(), None)
            .expect_err("empty library errors");

        assert!(err.contains("read_dir"), "{err}");
    }

    #[test]
    fn reveal_in_explorer_missing_file_returns_error() {
        let path = missing_dir().to_string_lossy().to_string();
        let err = reveal_in_explorer(path).expect_err("expected error for missing file");
        assert!(err.contains("文件不存在"), "{err}");
    }

    #[test]
    fn play_video_missing_file_returns_error() {
        let path = missing_dir().to_string_lossy().to_string();
        let err = play_video(path).expect_err("expected error for missing file");
        assert!(err.contains("源文件丢失"), "{err}");
    }
}
