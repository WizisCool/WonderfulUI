use crate::library::db;
use crate::library::now_ms;
use rusqlite::{params, Connection};
use std::path::Path;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountStat {
    pub openid: String,
    pub label: String,
    pub match_count: i64,
    pub video_count: i64,
    pub source_bytes: i64,
    pub source_path: String,
    pub parse_error: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanJobStat {
    pub id: String,
    pub trigger: String,
    pub status: String,
    pub started_at: i64,
    pub finished_at: Option<i64>,
    pub duration_ms: i64,
    pub matches_seen: i64,
    pub videos_seen: i64,
    pub events_seen: i64,
    pub errors_seen: i64,
    pub message: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetKindStat {
    pub kind: String,
    pub count: i64,
    pub bytes: i64,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryStats {
    pub source_bytes: i64,
    pub library_db_bytes: i64,
    pub asset_cache_bytes: i64,
    pub log_bytes: i64,
    pub videos_bytes: i64,
    pub missing_videos_bytes: i64,
    pub total_videos: i64,
    pub missing_videos: i64,
    pub total_accounts: i64,
    pub accounts: Vec<AccountStat>,
    pub recent_scans: Vec<ScanJobStat>,
    pub asset_kinds: Vec<AssetKindStat>,
}

pub fn compute(conn: &Connection) -> Result<LibraryStats, String> {
    let source_bytes: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(COALESCE(source_size_bytes, 0) + COALESCE(snapshot_size_bytes, 0)), 0)
             FROM accounts",
            [],
            |row| row.get(0),
        )
        .map_err(|e| format!("sum source bytes: {}", e))?;

    let library_db_path = db::library_dir()
        .map(|d| d.join("library.db"))
        .unwrap_or_default();
    let library_db_bytes: i64 = std::fs::metadata(&library_db_path)
        .map(|m| m.len() as i64)
        .unwrap_or(0);

    let asset_cache_bytes;
    let asset_kinds;
    {
        let base = db::library_dir().unwrap_or_default();
        let kinds = walk_asset_cache(&base)?;
        let total: i64 = kinds.iter().map(|k| k.bytes).sum();
        asset_cache_bytes = total;
        asset_kinds = kinds;
    }

    let log_bytes: i64 = crate::app_log::status()
        .map(|s| s.size as i64)
        .unwrap_or(0);

    let (total_videos, videos_bytes, missing_videos, missing_videos_bytes): (i64, i64, i64, i64) = conn
        .query_row(
            "SELECT
               COUNT(*),
               COALESCE(SUM(CASE WHEN exists_on_disk = 1 THEN COALESCE(size_bytes, 0) ELSE 0 END), 0),
               COALESCE(SUM(CASE WHEN exists_on_disk = 0 THEN 1 ELSE 0 END), 0),
               COALESCE(SUM(CASE WHEN exists_on_disk = 0 THEN COALESCE(size_bytes, 0) ELSE 0 END), 0)
             FROM videos",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .map_err(|e| format!("sum video stats: {}", e))?;

    let total_accounts: i64 = conn
        .query_row("SELECT COUNT(*) FROM accounts", [], |row| row.get(0))
        .map_err(|e| format!("count accounts: {}", e))?;

    let accounts = {
        let mut stmt = conn
            .prepare(
                "SELECT
                   a.openid,
                   COALESCE(p.custom_name, a.nick, a.tag, a.openid),
                   COUNT(DISTINCT m.id),
                   COUNT(DISTINCT v.id),
                   COALESCE(a.source_size_bytes, 0) + COALESCE(a.snapshot_size_bytes, 0),
                   COALESCE(a.source_path, ''),
                   a.parse_error
                 FROM accounts a
                 LEFT JOIN matches m ON m.openid = a.openid
                 LEFT JOIN videos v ON v.match_id = m.id
                 LEFT JOIN account_preferences p ON p.openid = a.openid
                 GROUP BY a.openid
                 ORDER BY (COALESCE(a.source_size_bytes, 0) + COALESCE(a.snapshot_size_bytes, 0)) DESC",
            )
            .map_err(|e| format!("prepare account stats: {}", e))?;
        let rows = stmt
            .query_map([], |row| {
                Ok(AccountStat {
                    openid: row.get(0)?,
                    label: row.get(1)?,
                    match_count: row.get(2)?,
                    video_count: row.get(3)?,
                    source_bytes: row.get(4)?,
                    source_path: row.get(5)?,
                    parse_error: row.get(6)?,
                })
            })
            .map_err(|e| format!("query account stats: {}", e))?;
        let mut accs = Vec::new();
        for row in rows {
            accs.push(row.map_err(|e| format!("read account row: {}", e))?);
        }
        accs
    };

    let recent_scans = {
        let now = now_ms();
        let mut stmt = conn
            .prepare(
                "SELECT
                   id,
                   trigger,
                   status,
                   started_at,
                   finished_at,
                   MAX(COALESCE(finished_at, ?1) - started_at, 0),
                   matches_seen,
                   videos_seen,
                   events_seen,
                   errors_seen,
                   message
                 FROM scrape_jobs
                 ORDER BY started_at DESC
                 LIMIT 8",
            )
            .map_err(|e| format!("prepare scan jobs: {}", e))?;
        let rows = stmt
            .query_map(params![now], |row| {
                Ok(ScanJobStat {
                    id: row.get(0)?,
                    trigger: row.get(1)?,
                    status: row.get(2)?,
                    started_at: row.get(3)?,
                    finished_at: row.get(4)?,
                    duration_ms: row.get(5)?,
                    matches_seen: row.get(6)?,
                    videos_seen: row.get(7)?,
                    events_seen: row.get(8)?,
                    errors_seen: row.get(9)?,
                    message: row.get(10)?,
                })
            })
            .map_err(|e| format!("query scan jobs: {}", e))?;
        let mut jobs = Vec::new();
        for row in rows {
            jobs.push(row.map_err(|e| format!("read scan job row: {}", e))?);
        }
        jobs
    };

    Ok(LibraryStats {
        source_bytes,
        library_db_bytes,
        asset_cache_bytes,
        log_bytes,
        videos_bytes,
        missing_videos_bytes,
        total_videos,
        missing_videos,
        total_accounts,
        accounts,
        recent_scans,
        asset_kinds,
    })
}

fn walk_asset_cache(base: &Path) -> Result<Vec<AssetKindStat>, String> {
    let assets_dir = base.join("assets");
    if !assets_dir.exists() {
        return Ok(Vec::new());
    }
    let mut result = Vec::new();
    let mut dir_reader =
        std::fs::read_dir(&assets_dir).map_err(|e| format!("read_dir {}: {}", assets_dir.display(), e))?;
    while let Some(entry) = dir_reader.next() {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let kind = entry.file_name().to_string_lossy().into_owned();
        let mut count = 0i64;
        let mut bytes = 0i64;
        if let Ok(kind_dir) = std::fs::read_dir(entry.path()) {
            for file in kind_dir.flatten() {
                if let Ok(meta) = file.metadata() {
                    if meta.is_file() {
                        count += 1;
                        bytes += meta.len() as i64;
                    }
                }
            }
        }
        result.push(AssetKindStat { kind, count, bytes });
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::db::{migrate, open_memory_for_test};

    #[test]
    fn compute_returns_zeros_for_empty_database() {
        let conn = open_memory_for_test().expect("memory db opens");
        migrate(&conn).expect("migration succeeds");
        let stats = compute(&conn).expect("compute succeeds with empty db");
        assert_eq!(stats.source_bytes, 0);
        assert_eq!(stats.total_videos, 0);
        assert_eq!(stats.missing_videos, 0);
        assert_eq!(stats.total_accounts, 0);
        assert!(stats.accounts.is_empty());
        assert!(stats.recent_scans.is_empty());
    }

    #[test]
    fn compute_returns_account_sizes() {
        let conn = open_memory_for_test().expect("memory db opens");
        migrate(&conn).expect("migration succeeds");
        conn.execute(
            "INSERT INTO accounts(openid, nick, tag, source_id, source_path,
             source_size_bytes, snapshot_size_bytes, last_seen_at)
             VALUES
             ('a', 'Alpha', '1111', 'aclos_wonderfuldb', 'a-path', 100, 20, 1),
             ('b', 'Beta', '2222', 'aclos_wonderfuldb', 'b-path', 200, 0, 1)",
            [],
        )
        .expect("accounts inserted");
        let stats = compute(&conn).expect("compute succeeds");
        assert_eq!(stats.source_bytes, 320);
        assert_eq!(stats.total_accounts, 2);
        assert_eq!(stats.accounts.len(), 2);
        assert_eq!(stats.accounts[0].openid, "b");
        assert_eq!(stats.accounts[0].source_bytes, 200);
        assert_eq!(stats.accounts[1].openid, "a");
        assert_eq!(stats.accounts[1].source_bytes, 120);
    }

    #[test]
    fn compute_returns_video_stats() {
        let conn = open_memory_for_test().expect("memory db opens");
        migrate(&conn).expect("migration succeeds");
        conn.execute(
            "INSERT INTO accounts(openid, source_id, source_path, last_seen_at)
             VALUES('a', 'aclos_wonderfuldb', 'a-path', 1)",
            [],
        )
        .expect("account inserted");
        conn.execute(
            "INSERT INTO matches(id, source_id, source_match_id, openid, matches_time, stats_json, last_seen_at)
             VALUES('m1', 'aclos_wonderfuldb', 'm1', 'a', 1, '{}', 1)",
            [],
        )
        .expect("match inserted");
        conn.execute(
            "INSERT INTO videos(id, match_id, source_id, source_video_id, video_type, duration_ms, size_bytes, exists_on_disk, last_seen_at)
             VALUES
             ('v1', 'm1', 'aclos_wonderfuldb', 'v1', '击杀集锦', 10000, 5000, 1, 1),
             ('v2', 'm1', 'aclos_wonderfuldb', 'v2', '三杀时刻', 5000, 3000, 1, 1),
             ('v3', 'm1', 'aclos_wonderfuldb', 'v3', '击杀集锦', 8000, 2000, 0, 1)",
            [],
        )
        .expect("videos inserted");
        let stats = compute(&conn).expect("compute succeeds");
        assert_eq!(stats.total_videos, 3);
        assert_eq!(stats.videos_bytes, 8000);
        assert_eq!(stats.missing_videos, 1);
        assert_eq!(stats.missing_videos_bytes, 2000);
    }

    #[test]
    fn compute_returns_scan_jobs() {
        let conn = open_memory_for_test().expect("memory db opens");
        migrate(&conn).expect("migration succeeds");
        conn.execute(
            "INSERT INTO sources(id, kind, root_path, enabled, created_at, updated_at)
             VALUES('aclos_wonderfuldb', 'aclos_wonderfuldb', '/tmp', 1, 1, 1)",
            [],
        )
        .expect("source inserted");
        conn.execute(
            "INSERT INTO scrape_jobs(id, source_id, trigger, started_at, finished_at, status, matches_seen, videos_seen, events_seen, errors_seen, skipped_accounts)
             VALUES('j1', 'aclos_wonderfuldb', 'startup', 1000, 2000, 'success', 10, 20, 30, 0, 0)",
            [],
        )
        .expect("job inserted");
        let stats = compute(&conn).expect("compute succeeds");
        assert_eq!(stats.recent_scans.len(), 1);
        assert_eq!(stats.recent_scans[0].trigger, "startup");
        assert_eq!(stats.recent_scans[0].status, "success");
        assert_eq!(stats.recent_scans[0].duration_ms, 1000);
        assert_eq!(stats.recent_scans[0].matches_seen, 10);
    }

    #[test]
    fn walk_asset_cache_empty_dir() {
        let dir = std::env::temp_dir().join(format!("wui-test-cache-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir.join("assets")).expect("create assets dir");
        let kinds = walk_asset_cache(&dir).expect("walk succeeds");
        assert!(kinds.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn walk_asset_cache_counts_kinds() {
        let dir = std::env::temp_dir().join(format!("wui-test-cache-{}", uuid::Uuid::new_v4()));
        let assets = dir.join("assets");
        std::fs::create_dir_all(&assets.join("hero_image")).expect("create dir");
        std::fs::create_dir_all(&assets.join("map_image")).expect("create dir");
        std::fs::write(assets.join("hero_image").join("a.png"), "hello").expect("write file");
        std::fs::write(assets.join("hero_image").join("b.png"), "world").expect("write file");
        std::fs::write(assets.join("map_image").join("c.png"), "data").expect("write file");
        let kinds = walk_asset_cache(&dir).expect("walk succeeds");
        assert_eq!(kinds.len(), 2);
        let hero = kinds.iter().find(|k| k.kind == "hero_image").expect("hero kind");
        assert_eq!(hero.count, 2);
        assert_eq!(hero.bytes, 10);
        let map = kinds.iter().find(|k| k.kind == "map_image").expect("map kind");
        assert_eq!(map.count, 1);
        assert_eq!(map.bytes, 4);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
