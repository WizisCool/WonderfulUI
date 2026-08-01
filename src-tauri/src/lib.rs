mod app_log;
mod firewall;
mod frame_capture;
mod lan_ip;
mod library;
mod os_shell;
mod parser;
mod share_policy;
mod share_server;

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

use library::sha256_hex;
use library::stats::LibraryStats;
use parser::model::{LoadResult, MatchRecord};
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if let Some(exit_code) = firewall::run_helper_if_requested() {
        std::process::exit(exit_code);
    }

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
            open_external_url,
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

    app_log::write(app_log::LogLevel::Info, "app", "WonderfulUI starting");

    app.run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn wonderful_dir_from_home(home: Option<PathBuf>) -> Result<PathBuf, String> {
    let home = home.ok_or_else(|| "USERPROFILE and HOME are not set".to_string())?;
    if !home.is_absolute() {
        return Err("user profile path is not absolute".to_string());
    }
    Ok(home
        .join("AppData")
        .join("Roaming")
        .join("ACLOS")
        .join("WonderfulDb"))
}

fn default_wonderful_dir() -> Result<PathBuf, String> {
    let home = std::env::var_os("USERPROFILE")
        .filter(|value| !value.is_empty())
        .or_else(|| std::env::var_os("HOME").filter(|value| !value.is_empty()))
        .map(PathBuf::from);
    wonderful_dir_from_home(home)
}

const SUPPORTED_VIDEO_EXTENSIONS: &[&str] = &["mp4", "m4v", "mov", "webm", "mkv", "avi"];
const SUPPORTED_POSTER_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp"];

fn path_has_extension(path: &std::path::Path, allowed: &[&str]) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .is_some_and(|value| allowed.contains(&value.as_str()))
}

fn is_regular_file(path: &std::path::Path) -> bool {
    std::fs::symlink_metadata(path)
        .map(|metadata| metadata.file_type().is_file())
        .unwrap_or(false)
}

fn allow_match_asset_paths(app: &tauri::AppHandle, matches: &[MatchRecord]) {
    let scope = app.asset_protocol_scope();
    let mut seen = HashSet::new();
    for match_record in matches {
        for video in &match_record.videos {
            for (value, extensions) in [
                (video.video_src.as_str(), SUPPORTED_VIDEO_EXTENSIONS),
                (video.video_poster.as_str(), SUPPORTED_POSTER_EXTENSIONS),
            ] {
                if value.is_empty() {
                    continue;
                }
                let path = std::path::Path::new(value);
                if !path.is_absolute()
                    || !path_has_extension(path, extensions)
                    || !is_regular_file(path)
                    || !seen.insert(value)
                {
                    continue;
                }
                if let Err(error) = scope.allow_file(path) {
                    app_log::write(
                        app_log::LogLevel::Warn,
                        "asset_scope",
                        format!("failed to allow library media path: {error}"),
                    );
                }
            }
        }
    }
}

fn allow_load_result_assets(app: &tauri::AppHandle, result: &LoadResult) {
    allow_match_asset_paths(app, &result.matches);
}

#[derive(Debug)]
struct StartupLoadOutcome {
    view: LoadResult,
    warning: Option<String>,
}

fn load_after_startup_scrape(
    conn: &rusqlite::Connection,
    base: &std::path::Path,
    app: Option<&tauri::AppHandle>,
) -> Result<StartupLoadOutcome, String> {
    let dir = base.to_string_lossy().into_owned();
    match library::scraper::scrape_wonderful_dir_with_mode(
        conn,
        base,
        "startup",
        library::scraper::ScrapeMode::Incremental,
        app,
    ) {
        Ok(summary) => library::db::load_library_view(conn, dir)
            .map(|view| StartupLoadOutcome {
                view,
                warning: (summary.errors_seen > 0)
                    .then(|| format!("{} 个账户读取失败，请执行全量扫描重试", summary.errors_seen)),
            })
            .map_err(|e| format!("load library: {}", e)),
        Err(scrape_error) => {
            let view = library::db::load_library_view(conn, dir)
                .map_err(|e| format!("load library after scrape failure: {}", e))?;
            if view.accounts.is_empty() && view.matches.is_empty() {
                Err(scrape_error)
            } else {
                Ok(StartupLoadOutcome {
                    view,
                    warning: Some(scrape_error),
                })
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
    /// The fixed ACLOS source directory WonderfulUI is allowed to read:
    /// `%USERPROFILE%\AppData\Roaming\ACLOS\WonderfulDb`.
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
fn aclos_status_for_base(base: &std::path::Path) -> Result<AclosStatusPayload, String> {
    let dir_str = base.to_string_lossy().into_owned();
    let dir_exists = base.is_dir();
    let has_accounts = if dir_exists {
        std::fs::read_dir(&base)
            .map(|rd| {
                rd.filter_map(Result::ok)
                    .any(|entry| library::scraper::is_account_file(&entry))
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

#[tauri::command]
fn aclos_status() -> Result<AclosStatusPayload, String> {
    aclos_status_for_base(&default_wonderful_dir()?)
}

/// Return existing library state immediately, then spawn a background
/// thread to refresh from WonderfulDb. The frontend receives the account
/// shell in the return value and streams per-account scrape results via
/// `wui://account_loaded` events. This keeps the UI responsive during
/// first launch.
#[tauri::command]
fn scan_shell(app: tauri::AppHandle) -> Result<ScanShellPayload, String> {
    app_log::write(
        app_log::LogLevel::Info,
        "scan_shell",
        "loading library shell",
    );
    let base = default_wonderful_dir()?;
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
        let refresh = library::db::open_library()
            .map_err(|e| format!("open library: {e}"))
            .and_then(|conn| load_after_startup_scrape(&conn, &base2, Some(&app2)));

        match refresh {
            Ok(outcome) => {
                if let Some(warning) = outcome.warning {
                    app_log::write(
                        app_log::LogLevel::Warn,
                        "scan_shell",
                        format!("background refresh degraded: {warning}"),
                    );
                    let _ = app2.emit(
                        "wui://phase",
                        serde_json::json!({
                            "phase": "error",
                            "label": "源数据刷新失败，已加载现有资料库",
                            "sub": warning,
                        }),
                    );
                    let _ = app2.emit(
                        "wui://startup_refresh_finished",
                        serde_json::json!({
                            "status": "degraded",
                            "error": warning,
                        }),
                    );
                } else {
                    let _ = app2.emit(
                        "wui://startup_refresh_finished",
                        serde_json::json!({ "status": "finished" }),
                    );
                }
            }
            Err(error) => {
                app_log::write(
                    app_log::LogLevel::Error,
                    "scan_shell",
                    format!("background refresh failed: {error}"),
                );
                let _ = app2.emit(
                    "wui://phase",
                    serde_json::json!({
                        "phase": "error",
                        "label": "资料库刷新失败",
                        "sub": error,
                    }),
                );
                let _ = app2.emit(
                    "wui://startup_refresh_finished",
                    serde_json::json!({
                        "status": "error",
                        "error": error,
                    }),
                );
            }
        }
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
fn scan_all(app: tauri::AppHandle) -> Result<LoadResult, String> {
    app_log::write(
        app_log::LogLevel::Info,
        "scan_all",
        "startup incremental scan requested",
    );
    let base = default_wonderful_dir()?;
    let conn = library::db::open_library()?;
    let view = load_after_startup_scrape(&conn, &base, Some(&app))?.view;
    allow_load_result_assets(&app, &view);
    Ok(view)
}

#[tauri::command]
fn scrape_library(app: tauri::AppHandle, mode: Option<String>) -> Result<LoadResult, String> {
    let (scrape_mode, trigger, mode_label) = validated_manual_scrape_request(mode.as_deref())?;
    app_log::write(
        app_log::LogLevel::Info,
        "scrape_library",
        format!("manual scrape requested mode={mode_label}"),
    );
    let base = default_wonderful_dir()?;
    let conn = library::db::open_library()?;
    library::scraper::scrape_wonderful_dir_with_mode(
        &conn,
        &base,
        trigger,
        scrape_mode,
        Some(&app),
    )?;
    app_log::write(
        app_log::LogLevel::Info,
        "scrape_library",
        format!("manual scrape finished mode={mode_label}"),
    );
    let view = library::db::load_library_view(&conn, base.to_string_lossy().into_owned())
        .map_err(|e| format!("load library: {}", e))?;
    allow_load_result_assets(&app, &view);
    Ok(view)
}

fn validated_manual_scrape_request(
    mode: Option<&str>,
) -> Result<(library::scraper::ScrapeMode, &'static str, &'static str), String> {
    match mode {
        None | Some("incremental") => Ok((
            library::scraper::ScrapeMode::Incremental,
            "manual",
            "incremental",
        )),
        Some("full") => Ok((library::scraper::ScrapeMode::Full, "full_manual", "full")),
        Some(_) => Err("无效的资料库扫描模式".to_string()),
    }
}

#[tauri::command]
fn load_library(app: tauri::AppHandle) -> Result<LoadResult, String> {
    app_log::write(
        app_log::LogLevel::Info,
        "load_library",
        "loading sqlite library view",
    );
    let conn = library::db::open_library()?;
    let view = library::db::load_library_view(
        &conn,
        default_wonderful_dir()?.to_string_lossy().into_owned(),
    )
    .map_err(|e| format!("load library: {}", e))?;
    allow_load_result_assets(&app, &view);
    Ok(view)
}

/// Return the single match with full round / clip / event data from the
/// local SQLite library. The source adapter is responsible for refreshing
/// the library from WonderfulDb; this command does not directly read
/// WonderfulDb.
#[tauri::command]
fn get_match_rounds(
    app: tauri::AppHandle,
    openid: String,
    match_id: String,
) -> Result<MatchRecord, String> {
    let conn = library::db::open_library()?;
    validate_match_round_request(&conn, &openid, &match_id)?;
    app_log::write(
        app_log::LogLevel::Info,
        "get_match_rounds",
        format!("loading rounds match_id={match_id} openid={openid}"),
    );
    let full = library::db::load_match_rounds(&conn, &openid, &match_id)?;
    allow_match_asset_paths(&app, std::slice::from_ref(&full));
    Ok(full)
}

#[tauri::command]
fn save_account_order(openids: Vec<String>) -> Result<(), String> {
    let conn = library::db::open_library()?;
    validate_account_order_request(&conn, &openids)?;
    library::db::save_account_order(&conn, &openids)
        .map_err(|e| format!("save account order: {}", e))
}

#[tauri::command]
fn rename_account(openid: String, custom_name: Option<String>) -> Result<(), String> {
    let conn = library::db::open_library()?;
    validate_known_account_request(&conn, &openid)?;
    validate_account_custom_name(custom_name.as_deref())?;
    library::db::set_account_custom_name(&conn, &openid, custom_name.as_deref())
        .map_err(|e| format!("rename account: {}", e))
}

const MAX_ACCOUNT_ORDER_ITEMS: usize = 1024;
const MAX_ACCOUNT_ID_CHARS: usize = 256;
const MAX_ACCOUNT_CUSTOM_NAME_CHARS: usize = 64;
const MAX_MATCH_ID_CHARS: usize = 512;

fn validate_known_account_request(conn: &rusqlite::Connection, openid: &str) -> Result<(), String> {
    if openid.is_empty()
        || openid.chars().count() > MAX_ACCOUNT_ID_CHARS
        || openid.chars().any(char::is_control)
    {
        return Err("无效账户标识".to_string());
    }
    let known =
        library::db::is_known_account(conn, openid).map_err(|e| format!("验证账户失败: {e}"))?;
    if !known {
        return Err("仅允许修改资料库中的账户".to_string());
    }
    Ok(())
}

fn validate_match_round_request(
    conn: &rusqlite::Connection,
    openid: &str,
    match_id: &str,
) -> Result<(), String> {
    validate_known_account_request(conn, openid)?;
    if match_id.is_empty()
        || match_id.chars().count() > MAX_MATCH_ID_CHARS
        || match_id.chars().any(char::is_control)
    {
        return Err("无效对局标识".to_string());
    }
    Ok(())
}

fn validate_account_order_request(
    conn: &rusqlite::Connection,
    openids: &[String],
) -> Result<(), String> {
    if openids.len() > MAX_ACCOUNT_ORDER_ITEMS {
        return Err("账户排序项目过多".to_string());
    }
    let mut seen = HashSet::with_capacity(openids.len());
    for openid in openids {
        if !seen.insert(openid.as_str()) {
            return Err("账户排序包含重复项目".to_string());
        }
        validate_known_account_request(conn, openid)?;
    }
    Ok(())
}

fn validate_account_custom_name(custom_name: Option<&str>) -> Result<(), String> {
    let Some(name) = custom_name.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(());
    };
    if name.chars().count() > MAX_ACCOUNT_CUSTOM_NAME_CHARS || name.chars().any(char::is_control) {
        return Err(format!(
            "账户显示名必须为 {} 个字符以内的单行文本",
            MAX_ACCOUNT_CUSTOM_NAME_CHARS
        ));
    }
    Ok(())
}

fn validated_library_video_path_with_conn(
    conn: &rusqlite::Connection,
    path: &str,
) -> Result<PathBuf, String> {
    if path.is_empty() {
        return Err("视频路径为空".to_string());
    }
    let registered = library::db::is_library_video_path(conn, path)
        .map_err(|e| format!("验证资料库视频失败: {e}"))?;
    if !registered {
        return Err("仅允许操作资料库中的高光视频".to_string());
    }

    let video_path = PathBuf::from(path);
    if !path_has_extension(&video_path, SUPPORTED_VIDEO_EXTENSIONS) {
        return Err("资料库路径不是受支持的视频文件".to_string());
    }
    let metadata = std::fs::symlink_metadata(&video_path)
        .map_err(|_| format!("源文件丢失: {}", video_path.display()))?;
    if !metadata.file_type().is_file() {
        return Err(format!("源文件不是普通文件: {}", video_path.display()));
    }
    Ok(video_path)
}

fn validated_library_video_path(path: &str) -> Result<PathBuf, String> {
    let conn = library::db::open_library().map_err(|e| format!("打开资料库失败: {e}"))?;
    validated_library_video_path_with_conn(&conn, path)
}

/// Open a local file with the OS-associated default app. **Fire-and-forget,
/// native Win32 path** — `ShellExecuteW` runs in-process (no `cmd.exe`,
/// no `start` builtin parsing, no `cmd /c` `""` placeholder). It is the
/// same API Explorer / the taskbar "Open" button use, so the call
/// returns in milliseconds after handing the file off to the shell.
#[tauri::command]
fn play_video(path: String) -> Result<(), String> {
    let video_path = validated_library_video_path(&path)?;
    os_shell::shell_open(video_path.to_string_lossy().as_ref())
}

const ALLOWED_EXTERNAL_HOSTS: &[&str] = &["github.com", "choosealicense.com"];

fn validated_external_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    let parsed = tauri::Url::parse(trimmed).map_err(|_| "无效链接".to_string())?;
    if parsed.scheme() != "https" {
        return Err("仅允许 https 链接".to_string());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() || parsed.port().is_some() {
        return Err("无效链接".to_string());
    }
    let host = parsed.host_str().ok_or_else(|| "无效链接".to_string())?;
    if !ALLOWED_EXTERNAL_HOSTS.contains(&host) {
        return Err("不允许打开该外部站点".to_string());
    }
    Ok(parsed.into())
}

/// Open an https URL in the system default browser via ShellExecuteW.
/// WebView `<a target=_blank>` does not leave the app; about-page links
/// must go through this command.
#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    let validated = validated_external_url(&url)?;
    os_shell::shell_open(&validated)
}

/// Open Explorer with the given file selected. Fire-and-forget: see
/// `play_video` for why `.status()` was the lag source. `explorer.exe` is a
/// real binary so we skip the `cmd /c` wrapper entirely.
#[tauri::command]
fn reveal_in_explorer(path: String) -> Result<(), String> {
    let p = validated_library_video_path(&path)?;
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
    if kind.len() > MAX_ASSET_KIND_BYTES
        || !matches!(kind, "hero_image" | "map_image" | "game_mode_icon")
    {
        return Err("unsupported asset kind".to_string());
    }
    let local = std::env::var("LOCALAPPDATA").map_err(|_| "LOCALAPPDATA not set".to_string())?;
    Ok(std::path::PathBuf::from(local)
        .join("wonderful-ui")
        .join("assets")
        .join(kind))
}

const MAX_ASSET_BYTES: u64 = 16 * 1024 * 1024;
const MAX_ASSET_URL_BYTES: usize = 4096;
const MAX_ASSET_KIND_BYTES: usize = 32;
const MAX_CACHE_ENTRIES: usize = 256;
const ALLOWED_ASSET_HOSTS: &[&str] = &["media.valorant-api.com", "game.gtimg.cn"];

fn validated_asset_url(raw: &str) -> Result<String, String> {
    if raw.len() > MAX_ASSET_URL_BYTES {
        return Err("asset URL is too long".to_string());
    }
    let trimmed = raw.trim();
    let mut parsed = tauri::Url::parse(trimmed).map_err(|_| "invalid asset URL".to_string())?;
    if parsed.scheme() != "https" {
        return Err("asset URL must use https".to_string());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("asset URL credentials are not allowed".to_string());
    }
    if parsed.port().is_some() {
        return Err("asset URL custom ports are not allowed".to_string());
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| "asset URL host is missing".to_string())?;
    if !ALLOWED_ASSET_HOSTS.contains(&host) {
        return Err(format!("unsupported asset host: {host}"));
    }
    // Fragments are client-side only. Removing them prevents duplicate cache
    // keys for the same HTTP resource.
    parsed.set_fragment(None);
    Ok(parsed.into())
}

fn asset_content_type_extension(value: Option<&str>) -> Option<&'static str> {
    let Some(value) = value else {
        return None;
    };
    let mime = value.split(';').next().unwrap_or_default().trim();
    if mime.eq_ignore_ascii_case("image/png") {
        Some("png")
    } else if mime.eq_ignore_ascii_case("image/jpeg") {
        Some("jpg")
    } else if mime.eq_ignore_ascii_case("image/webp") {
        Some("webp")
    } else {
        None
    }
}

fn asset_extension(url: &str) -> &'static str {
    let path = url.split(['?', '#']).next().unwrap_or(url);
    match std::path::Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("jpg" | "jpeg") => "jpg",
        Some("webp") => "webp",
        _ => "png",
    }
}

fn response_matches_asset_extension(content_type: Option<&str>, extension: &str) -> bool {
    matches!(
        asset_content_type_extension(content_type),
        Some(actual) if actual == extension
    )
}

fn validate_asset_byte_count(size: u64) -> Result<u64, String> {
    if size == 0 {
        return Err("asset response is empty".to_string());
    }
    if size > MAX_ASSET_BYTES {
        return Err(format!(
            "asset exceeds {} MiB limit",
            MAX_ASSET_BYTES / 1_048_576
        ));
    }
    Ok(size)
}

fn cache_asset_inner(kind: &str, url: &str) -> Result<(String, u64, bool), String> {
    let validated_url = validated_asset_url(url)?;
    let dir = assets_dir(kind)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir {}: {}", dir.display(), e))?;

    let hash = sha256_hex(&validated_url);
    let ext = asset_extension(&validated_url);
    let cached = dir.join(format!("{hash}.{ext}"));

    if let Ok(metadata) = std::fs::symlink_metadata(&cached) {
        let size = metadata.len();
        if metadata.is_file() && (1..=MAX_ASSET_BYTES).contains(&size) {
            if let Ok(conn) = library::db::open_library() {
                let _ = library::db::upsert_asset(
                    &conn,
                    kind,
                    &validated_url,
                    &cached.to_string_lossy(),
                    &hash,
                );
            }
            return Ok((cached.to_string_lossy().into_owned(), size, true));
        }
        // Older releases wrote directly to the final path and could leave a
        // zero-byte/oversized partial file after interruption. It is app-owned
        // cache data, so discard it before a clean download.
        std::fs::remove_file(&cached).map_err(|e| format!("remove invalid cache file: {e}"))?;
    }

    let agent = ureq::AgentBuilder::new()
        .redirects(0)
        .timeout_connect(std::time::Duration::from_secs(5))
        .timeout_read(std::time::Duration::from_secs(20))
        .build();
    let resp = agent
        .get(&validated_url)
        .call()
        .map_err(|e| format!("download {}: {}", validated_url, e))?;
    let content_type = resp.header("Content-Type");
    if !response_matches_asset_extension(content_type, ext) {
        return Err("asset response type does not match its file extension".to_string());
    }
    let content_length = resp
        .header("Content-Length")
        .and_then(|s| s.parse::<u64>().ok());
    if let Some(size) = content_length {
        validate_asset_byte_count(size)?;
    }

    let temp = dir.join(format!(".{hash}.{}.part", uuid::Uuid::new_v4()));
    let download_result = (|| -> Result<u64, String> {
        let mut out =
            std::fs::File::create(&temp).map_err(|e| format!("create cache temp file: {e}"))?;
        let mut reader = std::io::Read::take(resp.into_reader(), MAX_ASSET_BYTES + 1);
        let written = std::io::copy(&mut reader, &mut out)
            .map_err(|e| format!("write cache temp file: {e}"))?;
        validate_asset_byte_count(written)?;
        out.sync_all()
            .map_err(|e| format!("sync cache temp file: {e}"))?;
        Ok(written)
    })();
    match download_result {
        Ok(_) => {}
        Err(e) => {
            let _ = std::fs::remove_file(&temp);
            return Err(e);
        }
    }

    match std::fs::rename(&temp, &cached) {
        Ok(()) => {}
        Err(_) if cached.is_file() => {
            // Another concurrent request won the same content-addressed path.
            let _ = std::fs::remove_file(&temp);
        }
        Err(e) => {
            let _ = std::fs::remove_file(&temp);
            return Err(format!("publish cache file: {e}"));
        }
    }

    let metadata = std::fs::symlink_metadata(&cached)
        .map_err(|e| format!("inspect published cache file: {e}"))?;
    if !metadata.is_file() {
        return Err("published asset cache path is not a regular file".to_string());
    }
    let size = match validate_asset_byte_count(metadata.len()) {
        Ok(size) => size,
        Err(error) => {
            let _ = std::fs::remove_file(&cached);
            return Err(error);
        }
    };

    if let Ok(conn) = library::db::open_library() {
        let _ = library::db::upsert_asset(
            &conn,
            kind,
            &validated_url,
            &cached.to_string_lossy(),
            &hash,
        );
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

#[derive(Clone, serde::Serialize, serde::Deserialize)]
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

fn validate_cache_entries(entries: &[CacheEntry]) -> Result<(), String> {
    if entries.len() > MAX_CACHE_ENTRIES {
        return Err(format!(
            "asset cache batch exceeds {MAX_CACHE_ENTRIES} entries"
        ));
    }
    if entries.iter().any(|entry| {
        entry.kind.len() > MAX_ASSET_KIND_BYTES || entry.url.len() > MAX_ASSET_URL_BYTES
    }) {
        return Err("asset cache entry is too long".to_string());
    }
    Ok(())
}

#[tauri::command]
fn cache_assets(
    app: tauri::AppHandle,
    entries: Vec<CacheEntry>,
) -> Result<HashMap<String, String>, String> {
    use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
    use std::sync::Mutex;

    validate_cache_entries(&entries)?;
    // Pre-dedupe by url; later entries with the same url are skipped
    // (they'd produce the same file and rewrite SQLite needlessly).
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let work: Vec<(usize, CacheEntry)> = entries
        .into_iter()
        .filter_map(|mut entry| {
            entry.url = entry.url.trim().to_string();
            seen.insert(entry.url.clone()).then_some(entry)
        })
        .enumerate()
        .map(|(i, entry)| (i + 1, entry))
        .collect();
    let total = work.len();
    if total == 0 {
        return Ok(HashMap::new());
    }

    let results: Mutex<HashMap<String, String>> = Mutex::new(HashMap::new());
    let next_idx = AtomicUsize::new(0);
    let bytes_done = AtomicU64::new(0);

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

    Ok(results.into_inner().unwrap_or_default())
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
async fn start_share_server(
    app: tauri::AppHandle,
    path: String,
    session_id: String,
) -> Result<share_server::ShareServerInfo, String> {
    validate_share_session_id(&session_id)?;
    let path = validated_library_video_path(&path)?;
    let app_for_task = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = share_state(&app_for_task);
        share_server::start_server(&app_for_task, state.inner(), path, session_id)
    })
    .await
    .map_err(|error| {
        app_log::write(
            app_log::LogLevel::Error,
            "share",
            format!("share start task failed: {error}"),
        );
        share_policy::ipc_error(share_policy::ShareErrorCode::ServerStartFailed)
    })?
}

#[tauri::command]
fn stop_share_server(app: tauri::AppHandle, session_id: Option<String>) -> Result<(), String> {
    if let Some(value) = session_id.as_deref() {
        validate_share_session_id(value)?;
    }
    share_server::stop_server(share_state(&app).inner(), session_id)
}

fn validate_share_session_id(session_id: &str) -> Result<(), String> {
    let parsed = uuid::Uuid::parse_str(session_id).map_err(|_| "无效的快传会话标识".to_string())?;
    if parsed.get_version() != Some(uuid::Version::Random) || parsed.to_string() != session_id {
        return Err("无效的快传会话标识".to_string());
    }
    Ok(())
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
    let path = validated_library_video_path(&path)?;
    tauri::async_runtime::spawn_blocking(move || {
        frame_capture::capture_frame_png_base64(path.to_string_lossy().as_ref(), time_ms)
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

        let outcome =
            load_after_startup_scrape(&conn, &missing_dir(), None).expect("library view loads");
        let view = outcome.view;

        assert_eq!(view.accounts.len(), 1);
        assert_eq!(view.matches.len(), 1);
        assert_eq!(view.matches[0].matches_id, "match-1");
        assert!(outcome.warning.is_some());
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
    fn startup_scan_reports_partial_account_parse_failures_as_degraded() {
        let conn = open_memory_for_test().expect("memory db opens");
        migrate(&conn).expect("migration succeeds");
        let dir =
            std::env::temp_dir().join(format!("wui-startup-partial-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("temp dir created");
        std::fs::write(dir.join("123456789012345"), b"not hex")
            .expect("invalid account fixture written");

        let outcome = load_after_startup_scrape(&conn, &dir, None)
            .expect("partial scrape keeps a recoverable library view");

        assert_eq!(outcome.view.accounts.len(), 1);
        assert_eq!(outcome.view.total_errors, 1);
        assert!(outcome.warning.as_deref().is_some_and(|warning| {
            warning.contains("1 个账户读取失败") && warning.contains("全量扫描")
        }));
        std::fs::remove_dir_all(&dir).expect("temp dir removed");
    }

    #[test]
    fn aclos_status_requires_a_regular_numeric_account_file() {
        let dir = std::env::temp_dir().join(format!("wui-aclos-status-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("temp dir created");
        std::fs::write(dir.join("snapshot123456"), b"snapshot").expect("snapshot fixture");
        std::fs::write(dir.join("index"), b"index").expect("index fixture");
        std::fs::write(dir.join(".hidden"), b"hidden").expect("hidden fixture");
        std::fs::write(dir.join("README"), b"notes").expect("readme fixture");
        std::fs::create_dir(dir.join("123456")).expect("numeric directory fixture");

        let without_account = aclos_status_for_base(&dir).expect("status probe succeeds");
        assert!(without_account.dir_exists);
        assert!(!without_account.has_accounts);

        std::fs::write(dir.join("9876543210"), b"account").expect("account fixture");
        let with_account = aclos_status_for_base(&dir).expect("status probe succeeds");
        assert!(with_account.has_accounts);

        std::fs::remove_dir_all(&dir).expect("temp dir removed");
    }

    #[test]
    fn wonderful_dir_resolution_fails_closed_without_an_absolute_profile() {
        assert!(wonderful_dir_from_home(None).is_err());
        assert!(wonderful_dir_from_home(Some(PathBuf::from("relative-profile"))).is_err());

        let home = std::env::temp_dir().join("wui-profile-fixture");
        let resolved = wonderful_dir_from_home(Some(home.clone())).expect("absolute home accepted");
        assert_eq!(
            resolved,
            home.join("AppData")
                .join("Roaming")
                .join("ACLOS")
                .join("WonderfulDb")
        );
    }

    #[test]
    fn account_preference_requests_require_known_bounded_unique_accounts() {
        let conn = open_memory_for_test().expect("memory db opens");
        migrate(&conn).expect("migration succeeds");
        conn.execute(
            "INSERT INTO accounts(openid, source_id, last_seen_at)
             VALUES('account-a', 'aclos_wonderfuldb', 1),
                   ('account-b', 'aclos_wonderfuldb', 1)",
            [],
        )
        .expect("accounts seeded");

        validate_account_order_request(&conn, &["account-b".into(), "account-a".into()])
            .expect("known unique order accepted");
        assert!(
            validate_account_order_request(&conn, &["account-a".into(), "account-a".into()])
                .is_err()
        );
        assert!(validate_account_order_request(&conn, &["unknown".into()]).is_err());
        assert!(validate_known_account_request(&conn, "unknown").is_err());
        assert!(validate_known_account_request(&conn, "account-a\n").is_err());
        assert!(validate_account_order_request(
            &conn,
            &vec!["account-a".into(); MAX_ACCOUNT_ORDER_ITEMS + 1]
        )
        .is_err());

        validate_account_custom_name(None).expect("clear accepted");
        validate_account_custom_name(Some("  主账号  ")).expect("normal name accepted");
        assert!(validate_account_custom_name(Some(
            &"名".repeat(MAX_ACCOUNT_CUSTOM_NAME_CHARS + 1)
        ))
        .is_err());
        assert!(validate_account_custom_name(Some("line\nbreak")).is_err());
    }

    #[test]
    fn renderer_scan_requests_allow_only_canonical_modes() {
        let (mode, trigger, label) =
            validated_manual_scrape_request(None).expect("missing mode is incremental");
        assert_eq!(mode, library::scraper::ScrapeMode::Incremental);
        assert_eq!((trigger, label), ("manual", "incremental"));

        let (mode, trigger, label) =
            validated_manual_scrape_request(Some("full")).expect("full mode accepted");
        assert_eq!(mode, library::scraper::ScrapeMode::Full);
        assert_eq!((trigger, label), ("full_manual", "full"));

        for invalid in ["", "FULL", "full_scan", "unknown"] {
            assert!(validated_manual_scrape_request(Some(invalid)).is_err());
        }
    }

    #[test]
    fn match_round_requests_require_known_accounts_and_bounded_ids() {
        let conn = open_memory_for_test().expect("memory db opens");
        migrate(&conn).expect("migration succeeds");
        conn.execute(
            "INSERT INTO accounts(openid, source_id, last_seen_at)
             VALUES('account-a', 'aclos_wonderfuldb', 1)",
            [],
        )
        .expect("account seeded");

        validate_match_round_request(&conn, "account-a", "match-1")
            .expect("known bounded request accepted");
        assert!(validate_match_round_request(&conn, "unknown", "match-1").is_err());
        assert!(validate_match_round_request(&conn, "account-a", "").is_err());
        assert!(validate_match_round_request(&conn, "account-a", "match\n1").is_err());
        assert!(validate_match_round_request(
            &conn,
            "account-a",
            &"m".repeat(MAX_MATCH_ID_CHARS + 1),
        )
        .is_err());
    }

    #[test]
    fn share_session_ids_require_canonical_uuid_v4_values() {
        validate_share_session_id("550e8400-e29b-41d4-a716-446655440000")
            .expect("canonical v4 accepted");
        assert!(validate_share_session_id("session-1").is_err());
        assert!(validate_share_session_id("550E8400-E29B-41D4-A716-446655440000").is_err());
        assert!(validate_share_session_id("550e8400-e29b-11d4-a716-446655440000").is_err());
    }

    #[test]
    fn local_video_commands_require_a_registered_supported_file() {
        let conn = open_memory_for_test().expect("memory db opens");
        migrate(&conn).expect("migration succeeds");
        let dir = std::env::temp_dir().join(format!("wui-video-scope-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("temp dir created");
        let registered = dir.join("registered.mp4");
        let unregistered = dir.join("unregistered.mp4");
        let executable = dir.join("registered.exe");
        let directory = dir.join("directory.mp4");
        std::fs::write(&registered, b"video").expect("registered fixture written");
        std::fs::write(&unregistered, b"video").expect("unregistered fixture written");
        std::fs::write(&executable, b"binary").expect("executable fixture written");
        std::fs::create_dir(&directory).expect("directory fixture created");

        for (id, path) in [
            ("video-1", &registered),
            ("video-2", &executable),
            ("video-3", &directory),
        ] {
            conn.execute(
                "INSERT INTO videos(
                    id, match_id, source_id, source_video_id, path,
                    duration_ms, fps, size_bytes, exists_on_disk, last_seen_at
                 ) VALUES(?1, 'match-1', 'aclos_wonderfuldb', ?1, ?2, 1, 60, 5, 1, 1)",
                params![id, path.to_string_lossy().as_ref()],
            )
            .expect("video fixture inserted");
        }

        assert_eq!(
            validated_library_video_path_with_conn(&conn, registered.to_string_lossy().as_ref(),)
                .unwrap(),
            registered,
        );
        let err =
            validated_library_video_path_with_conn(&conn, unregistered.to_string_lossy().as_ref())
                .expect_err("unregistered path rejected");
        assert!(err.contains("资料库"), "{err}");
        let err =
            validated_library_video_path_with_conn(&conn, executable.to_string_lossy().as_ref())
                .expect_err("registered executable rejected");
        assert!(err.contains("视频文件"), "{err}");
        let err =
            validated_library_video_path_with_conn(&conn, directory.to_string_lossy().as_ref())
                .expect_err("registered directory rejected");
        assert!(err.contains("普通文件"), "{err}");

        std::fs::remove_file(&registered).expect("registered fixture removed");
        let err =
            validated_library_video_path_with_conn(&conn, registered.to_string_lossy().as_ref())
                .expect_err("missing registered path rejected");
        assert!(err.contains("源文件丢失"), "{err}");
        std::fs::remove_dir_all(&dir).expect("temp dir removed");
    }

    #[test]
    fn open_external_url_rejects_non_https() {
        let err = open_external_url("http://example.com".into()).expect_err("http blocked");
        assert!(err.contains("https"), "{err}");
        let err = open_external_url("file:///C:/Windows".into()).expect_err("file blocked");
        assert!(err.contains("https"), "{err}");
    }

    #[test]
    fn external_url_validation_allows_only_product_links() {
        assert_eq!(
            validated_external_url(" https://github.com/WizisCool/WonderfulUI ")
                .expect("project URL accepted"),
            "https://github.com/WizisCool/WonderfulUI",
        );
        assert!(validated_external_url("https://choosealicense.com/licenses/gpl-3.0/").is_ok());

        for rejected in [
            "https://example.com/",
            "https://github.com.example.com/",
            "https://user@github.com/",
            "https://github.com:444/",
            "https://github.com evil.example/",
        ] {
            assert!(
                validated_external_url(rejected).is_err(),
                "accepted {rejected}",
            );
        }
    }

    #[test]
    fn asset_extension_ignores_query_and_normalizes_supported_types() {
        assert_eq!(asset_extension("https://example.test/a.JPEG?x=.png"), "jpg");
        assert_eq!(
            asset_extension("https://example.test/a.webp#fragment"),
            "webp"
        );
        assert_eq!(asset_extension("https://example.test/a.svg"), "png");
        assert_eq!(asset_extension("https://example.test/no-extension"), "png");
        assert_eq!(asset_extension("https://example.test/a.exe"), "png");
    }

    #[test]
    fn asset_url_validation_allows_only_known_https_origins() {
        assert_eq!(
            validated_asset_url(" https://media.valorant-api.com/maps/a/splash.png#v1 ")
                .expect("known host accepted"),
            "https://media.valorant-api.com/maps/a/splash.png"
        );
        assert!(validated_asset_url("https://game.gtimg.cn/images/a.png").is_ok());

        for rejected in [
            "http://media.valorant-api.com/a.png",
            "https://example.com/a.png",
            "https://media.valorant-api.com.example.com/a.png",
            "https://user@media.valorant-api.com/a.png",
            "https://media.valorant-api.com:444/a.png",
            "not a URL",
        ] {
            assert!(
                validated_asset_url(rejected).is_err(),
                "accepted {rejected}"
            );
        }
        assert!(validated_asset_url(&"x".repeat(MAX_ASSET_URL_BYTES + 1)).is_err());
    }

    #[test]
    fn asset_content_type_validation_is_strict() {
        for allowed in ["image/png", "Image/JPEG; charset=binary", "image/webp"] {
            assert!(
                asset_content_type_extension(Some(allowed)).is_some(),
                "rejected {allowed}"
            );
        }
        for rejected in [
            None,
            Some(""),
            Some("text/html"),
            Some("image/gif"),
            Some("image/svg+xml"),
        ] {
            assert!(asset_content_type_extension(rejected).is_none());
        }
        assert!(response_matches_asset_extension(Some("image/png"), "png"));
        assert!(response_matches_asset_extension(Some("image/jpeg"), "jpg"));
        assert!(!response_matches_asset_extension(Some("image/jpeg"), "png"));
    }

    #[test]
    fn asset_byte_count_requires_a_nonempty_bounded_payload() {
        assert!(validate_asset_byte_count(0).is_err());
        assert_eq!(validate_asset_byte_count(1), Ok(1));
        assert_eq!(
            validate_asset_byte_count(MAX_ASSET_BYTES),
            Ok(MAX_ASSET_BYTES)
        );
        assert!(validate_asset_byte_count(MAX_ASSET_BYTES + 1).is_err());
    }

    #[test]
    fn asset_kind_is_rejected_before_environment_lookup() {
        let error = assets_dir("../escape").expect_err("unsupported kind rejected");
        assert!(error.contains("unsupported asset kind"), "{error}");
    }

    #[test]
    fn legacy_asset_batches_are_bounded_before_starting_workers() {
        let entry = CacheEntry {
            kind: "hero_image".into(),
            url: "https://media.valorant-api.com/a.png".into(),
        };
        validate_cache_entries(std::slice::from_ref(&entry)).expect("small batch accepted");
        assert!(validate_cache_entries(&vec![entry.clone(); MAX_CACHE_ENTRIES + 1]).is_err());
        assert!(validate_cache_entries(&[CacheEntry {
            kind: "hero_image".into(),
            url: "x".repeat(MAX_ASSET_URL_BYTES + 1),
        }])
        .is_err());
    }
}
