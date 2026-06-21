use crate::library::model::LibraryLoadResult;
use crate::parser::model::{strip_match_rounds, Account, MatchRecord, SnapshotAchievement};
use rusqlite::{Connection, Result};
use std::path::PathBuf;

pub const CURRENT_SCHEMA_VERSION: i64 = 4;

pub fn library_dir() -> std::result::Result<PathBuf, String> {
    let base = std::env::var("LOCALAPPDATA")
        .or_else(|_| std::env::var("USERPROFILE").map(|home| format!("{home}\\AppData\\Local")))
        .map_err(|_| "LOCALAPPDATA and USERPROFILE are not set".to_string())?;
    Ok(PathBuf::from(base).join("wonderful-ui"))
}

pub fn open_library() -> std::result::Result<Connection, String> {
    let dir = library_dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir {}: {}", dir.display(), e))?;
    let path = dir.join("library.db");
    let conn = Connection::open(&path).map_err(|e| format!("open {}: {}", path.display(), e))?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")
        .map_err(|e| format!("pragma {}: {}", path.display(), e))?;
    migrate(&conn).map_err(|e| format!("migrate {}: {}", path.display(), e))?;
    Ok(conn)
}

#[cfg(test)]
pub fn open_memory_for_test() -> Result<Connection> {
    Connection::open_in_memory()
}

pub fn migrate(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sources (
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            root_path TEXT,
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS scrape_jobs (
            id TEXT PRIMARY KEY,
            source_id TEXT,
            trigger TEXT NOT NULL,
            started_at INTEGER NOT NULL,
            finished_at INTEGER,
            status TEXT NOT NULL,
            message TEXT,
            matches_seen INTEGER NOT NULL DEFAULT 0,
            videos_seen INTEGER NOT NULL DEFAULT 0,
            events_seen INTEGER NOT NULL DEFAULT 0,
            skipped_accounts INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS accounts (
            openid TEXT PRIMARY KEY,
            nick TEXT,
            tag TEXT,
            parse_error TEXT,
            source_id TEXT NOT NULL,
            source_path TEXT,
            source_size_bytes INTEGER,
            source_mtime_ms INTEGER,
            snapshot_size_bytes INTEGER,
            snapshot_mtime_ms INTEGER,
            last_seen_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS snapshot_achievements (
            openid TEXT NOT NULL,
            matches_id TEXT NOT NULL,
            achv_type TEXT NOT NULL,
            type_str TEXT NOT NULL,
            source_id TEXT NOT NULL,
            last_seen_at INTEGER NOT NULL,
            PRIMARY KEY(openid, matches_id)
        );

        CREATE TABLE IF NOT EXISTS account_preferences (
            openid TEXT PRIMARY KEY,
            custom_name TEXT,
            sort_order INTEGER,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS matches (
            id TEXT PRIMARY KEY,
            source_id TEXT NOT NULL,
            source_match_id TEXT NOT NULL,
            openid TEXT,
            matches_time INTEGER NOT NULL,
            game_start_time TEXT,
            game_end_time TEXT,
            map_id TEXT,
            map_name TEXT,
            agent_id TEXT,
            agent_name TEXT,
            mode TEXT,
            mode_name TEXT,
            stats_json TEXT NOT NULL,
            career_json TEXT,
            raw_json TEXT,
            raw_hash TEXT,
            last_seen_at INTEGER NOT NULL
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_matches_source_match
            ON matches(source_id, source_match_id);

        CREATE TABLE IF NOT EXISTS videos (
            id TEXT PRIMARY KEY,
            match_id TEXT NOT NULL,
            source_id TEXT NOT NULL,
            source_video_id TEXT NOT NULL,
            video_type TEXT,
            name TEXT,
            path TEXT,
            poster_path TEXT,
            duration_ms INTEGER NOT NULL DEFAULT 0,
            fps INTEGER NOT NULL DEFAULT 0,
            resolution TEXT,
            size_bytes INTEGER NOT NULL DEFAULT 0,
            mtime_ms INTEGER,
            quick_hash TEXT,
            full_hash TEXT,
            video_hash TEXT,
            cover_hash TEXT,
            exists_on_disk INTEGER NOT NULL DEFAULT 0,
            last_seen_at INTEGER NOT NULL
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_videos_source_video
            ON videos(source_id, source_video_id);

        CREATE TABLE IF NOT EXISTS events (
            id TEXT PRIMARY KEY,
            match_id TEXT NOT NULL,
            video_id TEXT NOT NULL,
            source_event_id TEXT,
            event_type TEXT NOT NULL,
            event_time TEXT,
            time_ms INTEGER NOT NULL,
            seek_ms INTEGER NOT NULL,
            playback_seek_ms INTEGER NOT NULL,
            round_idx INTEGER NOT NULL,
            player_name TEXT,
            killer_name TEXT,
            killed_name TEXT,
            agent_name TEXT,
            weapon_path TEXT,
            weapon_name TEXT,
            is_headshot INTEGER NOT NULL DEFAULT 0,
            assist_num INTEGER NOT NULL DEFAULT 0,
            confidence INTEGER NOT NULL DEFAULT 100,
            dedup_key TEXT NOT NULL,
            raw_json TEXT
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_events_match_dedup
            ON events(match_id, dedup_key);

        CREATE TABLE IF NOT EXISTS assets (
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            source_url TEXT,
            source_path TEXT,
            cache_path TEXT,
            hash TEXT,
            last_seen_at INTEGER NOT NULL
        );
        "#,
    )?;
    if !column_exists(conn, "accounts", "parse_error")? {
        conn.execute("ALTER TABLE accounts ADD COLUMN parse_error TEXT", [])?;
    }
    if !column_exists(conn, "accounts", "source_size_bytes")? {
        conn.execute("ALTER TABLE accounts ADD COLUMN source_size_bytes INTEGER", [])?;
    }
    if !column_exists(conn, "accounts", "source_mtime_ms")? {
        conn.execute("ALTER TABLE accounts ADD COLUMN source_mtime_ms INTEGER", [])?;
    }
    if !column_exists(conn, "accounts", "snapshot_size_bytes")? {
        conn.execute("ALTER TABLE accounts ADD COLUMN snapshot_size_bytes INTEGER", [])?;
    }
    if !column_exists(conn, "accounts", "snapshot_mtime_ms")? {
        conn.execute("ALTER TABLE accounts ADD COLUMN snapshot_mtime_ms INTEGER", [])?;
    }
    if !column_exists(conn, "scrape_jobs", "skipped_accounts")? {
        conn.execute(
            "ALTER TABLE scrape_jobs ADD COLUMN skipped_accounts INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }
    if !column_exists(conn, "scrape_jobs", "errors_seen")? {
        conn.execute(
            "ALTER TABLE scrape_jobs ADD COLUMN errors_seen INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }
    conn.execute(
        "INSERT INTO meta(key, value) VALUES('schema_version', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [CURRENT_SCHEMA_VERSION.to_string()],
    )?;
    Ok(())
}

fn column_exists(conn: &Connection, table: &str, column: &str) -> Result<bool> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        let name: String = row.get(1)?;
        if name == column {
            return Ok(true);
        }
    }
    Ok(false)
}

pub fn load_library_view(conn: &Connection, dir: impl Into<String>) -> Result<LibraryLoadResult> {
    let mut achievements_stmt = conn.prepare(
        "SELECT matches_id, achv_type, type_str
         FROM snapshot_achievements
         WHERE openid = ?1
         ORDER BY matches_id",
    )?;
    let mut accounts_stmt = conn.prepare(
        "SELECT
            a.openid,
            a.source_path,
            COUNT(m.id) AS match_count,
            a.nick,
            a.tag,
            a.parse_error,
            p.custom_name
         FROM accounts a
         LEFT JOIN matches m ON m.openid = a.openid
         LEFT JOIN account_preferences p ON p.openid = a.openid
         GROUP BY a.openid, a.source_path, a.nick, a.tag, a.parse_error, p.custom_name, p.sort_order
         ORDER BY
            CASE WHEN p.sort_order IS NULL THEN 1 ELSE 0 END,
            p.sort_order,
            a.openid",
    )?;
    let accounts = accounts_stmt
        .query_map([], |row| {
            let openid: String = row.get(0)?;
            let achievements = achievements_stmt
                .query_map([openid.as_str()], |achv_row| {
                    Ok(SnapshotAchievement {
                        matches_id: achv_row.get(0)?,
                        achv_type: achv_row.get(1)?,
                        type_str: achv_row.get(2)?,
                    })
                })?
                .collect::<Result<Vec<_>>>()?;
            Ok(Account {
                openid,
                path: row.get(1)?,
                match_count: row.get::<_, i64>(2)? as usize,
                nick: row.get(3)?,
                tag: row.get(4)?,
                custom_name: row.get(6)?,
                achievements,
                error: row.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    let mut match_stmt = conn.prepare("SELECT raw_json FROM matches ORDER BY matches_time DESC")?;
    let mut matches = Vec::new();
    let rows = match_stmt.query_map([], |row| row.get::<_, String>(0))?;
    for raw in rows {
        let raw = raw?;
        if let Ok(mut m) = serde_json::from_str::<MatchRecord>(&raw) {
            for v in &mut m.videos {
                v.rounds.clear();
            }
            matches.push(m);
        }
    }
    strip_match_rounds(&mut matches);
    let total_errors: i64 = conn.query_row(
        "SELECT COUNT(*) FROM accounts WHERE parse_error IS NOT NULL AND parse_error <> ''",
        [],
        |row| row.get(0),
    )?;

    Ok(LibraryLoadResult {
        dir: dir.into(),
        accounts,
        matches,
        total_errors: total_errors as usize,
    })
}

pub fn save_account_order(conn: &Connection, openids: &[String]) -> Result<()> {
    let now = now_ms();
    for (idx, openid) in openids.iter().enumerate() {
        conn.execute(
            "INSERT INTO account_preferences(openid, custom_name, sort_order, updated_at)
             VALUES(?1, NULL, ?2, ?3)
             ON CONFLICT(openid) DO UPDATE SET
               sort_order = excluded.sort_order,
               updated_at = excluded.updated_at",
            rusqlite::params![openid, idx as i64, now],
        )?;
    }
    Ok(())
}

pub fn set_account_custom_name(
    conn: &Connection,
    openid: &str,
    custom_name: Option<&str>,
) -> Result<()> {
    let now = now_ms();
    let trimmed = custom_name.map(str::trim).filter(|s| !s.is_empty());
    conn.execute(
        "INSERT INTO account_preferences(openid, custom_name, updated_at)
         VALUES(?1, ?2, ?3)
         ON CONFLICT(openid) DO UPDATE SET
           custom_name = excluded.custom_name,
           updated_at = excluded.updated_at",
        rusqlite::params![openid, trimmed, now],
    )?;
    Ok(())
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

pub fn upsert_asset(
    conn: &Connection,
    kind: &str,
    source_url: &str,
    cache_path: &str,
    hash: &str,
) -> Result<()> {
    let now = now_ms();
    let id = format!("{}:{}", kind, hash);
    conn.execute(
        "INSERT INTO assets(id, kind, source_url, cache_path, hash, last_seen_at)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(id) DO UPDATE SET
           last_seen_at = excluded.last_seen_at",
        rusqlite::params![id, kind, source_url, cache_path, hash, now],
    )?;
    Ok(())
}

pub fn load_match_rounds(
    conn: &Connection,
    openid: &str,
    match_id: &str,
) -> std::result::Result<MatchRecord, String> {
    let raw: String = conn
        .query_row(
            "SELECT raw_json FROM matches WHERE openid = ?1 AND id = ?2",
            [openid, match_id],
            |row| row.get(0),
        )
        .map_err(|e| {
            format!(
                "match {} not found in library for {}: {}",
                match_id, openid, e
            )
        })?;
    serde_json::from_str::<MatchRecord>(&raw)
        .map_err(|e| format!("decode match {} from library: {}", match_id, e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrate_creates_schema_version_and_core_tables() {
        let conn = open_memory_for_test().expect("memory db opens");
        migrate(&conn).expect("migration succeeds");

        let version: String = conn
            .query_row(
                "SELECT value FROM meta WHERE key = 'schema_version'",
                [],
                |row| row.get(0),
            )
            .expect("schema version exists");
        assert_eq!(version, CURRENT_SCHEMA_VERSION.to_string());

        for table in [
            "sources",
            "scrape_jobs",
            "accounts",
            "account_preferences",
            "snapshot_achievements",
            "matches",
            "videos",
            "events",
            "assets",
        ] {
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                    [table],
                    |row| row.get(0),
                )
                .expect("table lookup works");
            assert_eq!(count, 1, "missing table {table}");
        }
    }

    #[test]
    fn load_library_view_returns_empty_result_for_new_database() {
        let conn = open_memory_for_test().expect("memory db opens");
        migrate(&conn).expect("migration succeeds");
        let view = load_library_view(&conn, "memory").expect("load succeeds");

        assert_eq!(view.dir, "memory");
        assert!(view.accounts.is_empty());
        assert!(view.matches.is_empty());
        assert_eq!(view.total_errors, 0);
    }

    #[test]
    fn account_preferences_override_label_and_order_library_view() {
        let conn = open_memory_for_test().expect("memory db opens");
        migrate(&conn).expect("migration succeeds");
        conn.execute(
            "INSERT INTO accounts(openid, nick, tag, source_id, source_path, last_seen_at)
             VALUES
             ('a', 'Alpha', '1111', 'aclos_wonderfuldb', 'a-path', 1),
             ('b', 'Beta', '2222', 'aclos_wonderfuldb', 'b-path', 1),
             ('c', 'Gamma', '3333', 'aclos_wonderfuldb', 'c-path', 1)",
            [],
        )
        .expect("accounts inserted");

        set_account_custom_name(&conn, "b", Some("  主账号  ")).expect("rename saved");
        save_account_order(&conn, &["c".into(), "b".into()]).expect("order saved");

        let view = load_library_view(&conn, "memory").expect("load succeeds");

        assert_eq!(
            view.accounts
                .iter()
                .map(|a| a.openid.as_str())
                .collect::<Vec<_>>(),
            vec!["c", "b", "a"]
        );
        let renamed = view
            .accounts
            .iter()
            .find(|a| a.openid == "b")
            .expect("b exists");
        assert_eq!(renamed.custom_name.as_deref(), Some("主账号"));

        set_account_custom_name(&conn, "b", Some(" ")).expect("rename cleared");
        let view = load_library_view(&conn, "memory").expect("load succeeds");
        let renamed = view
            .accounts
            .iter()
            .find(|a| a.openid == "b")
            .expect("b exists");
        assert_eq!(renamed.custom_name, None);
    }
}
