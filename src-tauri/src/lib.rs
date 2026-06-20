mod library;
mod parser;

use std::collections::HashMap;
use std::path::PathBuf;

use parser::model::{LoadResult, MatchRecord};
use sha2::{Digest, Sha256};

fn sha256_hex(input: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    format!("{:x}", hasher.finalize())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
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
            reveal_in_explorer
        ]);

    #[cfg(feature = "updater")]
    let app = app.plugin(tauri_plugin_updater::Builder::new().build());

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
) -> Result<LoadResult, String> {
    let dir = base.to_string_lossy().into_owned();
    match library::scraper::scrape_wonderful_dir_with_mode(
        conn,
        base,
        "startup",
        library::scraper::ScrapeMode::Incremental,
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

/// Refresh the local SQLite library from the configured WonderfulDb source,
/// then return the library view. WonderfulDb is only read by the source
/// adapter; this command no longer has a direct parser fallback.
#[tauri::command]
fn scan_all(dir: Option<String>) -> Result<LoadResult, String> {
    let base = match dir {
        Some(d) => PathBuf::from(d),
        None => default_wonderful_dir(),
    };
    let conn = library::db::open_library()?;
    load_after_startup_scrape(&conn, &base)
}

#[tauri::command]
fn scrape_library(
    dir: Option<String>,
    trigger: Option<String>,
    mode: Option<String>,
) -> Result<LoadResult, String> {
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
    )?;
    library::db::load_library_view(&conn, base.to_string_lossy().into_owned())
        .map_err(|e| format!("load library: {}", e))
}

#[tauri::command]
fn load_library() -> Result<LoadResult, String> {
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

/// Open a local file with the OS-associated default app. The empty quoted
/// arg is the window title for `cmd /c start` — without it, paths with
/// spaces in them get misparsed.
#[tauri::command]
fn play_video(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(format!("源文件丢失: {}", path));
    }
    let status = std::process::Command::new("cmd")
        .arg("/c")
        .arg("start")
        .arg("")
        .arg(&path)
        .status()
        .map_err(|e| format!("spawn start failed: {}", e))?;
    if !status.success() {
        return Err(format!("system handler exited with {:?}", status.code()));
    }
    Ok(())
}

/// Open Explorer with the given file selected (`explorer /select`).
#[tauri::command]
fn reveal_in_explorer(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(format!("文件不存在: {}", path));
    }
    let status = std::process::Command::new("cmd")
        .arg("/c")
        .arg("explorer")
        .arg(format!("/select,{}", p.display()))
        .status()
        .map_err(|e| format!("spawn explorer: {}", e))?;
    // explorer.exe 在 /select 模式下会 fork 新进程后立即返回，
    // 退出码不可靠（0 或 1 都不能作为成功/失败的依据）。
    // 文件存在 + spawn 成功就视为成功。
    if !status.success() {
        eprintln!(
            "reveal_in_explorer: explorer exited with {:?} (ignored, file may still be open)",
            status.code()
        );
    }
    Ok(())
}

fn assets_dir(kind: &str) -> Result<std::path::PathBuf, String> {
    let local = std::env::var("LOCALAPPDATA").map_err(|_| "LOCALAPPDATA not set".to_string())?;
    Ok(std::path::PathBuf::from(local)
        .join("wonderful-ui")
        .join("assets")
        .join(kind))
}

fn cache_asset_inner(kind: &str, url: &str) -> Result<String, String> {
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
            let _ = library::db::upsert_asset(
                &conn,
                kind,
                url,
                &cached.to_string_lossy(),
                &hash,
            );
        }
        return Ok(cached.to_string_lossy().into_owned());
    }

    let resp = ureq::get(url)
        .call()
        .map_err(|e| format!("download {}: {}", url, e))?;
    let mut out =
        std::fs::File::create(&cached).map_err(|e| format!("create cache file: {}", e))?;
    let mut reader = resp.into_reader();
    std::io::copy(&mut reader, &mut out).map_err(|e| format!("write cache file: {}", e))?;

    if let Ok(conn) = library::db::open_library() {
        let _ = library::db::upsert_asset(
            &conn,
            kind,
            url,
            &cached.to_string_lossy(),
            &hash,
        );
    }

    Ok(cached.to_string_lossy().into_owned())
}

/// Download (or hit cache for) an agent head icon URL. Delegates to the
/// unified asset cache under kind `hero_image`. Returns the absolute local
/// path to the cached file.
#[tauri::command]
fn cache_hero_image(url: String) -> Result<String, String> {
    cache_asset_inner("hero_image", &url)
}

/// Download (or hit cache for) a remote asset by kind and URL. Kind is
/// one of `hero_image`, `map_image`, `game_mode_icon`. Returns the
/// absolute local path to the cached file.
#[tauri::command]
fn cache_asset(kind: String, url: String) -> Result<String, String> {
    cache_asset_inner(&kind, &url)
}

#[derive(serde::Serialize, serde::Deserialize)]
struct CacheEntry {
    kind: String,
    url: String,
}

/// Batch version of `cache_asset`. Returns a map of url → local_path for
/// every successful download. Failed entries are silently omitted —
/// callers already have graceful fallbacks.
#[tauri::command]
fn cache_assets(entries: Vec<CacheEntry>) -> HashMap<String, String> {
    let mut results = HashMap::new();
    for entry in entries {
        if let Ok(path) = cache_asset_inner(&entry.kind, &entry.url) {
            results.insert(entry.url, path);
        }
    }
    results
}

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

        let view = load_after_startup_scrape(&conn, &missing_dir()).expect("library view loads");

        assert_eq!(view.accounts.len(), 1);
        assert_eq!(view.matches.len(), 1);
        assert_eq!(view.matches[0].matches_id, "match-1");
    }

    #[test]
    fn startup_scan_errors_when_source_dir_is_missing_and_library_is_empty() {
        let conn = open_memory_for_test().expect("memory db opens");
        migrate(&conn).expect("migration succeeds");

        let err =
            load_after_startup_scrape(&conn, &missing_dir()).expect_err("empty library errors");

        assert!(err.contains("read_dir"), "{err}");
    }

    #[test]
    fn reveal_in_explorer_missing_file_returns_error() {
        let path = missing_dir().to_string_lossy().to_string();
        let err = reveal_in_explorer(path).expect_err("expected error for missing file");
        assert!(err.contains("文件不存在"), "{err}");
    }
}
