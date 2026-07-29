//! Source adapters that scrape read-only inputs into the local library.

use crate::library::aclos_identity::AclosIdentityIndex;
use crate::library::events::normalize_match_events;
use crate::library::{now_ms, sha256_hex};
use crate::parser;
use crate::parser::model::{MatchRecord, SnapshotAchievement};
use rayon::prelude::*;
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use std::collections::HashSet;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::Emitter;
use uuid::Uuid;

/// Serialize scrapes so startup background scan and manual full/incremental
/// scrapes never interleave SQLite writes.
static SCRAPE_LOCK: Mutex<()> = Mutex::new(());

const ACLOS_SOURCE_ID: &str = "aclos_wonderfuldb";

#[derive(Debug, Clone, Default)]
pub struct ScrapeSummary {
    pub matches_seen: usize,
    pub videos_seen: usize,
    pub events_seen: usize,
    pub errors_seen: usize,
    pub skipped_accounts: usize,
    /// Sum of account-file sizes processed so far (parsed + skipped + empty + error).
    /// Must reach `size_bytes_total` when the scrape finishes so progress UIs hit 100%.
    pub size_bytes_done: i64,
    /// Sum of all account-file sizes discovered at the start of the scrape.
    pub size_bytes_total: i64,
}

#[derive(Clone, serde::Serialize)]
struct ScrapePhaseEvent {
    phase: String,
    label: String,
    sub: Option<String>,
}

#[derive(Clone, serde::Serialize)]
struct AccountStartedEvent {
    openid: String,
    current: usize,
    total: usize,
    size_bytes_done: i64,
    size_bytes_total: i64,
}

#[derive(Clone, serde::Serialize)]
struct AccountFinishedEvent {
    openid: String,
    status: String,
    current: usize,
    total: usize,
    size_bytes_done: i64,
    size_bytes_total: i64,
    error: Option<String>,
}

#[derive(Clone, serde::Serialize)]
struct AccountLoadedEvent {
    openid: String,
    matches_count: usize,
    videos_count: usize,
    events_count: usize,
    status: String, // "ok" | "error"
    error: Option<String>,
    duration_ms: i64,
    current: usize,
    total: usize,
}

#[derive(Clone, serde::Serialize)]
struct ScrapeSummaryEventData {
    matches_seen: usize,
    videos_seen: usize,
    events_seen: usize,
    errors_seen: usize,
    skipped_accounts: usize,
    duration_ms: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScrapeMode {
    Incremental,
    Full,
}

impl ScrapeMode {
    pub fn from_arg(value: Option<&str>) -> Self {
        match value
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase()
            .as_str()
        {
            "full" | "full_scan" | "full-scan" | "full_rescan" | "full-rescan" => Self::Full,
            _ => Self::Incremental,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct SourceFileMeta {
    size_bytes: i64,
    mtime_ms: Option<i64>,
}

fn metadata_mtime_ms(meta: &std::fs::Metadata) -> Option<i64> {
    let modified = meta.modified().ok()?;
    let duration = modified.duration_since(std::time::UNIX_EPOCH).ok()?;
    Some(duration.as_millis() as i64)
}

fn source_file_meta(path: &Path) -> Option<SourceFileMeta> {
    let meta = std::fs::metadata(path).ok()?;
    Some(SourceFileMeta {
        size_bytes: meta.len() as i64,
        mtime_ms: metadata_mtime_ms(&meta),
    })
}

fn progress_after_file(current: i64, source_meta: Option<SourceFileMeta>) -> i64 {
    current.saturating_add(source_meta.map_or(0, |meta| meta.size_bytes))
}

fn snapshot_file_meta(dir: &Path, openid: &str) -> Option<SourceFileMeta> {
    source_file_meta(&dir.join(format!("snapshot{}", openid)))
}

fn read_snapshot_for_account(
    dir: &Path,
    openid: &str,
    identity: &AclosIdentityIndex,
) -> (Option<String>, Option<String>, Vec<SnapshotAchievement>) {
    let snapshot_path = dir.join(format!("snapshot{}", openid));
    let (snap_nick, snap_tag, achievements) =
        match parser::parse_snapshot_db(&snapshot_path, openid) {
            Ok(data) => (data.nick, data.tag, data.achievements),
            Err(_) => (None, None, Vec::new()),
        };
    // Nick/tag: prefer ACLOS Local Storage LevelDB role cache
    // (`ACLOS_USER_ROLES_INFO` / `acloshighlight_user_<openid>`), then snapshot.
    // Achievements stay snapshot-only.
    let (nick, tag) = identity.merge_with_snapshot(openid, snap_nick, snap_tag);
    (nick, tag, achievements)
}

fn upsert_source(conn: &Connection, dir: &Path, now: i64) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO sources(id, kind, root_path, enabled, created_at, updated_at)
         VALUES(?1, 'aclos_wonderfuldb', ?2, 1, ?3, ?3)
         ON CONFLICT(id) DO UPDATE SET
           root_path = excluded.root_path,
           updated_at = excluded.updated_at",
        params![ACLOS_SOURCE_ID, dir.to_string_lossy(), now],
    )?;
    Ok(())
}

/// Remove an account that has no highlight matches from the library.
/// Keeps `account_preferences` (rename/order) so a later reappearance restores prefs.
fn purge_empty_account(conn: &Connection, openid: &str) -> rusqlite::Result<()> {
    // events/videos hang off matches; delete by match openid via subqueries.
    conn.execute(
        "DELETE FROM events WHERE match_id IN (SELECT id FROM matches WHERE openid = ?1)",
        params![openid],
    )?;
    conn.execute(
        "DELETE FROM videos WHERE match_id IN (SELECT id FROM matches WHERE openid = ?1)",
        params![openid],
    )?;
    conn.execute("DELETE FROM matches WHERE openid = ?1", params![openid])?;
    conn.execute(
        "DELETE FROM snapshot_achievements WHERE openid = ?1",
        params![openid],
    )?;
    conn.execute("DELETE FROM accounts WHERE openid = ?1", params![openid])?;
    Ok(())
}

/// Remove matches no longer present in the latest successful payload for an
/// account. Parse failures intentionally skip this path so the last known-good
/// library remains available.
fn purge_stale_matches(
    conn: &Connection,
    openid: &str,
    current_ids: &HashSet<&str>,
) -> rusqlite::Result<usize> {
    let mut stmt = conn.prepare("SELECT id FROM matches WHERE openid = ?1")?;
    let existing = stmt
        .query_map(params![openid], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    drop(stmt);

    let stale: Vec<String> = existing
        .into_iter()
        .filter(|id| !current_ids.contains(id.as_str()))
        .collect();
    for match_id in &stale {
        conn.execute("DELETE FROM events WHERE match_id = ?1", params![match_id])?;
        conn.execute("DELETE FROM videos WHERE match_id = ?1", params![match_id])?;
        conn.execute("DELETE FROM matches WHERE id = ?1", params![match_id])?;
    }
    Ok(stale.len())
}

fn mark_scrape_job_failed(conn: &Connection, job_id: &str, message: &str) {
    let _ = conn.execute(
        "UPDATE scrape_jobs
         SET finished_at = ?1, status = 'failed', message = ?2
         WHERE id = ?3",
        params![now_ms(), message, job_id],
    );
}

/// Update nick/tag only (incremental skip path). LevelDB identity preferred
/// fields overwrite when provided; leaves achievements and match rows alone.
fn refresh_account_identity(
    conn: &Connection,
    openid: &str,
    nick: Option<&str>,
    tag: Option<&str>,
    now: i64,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE accounts SET
           nick = CASE WHEN ?2 IS NOT NULL THEN ?2 ELSE nick END,
           tag = CASE WHEN ?3 IS NOT NULL THEN ?3 ELSE tag END,
           last_seen_at = ?4
         WHERE openid = ?1",
        params![openid, nick, tag, now],
    )?;
    Ok(())
}

fn upsert_account(
    conn: &Connection,
    openid: &str,
    path: &Path,
    source_meta: Option<SourceFileMeta>,
    snapshot_meta: Option<SourceFileMeta>,
    nick: Option<String>,
    tag: Option<String>,
    achievements: &[SnapshotAchievement],
    parse_error: Option<&str>,
    now: i64,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO accounts(
            openid, nick, tag, parse_error, source_id, source_path,
            source_size_bytes, source_mtime_ms, snapshot_size_bytes, snapshot_mtime_ms,
            last_seen_at
         )
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
         ON CONFLICT(openid) DO UPDATE SET
           nick = excluded.nick,
           tag = excluded.tag,
           parse_error = excluded.parse_error,
           source_id = excluded.source_id,
           source_path = excluded.source_path,
           source_size_bytes = excluded.source_size_bytes,
           source_mtime_ms = excluded.source_mtime_ms,
           snapshot_size_bytes = excluded.snapshot_size_bytes,
           snapshot_mtime_ms = excluded.snapshot_mtime_ms,
           last_seen_at = excluded.last_seen_at",
        params![
            openid,
            nick,
            tag,
            parse_error,
            ACLOS_SOURCE_ID,
            path.to_string_lossy(),
            source_meta.map(|m| m.size_bytes),
            source_meta.and_then(|m| m.mtime_ms),
            snapshot_meta.map(|m| m.size_bytes),
            snapshot_meta.and_then(|m| m.mtime_ms),
            now
        ],
    )?;
    conn.execute(
        "DELETE FROM snapshot_achievements WHERE openid = ?1 AND source_id = ?2",
        params![openid, ACLOS_SOURCE_ID],
    )?;
    for a in achievements {
        conn.execute(
            "INSERT INTO snapshot_achievements(
                openid, matches_id, achv_type, type_str, source_id, last_seen_at
             )
             VALUES(?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(openid, matches_id) DO UPDATE SET
               achv_type = excluded.achv_type,
               type_str = excluded.type_str,
               source_id = excluded.source_id,
               last_seen_at = excluded.last_seen_at",
            params![
                openid,
                a.matches_id,
                a.achv_type,
                a.type_str,
                ACLOS_SOURCE_ID,
                now
            ],
        )?;
    }
    Ok(())
}

fn upsert_match(conn: &Connection, m: &MatchRecord, now: i64) -> rusqlite::Result<()> {
    let stats_json = serde_json::to_string(&m.stats).unwrap_or_else(|_| "{}".to_string());
    let career_json = m
        .extras
        .get("career")
        .and_then(|v| serde_json::to_string(v).ok());
    let raw_json = serde_json::to_string(m).unwrap_or_else(|_| "{}".to_string());
    let raw_hash = sha256_hex(&raw_json);
    conn.execute(
        "INSERT INTO matches(
            id, source_id, source_match_id, openid, matches_time, game_start_time,
            game_end_time, map_id, map_name, agent_id, agent_name, mode, mode_name,
            stats_json, career_json, raw_json, raw_hash, last_seen_at
         )
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)
         ON CONFLICT(source_id, source_match_id) DO UPDATE SET
            openid = excluded.openid,
            matches_time = excluded.matches_time,
            game_start_time = excluded.game_start_time,
            game_end_time = excluded.game_end_time,
            map_id = excluded.map_id,
            map_name = excluded.map_name,
            agent_id = excluded.agent_id,
            agent_name = excluded.agent_name,
            mode = excluded.mode,
            mode_name = excluded.mode_name,
            stats_json = excluded.stats_json,
            career_json = excluded.career_json,
            raw_json = excluded.raw_json,
            raw_hash = excluded.raw_hash,
            last_seen_at = excluded.last_seen_at",
        params![
            m.matches_id,
            ACLOS_SOURCE_ID,
            m.matches_id,
            m.open_id,
            m.matches_time,
            m.game_start_time,
            m.game_end_time,
            m.map.map_id,
            m.map.map_name,
            m.agent.agent_id,
            m.agent.agent_name,
            m.mode,
            m.stats.mode_name,
            stats_json,
            career_json,
            raw_json,
            raw_hash,
            now,
        ],
    )?;
    Ok(())
}

fn account_is_fresh(
    conn: &Connection,
    openid: &str,
    source_meta: SourceFileMeta,
    snapshot_meta: Option<SourceFileMeta>,
) -> rusqlite::Result<bool> {
    let stored = conn
        .query_row(
            "SELECT
                parse_error,
                source_size_bytes,
                source_mtime_ms,
                snapshot_size_bytes,
                snapshot_mtime_ms
             FROM accounts
             WHERE openid = ?1 AND source_id = ?2",
            params![openid, ACLOS_SOURCE_ID],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<i64>>(1)?,
                    row.get::<_, Option<i64>>(2)?,
                    row.get::<_, Option<i64>>(3)?,
                    row.get::<_, Option<i64>>(4)?,
                ))
            },
        )
        .optional()?;

    let Some((parse_error, source_size, source_mtime, snapshot_size, snapshot_mtime)) = stored
    else {
        return Ok(false);
    };
    if parse_error.as_deref().is_some_and(|e| !e.is_empty()) {
        return Ok(false);
    }

    Ok(source_size == Some(source_meta.size_bytes)
        && source_mtime == source_meta.mtime_ms
        && snapshot_size == snapshot_meta.map(|m| m.size_bytes)
        && snapshot_mtime == snapshot_meta.and_then(|m| m.mtime_ms))
}

fn file_mtime_ms(path: &str) -> Option<i64> {
    let meta = std::fs::metadata(path).ok()?;
    metadata_mtime_ms(&meta)
}

fn upsert_videos(conn: &Connection, m: &MatchRecord, now: i64) -> rusqlite::Result<usize> {
    // Replace the match video set (same pattern as events): drop stale rows first
    // so stats/`videos` no longer retain highlights ACLOS removed from the match.
    conn.execute(
        "DELETE FROM videos WHERE match_id = ?1 AND source_id = ?2",
        params![m.matches_id.as_str(), ACLOS_SOURCE_ID],
    )?;
    let mut count = 0;
    for v in &m.videos {
        let exists = std::path::Path::new(&v.video_src).exists();
        let mtime = if exists {
            file_mtime_ms(&v.video_src)
        } else {
            None
        };
        conn.execute(
            "INSERT INTO videos(
                id, match_id, source_id, source_video_id, video_type, name, path,
                poster_path, duration_ms, fps, resolution, size_bytes, mtime_ms,
                video_hash, cover_hash, exists_on_disk, last_seen_at
             )
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
            params![
                v.video_id,
                m.matches_id,
                ACLOS_SOURCE_ID,
                v.video_id,
                v.video_type,
                v.video_name,
                v.video_src,
                v.video_poster,
                v.video_duration,
                v.video_fps,
                v.video_resolution,
                v.video_size,
                mtime,
                v.video_hash,
                v.cover_hash,
                if exists { 1 } else { 0 },
                now,
            ],
        )?;
        count += 1;
    }
    Ok(count)
}

fn upsert_events(conn: &Connection, m: &MatchRecord) -> rusqlite::Result<usize> {
    conn.execute(
        "DELETE FROM events WHERE match_id = ?1",
        params![m.matches_id.as_str()],
    )?;
    let events = normalize_match_events(m);
    for ev in &events {
        let id_hash = sha256_hex(&format!("{}|{}", m.matches_id, ev.dedup_key));
        let id = format!("{}:{}", m.matches_id, &id_hash[..16]);
        conn.execute(
            "INSERT INTO events(
                id, match_id, video_id, source_event_id, event_type, event_time,
                time_ms, seek_ms, playback_seek_ms, round_idx, player_name,
                killer_name, killed_name, agent_name, weapon_path, weapon_name,
                is_headshot, assist_num, confidence, dedup_key, raw_json
             )
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
                    ?15, ?16, ?17, ?18, ?19, ?20, ?21)",
            params![
                id,
                m.matches_id.as_str(),
                ev.video_id.as_str(),
                ev.source_event_id.as_str(),
                ev.event_type.as_str(),
                ev.event_time.as_deref(),
                ev.time_ms,
                ev.seek_ms,
                ev.playback_seek_ms,
                ev.round_idx as i64,
                ev.player_name.as_str(),
                ev.killer_name.as_str(),
                ev.killed_name.as_str(),
                ev.agent_name.as_str(),
                ev.weapon_path.as_str(),
                ev.weapon_name.as_str(),
                if ev.is_headshot { 1 } else { 0 },
                ev.assist_num,
                100,
                ev.dedup_key.as_str(),
                ev.raw_json.as_deref(),
            ],
        )?;
    }
    Ok(events.len())
}

#[cfg(test)]
pub fn scrape_wonderful_dir(
    conn: &Connection,
    dir: &Path,
    trigger: &str,
) -> Result<ScrapeSummary, String> {
    scrape_wonderful_dir_with_mode(conn, dir, trigger, ScrapeMode::Full, None)
}

pub fn scrape_wonderful_dir_with_mode(
    conn: &Connection,
    dir: &Path,
    trigger: &str,
    mode: ScrapeMode,
    app: Option<&tauri::AppHandle>,
) -> Result<ScrapeSummary, String> {
    let _scrape_guard = SCRAPE_LOCK
        .lock()
        .map_err(|e| format!("scrape lock poisoned: {e}"))?;
    let start_ms = now_ms();
    let now = start_ms;

    if let Some(a) = app {
        let _ = a.emit(
            "wui://phase",
            ScrapePhaseEvent {
                phase: "opening".into(),
                label: "打开资料库".into(),
                sub: None,
            },
        );
    }

    upsert_source(conn, dir, now).map_err(|e| e.to_string())?;
    let job_id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO scrape_jobs(id, source_id, trigger, started_at, status)
         VALUES(?1, ?2, ?3, ?4, 'running')",
        params![job_id, ACLOS_SOURCE_ID, trigger, now],
    )
    .map_err(|e| e.to_string())?;

    // Build once per scrape (shared across rayon workers). Read-only scan of
    // ACLOS Electron caches; never blocks on missing APPDATA/ACLOS.
    let identity = Arc::new(AclosIdentityIndex::load_default());

    let mut summary = ScrapeSummary::default();
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) => {
            let message = format!("read_dir({}): {}", dir.display(), e);
            mark_scrape_job_failed(conn, &job_id, &message);
            return Err(message);
        }
    };

    // Pre-enumerate account files for progress reporting.
    let mut account_files: Vec<(String, std::path::PathBuf, Option<SourceFileMeta>)> = Vec::new();
    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(e) => {
                let message = format!("enumerate {}: {e}", dir.display());
                mark_scrape_job_failed(conn, &job_id, &message);
                return Err(message);
            }
        };
        if !is_account_file(&entry) {
            continue;
        }
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        let path = entry.path();
        let meta = source_file_meta(&path);
        account_files.push((name_str.into_owned(), path, meta));
    }

    let total_accounts = account_files.len();
    let total_size: i64 = account_files
        .iter()
        .filter_map(|(_, _, m)| m.map(|x| x.size_bytes))
        .sum();
    let mut size_done: i64 = 0;

    if let Some(a) = app {
        let _ = a.emit(
            "wui://phase",
            ScrapePhaseEvent {
                phase: "scanning".into(),
                label: "扫描账户".into(),
                sub: if total_accounts > 0 {
                    Some(format!(
                        "{} 个账户 · {} MB",
                        total_accounts,
                        total_size / 1_048_576
                    ))
                } else {
                    Some("未发现账户数据".into())
                },
            },
        );
    }

    // Phase A: identify accounts to parse vs skip
    let mut to_parse: Vec<(usize, &(String, std::path::PathBuf, Option<SourceFileMeta>))> =
        Vec::new();
    for (idx, item) in account_files.iter().enumerate() {
        let (openid, _path, source_meta) = item;
        let snapshot_meta = snapshot_file_meta(dir, openid);

        if matches!(mode, ScrapeMode::Incremental)
            && source_meta
                .map(|meta| account_is_fresh(conn, openid, meta, snapshot_meta))
                .transpose()
                .map_err(|e| e.to_string())?
                .unwrap_or(false)
        {
            // skip — handled in Phase C
        } else {
            to_parse.push((idx, item));
        }
    }

    // Phase B: parallel parsing
    struct ParsedAccount {
        idx: usize,
        openid: String,
        path: std::path::PathBuf,
        source_meta: Option<SourceFileMeta>,
        result: Result<crate::parser::model::WonderfulDbFile, String>,
        nick: Option<String>,
        tag: Option<String>,
        achievements: Vec<SnapshotAchievement>,
        snapshot_meta: Option<SourceFileMeta>,
    }

    let identity_for_parse = Arc::clone(&identity);
    let parsed: Vec<ParsedAccount> = to_parse
        .par_iter()
        .map(|&(idx, (openid, path, source_meta))| {
            let snapshot_meta = snapshot_file_meta(dir, openid);
            let (nick, tag, achievements) =
                read_snapshot_for_account(dir, openid, identity_for_parse.as_ref());
            let result = parser::parse_wonderful_db(path, openid)
                .map_err(|e| format!("parse {}: {}", path.display(), e));
            ParsedAccount {
                idx,
                openid: openid.clone(),
                path: path.clone(),
                source_meta: *source_meta,
                result,
                nick,
                tag,
                achievements,
                snapshot_meta,
            }
        })
        .collect();

    let mut parsed = parsed;
    parsed.sort_by_key(|p| p.idx);

    // Phase C: sequential processing in original index order
    let mut pi = 0;
    for (idx, (openid, _path, source_meta)) in account_files.iter().enumerate() {
        let current = idx + 1;
        let processed_size_done = progress_after_file(size_done, *source_meta);

        if pi >= parsed.len() || parsed[pi].idx != idx {
            // Account was skipped (incremental freshness) — still refresh
            // nick/tag from LevelDB identity (no WonderfulDb re-parse).
            summary.skipped_accounts += 1;
            // Count skipped files toward progress so size_done reaches total.
            size_done = processed_size_done;
            let hint = identity.lookup(openid);
            if hint.nick.is_some() || hint.tag.is_some() {
                let _ = refresh_account_identity(
                    conn,
                    openid,
                    hint.nick.as_deref(),
                    hint.tag.as_deref(),
                    now,
                );
            }
            if let Some(a) = app {
                let _ = a.emit(
                    "wui://account_finished",
                    AccountFinishedEvent {
                        openid: openid.clone(),
                        status: "skipped".into(),
                        current,
                        total: total_accounts,
                        size_bytes_done: size_done,
                        size_bytes_total: total_size,
                        error: None,
                    },
                );
            }
            continue;
        }

        let pa = &parsed[pi];
        pi += 1;

        if let Some(a) = app {
            let _ = a.emit(
                "wui://account_started",
                AccountStartedEvent {
                    openid: pa.openid.clone(),
                    current,
                    total: total_accounts,
                    size_bytes_done: size_done,
                    size_bytes_total: total_size,
                },
            );
        }
        let account_start = now_ms();

        match &pa.result {
            Ok(file) => {
                let persisted = (|| -> Result<(usize, usize, usize), String> {
                    let tx = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)
                        .map_err(|e| e.to_string())?;

                    // Empty highlight shells (common 96-byte WonderfulDb files): do not
                    // keep them in the library — this app only surfaces accounts with
                    // at least one match/video payload.
                    if file.matches.is_empty() {
                        purge_empty_account(&tx, &pa.openid).map_err(|e| e.to_string())?;
                        tx.commit().map_err(|e| e.to_string())?;
                        return Ok((0, 0, 0));
                    }

                    upsert_account(
                        &tx,
                        &pa.openid,
                        &pa.path,
                        pa.source_meta,
                        pa.snapshot_meta,
                        pa.nick.clone(),
                        pa.tag.clone(),
                        &pa.achievements,
                        None,
                        now,
                    )
                    .map_err(|e| e.to_string())?;

                    let mut videos = 0usize;
                    let mut events = 0usize;
                    for m in &file.matches {
                        upsert_match(&tx, m, now).map_err(|e| e.to_string())?;
                        videos += upsert_videos(&tx, m, now).map_err(|e| e.to_string())?;
                        events += upsert_events(&tx, m).map_err(|e| e.to_string())?;
                    }
                    let current_ids: HashSet<&str> =
                        file.matches.iter().map(|m| m.matches_id.as_str()).collect();
                    purge_stale_matches(&tx, &pa.openid, &current_ids)
                        .map_err(|e| e.to_string())?;
                    tx.commit().map_err(|e| e.to_string())?;
                    Ok((file.matches.len(), videos, events))
                })();

                let (acc_matches, acc_videos, acc_events) = match persisted {
                    Ok(counts) => counts,
                    Err(e) => {
                        let message = format!("persist account {}: {e}", pa.openid);
                        mark_scrape_job_failed(conn, &job_id, &message);
                        if let Some(a) = app {
                            let _ = a.emit(
                                "wui://phase",
                                ScrapePhaseEvent {
                                    phase: "error".into(),
                                    label: "资料库写入失败".into(),
                                    sub: Some(message.clone()),
                                },
                            );
                        }
                        return Err(message);
                    }
                };

                if acc_matches == 0 {
                    let acc_duration = now_ms() - account_start;
                    if let Some(a) = app {
                        let _ = a.emit(
                            "wui://account_finished",
                            AccountFinishedEvent {
                                openid: pa.openid.clone(),
                                status: "empty".into(),
                                current,
                                total: total_accounts,
                                size_bytes_done: processed_size_done,
                                size_bytes_total: total_size,
                                error: None,
                            },
                        );
                        let _ = a.emit(
                            "wui://account_loaded",
                            AccountLoadedEvent {
                                openid: pa.openid.clone(),
                                matches_count: 0,
                                videos_count: 0,
                                events_count: 0,
                                status: "empty".into(),
                                error: None,
                                duration_ms: acc_duration,
                                current,
                                total: total_accounts,
                            },
                        );
                    }
                } else {
                    summary.matches_seen += acc_matches;
                    summary.videos_seen += acc_videos;
                    summary.events_seen += acc_events;
                    let acc_duration = now_ms() - account_start;
                    if let Some(a) = app {
                        let _ = a.emit(
                            "wui://account_finished",
                            AccountFinishedEvent {
                                openid: pa.openid.clone(),
                                status: "ok".into(),
                                current,
                                total: total_accounts,
                                size_bytes_done: processed_size_done,
                                size_bytes_total: total_size,
                                error: None,
                            },
                        );
                        let _ = a.emit(
                            "wui://account_loaded",
                            AccountLoadedEvent {
                                openid: pa.openid.clone(),
                                matches_count: acc_matches,
                                videos_count: acc_videos,
                                events_count: acc_events,
                                status: "ok".into(),
                                error: None,
                                duration_ms: acc_duration,
                                current,
                                total: total_accounts,
                            },
                        );
                    }
                }
            }
            Err(e) => {
                let persisted_error = (|| -> rusqlite::Result<()> {
                    let tx = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)?;
                    upsert_account(
                        &tx,
                        &pa.openid,
                        &pa.path,
                        pa.source_meta,
                        pa.snapshot_meta,
                        pa.nick.clone(),
                        pa.tag.clone(),
                        &pa.achievements,
                        Some(e.as_str()),
                        now,
                    )?;
                    tx.commit()
                })();
                if let Err(db_error) = persisted_error {
                    let message = format!("persist parse error for {}: {db_error}", pa.openid);
                    mark_scrape_job_failed(conn, &job_id, &message);
                    return Err(message);
                }
                summary.errors_seen += 1;
                let acc_duration = now_ms() - account_start;
                if let Some(a) = app {
                    let _ = a.emit(
                        "wui://account_finished",
                        AccountFinishedEvent {
                            openid: pa.openid.clone(),
                            status: "error".into(),
                            current,
                            total: total_accounts,
                            size_bytes_done: processed_size_done,
                            size_bytes_total: total_size,
                            error: Some(e.clone()),
                        },
                    );
                    let _ = a.emit(
                        "wui://account_loaded",
                        AccountLoadedEvent {
                            openid: pa.openid.clone(),
                            matches_count: 0,
                            videos_count: 0,
                            events_count: 0,
                            status: "error".into(),
                            error: Some(e.clone()),
                            duration_ms: acc_duration,
                            current,
                            total: total_accounts,
                        },
                    );
                }
            }
        }
        size_done = processed_size_done;
    }

    let duration_ms = now_ms() - start_ms;
    summary.size_bytes_done = size_done;
    summary.size_bytes_total = total_size;

    if let Some(a) = app {
        let _ = a.emit(
            "wui://scrape_summary",
            ScrapeSummaryEventData {
                matches_seen: summary.matches_seen,
                videos_seen: summary.videos_seen,
                events_seen: summary.events_seen,
                errors_seen: summary.errors_seen,
                skipped_accounts: summary.skipped_accounts,
                duration_ms,
            },
        );
    }

    let status = if summary.errors_seen > 0 {
        "partial"
    } else {
        "success"
    };
    conn.execute(
        "UPDATE scrape_jobs
         SET finished_at = ?1, status = ?2, matches_seen = ?3, videos_seen = ?4,
             events_seen = ?5, skipped_accounts = ?6, errors_seen = ?7
         WHERE id = ?8",
        params![
            now_ms(),
            status,
            summary.matches_seen as i64,
            summary.videos_seen as i64,
            summary.events_seen as i64,
            summary.skipped_accounts as i64,
            summary.errors_seen as i64,
            job_id,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(summary)
}

/// ACLOS account payloads are regular files whose entire basename is a
/// decimal openid. Keep this predicate shared with the lightweight boot probe
/// so onboarding and the real scraper cannot disagree about whether data is
/// present. Symlinks and numeric directory names are intentionally rejected.
pub(crate) fn is_account_file(entry: &std::fs::DirEntry) -> bool {
    entry.file_type().is_ok_and(|kind| kind.is_file()) && is_account_filename(&entry.file_name())
}

fn is_account_filename(name: &std::ffi::OsStr) -> bool {
    name.to_str()
        .is_some_and(|value| !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::db::{migrate, open_memory_for_test};
    use std::path::PathBuf;

    fn fixture_dir() -> PathBuf {
        if let Ok(dir) = std::env::var("WONDERFUL_DB_DIR") {
            PathBuf::from(dir)
        } else {
            let base = std::env::var("USERPROFILE")
                .or_else(|_| std::env::var("HOME"))
                .unwrap_or_default();
            PathBuf::from(base).join(r"AppData\Roaming\ACLOS\WonderfulDb")
        }
    }

    #[test]
    fn completed_file_progress_includes_the_current_account_bytes() {
        let meta = SourceFileMeta {
            size_bytes: 3_753_199,
            mtime_ms: Some(1),
        };
        assert_eq!(progress_after_file(1024, Some(meta)), 3_754_223);
        assert_eq!(progress_after_file(1024, None), 1024);
        assert_eq!(progress_after_file(i64::MAX - 2, Some(meta)), i64::MAX);
    }

    #[test]
    fn scrape_real_wonderfuldb_is_idempotent_when_fixture_exists() {
        let dir = fixture_dir();
        if !dir.join("4807045517549591240").exists() {
            eprintln!("skip: real WonderfulDb fixture not present");
            return;
        }

        let conn = open_memory_for_test().expect("memory db opens");
        migrate(&conn).expect("migration succeeds");

        let first = scrape_wonderful_dir(&conn, &dir, "manual").expect("first scrape succeeds");
        let second = scrape_wonderful_dir(&conn, &dir, "manual").expect("second scrape succeeds");

        assert!(first.matches_seen >= 1);
        assert_eq!(first.matches_seen, second.matches_seen);

        let match_rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM matches", [], |row| row.get(0))
            .expect("count matches");
        let distinct_matches: i64 = conn
            .query_row("SELECT COUNT(DISTINCT id) FROM matches", [], |row| {
                row.get(0)
            })
            .expect("count distinct matches");
        assert_eq!(match_rows, distinct_matches);
    }

    #[test]
    fn load_library_view_returns_scraped_matches_when_fixture_exists() {
        let dir = fixture_dir();
        if !dir.join("4807045517549591240").exists() {
            eprintln!("skip: real WonderfulDb fixture not present");
            return;
        }

        let conn = open_memory_for_test().expect("memory db opens");
        migrate(&conn).expect("migration succeeds");
        scrape_wonderful_dir(&conn, &dir, "manual").expect("scrape succeeds");

        let view = crate::library::db::load_library_view(&conn, dir.to_string_lossy())
            .expect("load view succeeds");
        assert!(!view.accounts.is_empty());
        assert!(!view.matches.is_empty());
        assert!(view
            .matches
            .iter()
            .all(|m| m.videos.iter().all(|v| v.rounds.is_empty())));
        assert!(view.accounts.iter().any(|a| !a.achievements.is_empty()));
    }

    #[test]
    fn load_match_rounds_returns_full_rounds_from_library_when_fixture_exists() {
        let dir = fixture_dir();
        if !dir.join("4807045517549591240").exists() {
            eprintln!("skip: real WonderfulDb fixture not present");
            return;
        }

        let conn = open_memory_for_test().expect("memory db opens");
        migrate(&conn).expect("migration succeeds");
        scrape_wonderful_dir(&conn, &dir, "manual").expect("scrape succeeds");

        let view = crate::library::db::load_library_view(&conn, dir.to_string_lossy())
            .expect("load view succeeds");
        // Prefer a known fixture openid when it still has highlight data; otherwise
        // any scraped match (some local accounts may only retain empty 96-byte shells).
        let bulk_match = view
            .matches
            .iter()
            .find(|m| m.open_id == "4807045517549591240")
            .or_else(|| view.matches.first())
            .expect("scraped library has at least one match");
        assert!(bulk_match.videos.iter().all(|v| v.rounds.is_empty()));

        let full = crate::library::db::load_match_rounds(
            &conn,
            &bulk_match.open_id,
            &bulk_match.matches_id,
        )
        .expect("full match loads from sqlite");

        assert_eq!(full.matches_id, bulk_match.matches_id);
        assert!(full.videos.iter().any(|v| !v.rounds.is_empty()));
    }

    #[test]
    fn scrape_persists_normalized_events_when_fixture_exists() {
        let dir = fixture_dir();
        if !dir.join("4807045517549591240").exists() {
            eprintln!("skip: real WonderfulDb fixture not present");
            return;
        }

        let conn = open_memory_for_test().expect("memory db opens");
        migrate(&conn).expect("migration succeeds");
        let summary = scrape_wonderful_dir(&conn, &dir, "manual").expect("scrape succeeds");

        let event_rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM events", [], |row| row.get(0))
            .expect("count normalized events");
        let duplicate_dedup_keys: i64 = conn
            .query_row(
                "SELECT COUNT(*)
                 FROM (
                   SELECT match_id, dedup_key
                   FROM events
                   GROUP BY match_id, dedup_key
                   HAVING COUNT(*) > 1
                 )",
                [],
                |row| row.get(0),
            )
            .expect("count duplicate dedup keys");

        assert!(
            event_rows > 0,
            "scrape should persist normalized event rows"
        );
        assert_eq!(summary.events_seen as i64, event_rows);
        assert_eq!(duplicate_dedup_keys, 0);
    }

    #[test]
    fn scrape_records_account_error_when_account_file_fails_to_parse() {
        let dir = std::env::temp_dir().join(format!("wonderful-ui-bad-aclos-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("temp dir created");
        let account_path = dir.join("1234567890");
        std::fs::write(&account_path, b"not hex").expect("bad fixture written");

        let conn = open_memory_for_test().expect("memory db opens");
        migrate(&conn).expect("migration succeeds");

        let summary = scrape_wonderful_dir(&conn, &dir, "manual").expect("scrape completes");
        let view = crate::library::db::load_library_view(&conn, dir.to_string_lossy())
            .expect("load view succeeds");

        std::fs::remove_dir_all(&dir).expect("temp dir removed");

        assert_eq!(summary.errors_seen, 1);
        assert_eq!(view.total_errors, 1);
        assert_eq!(view.accounts.len(), 1);
        assert_eq!(view.accounts[0].openid, "1234567890");
        assert_eq!(view.accounts[0].match_count, 0);
        assert!(view.accounts[0]
            .error
            .as_deref()
            .is_some_and(|e| e.contains("parse")));
    }

    #[test]
    fn incremental_scrape_skips_unchanged_account_without_reparsing() {
        let dir =
            std::env::temp_dir().join(format!("wonderful-ui-incremental-skip-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("temp dir created");
        let account_path = dir.join("1234567890");
        std::fs::write(&account_path, b"not hex").expect("bad fixture written");
        let meta = std::fs::metadata(&account_path).expect("fixture metadata");
        let source_mtime_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64);

        let conn = open_memory_for_test().expect("memory db opens");
        migrate(&conn).expect("migration succeeds");
        conn.execute(
            "INSERT INTO accounts(
                openid, source_id, source_path, source_size_bytes, source_mtime_ms, last_seen_at
             )
             VALUES(?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                "1234567890",
                ACLOS_SOURCE_ID,
                account_path.to_string_lossy(),
                meta.len() as i64,
                source_mtime_ms,
                now_ms(),
            ],
        )
        .expect("seed unchanged account");

        let summary =
            scrape_wonderful_dir_with_mode(&conn, &dir, "manual", ScrapeMode::Incremental, None)
                .expect("incremental scrape succeeds");
        let status: String = conn
            .query_row(
                "SELECT status FROM scrape_jobs ORDER BY started_at DESC LIMIT 1",
                [],
                |row| row.get(0),
            )
            .expect("job status exists");

        std::fs::remove_dir_all(&dir).expect("temp dir removed");

        assert_eq!(summary.skipped_accounts, 1);
        assert_eq!(summary.errors_seen, 0);
        assert_eq!(summary.matches_seen, 0);
        assert_eq!(status, "success");
        // Skipped accounts still count toward progress so the bar reaches 100%.
        assert_eq!(summary.size_bytes_total, meta.len() as i64);
        assert_eq!(
            summary.size_bytes_done, summary.size_bytes_total,
            "skipped account size must be included in size_bytes_done"
        );
    }

    #[test]
    fn full_scrape_reparses_unchanged_account() {
        let dir = std::env::temp_dir().join(format!("wonderful-ui-full-rescan-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("temp dir created");
        let account_path = dir.join("1234567890");
        std::fs::write(&account_path, b"not hex").expect("bad fixture written");
        let meta = std::fs::metadata(&account_path).expect("fixture metadata");
        let source_mtime_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64);

        let conn = open_memory_for_test().expect("memory db opens");
        migrate(&conn).expect("migration succeeds");
        conn.execute(
            "INSERT INTO accounts(
                openid, source_id, source_path, source_size_bytes, source_mtime_ms, last_seen_at
             )
             VALUES(?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                "1234567890",
                ACLOS_SOURCE_ID,
                account_path.to_string_lossy(),
                meta.len() as i64,
                source_mtime_ms,
                now_ms(),
            ],
        )
        .expect("seed unchanged account");

        let summary = scrape_wonderful_dir_with_mode(&conn, &dir, "manual", ScrapeMode::Full, None)
            .expect("full scrape completes");

        std::fs::remove_dir_all(&dir).expect("temp dir removed");

        assert_eq!(summary.skipped_accounts, 0);
        assert_eq!(summary.errors_seen, 1);
    }

    #[test]
    fn scrape_marks_job_failed_when_source_dir_cannot_be_read() {
        let dir = std::env::temp_dir().join(format!("wonderful-ui-missing-{}", Uuid::new_v4()));
        let conn = open_memory_for_test().expect("memory db opens");
        migrate(&conn).expect("migration succeeds");

        let err = scrape_wonderful_dir(&conn, &dir, "manual").expect_err("missing dir errors");
        let status: String = conn
            .query_row("SELECT status FROM scrape_jobs", [], |row| row.get(0))
            .expect("job status exists");
        let message: String = conn
            .query_row("SELECT message FROM scrape_jobs", [], |row| row.get(0))
            .expect("job message exists");

        assert!(err.contains("read_dir"), "{err}");
        assert_eq!(status, "failed");
        assert!(message.contains("read_dir"), "{message}");
    }

    #[test]
    fn upsert_videos_removes_orphan_rows_for_match() {
        use crate::parser::model::{MatchRecord, VideoItem};

        let conn = open_memory_for_test().expect("memory db opens");
        migrate(&conn).expect("migration succeeds");

        // Stale video no longer present in the match payload.
        conn.execute(
            "INSERT INTO videos(
                id, match_id, source_id, source_video_id, video_type, name, path,
                duration_ms, fps, size_bytes, exists_on_disk, last_seen_at
             )
             VALUES('old-v', 'match-1', ?1, 'old-v', '击杀集锦', 'old', 'Z:\\old.mp4',
                    1000, 60, 1, 0, 1)",
            params![ACLOS_SOURCE_ID],
        )
        .expect("seed orphan video");

        let m = MatchRecord {
            matches_id: "match-1".into(),
            videos: vec![VideoItem {
                video_id: "new-v".into(),
                video_type: "击杀集锦".into(),
                video_name: "new".into(),
                video_src: "Z:\\new.mp4".into(),
                video_duration: 2000,
                video_fps: 60,
                video_size: 2,
                ..Default::default()
            }],
            ..Default::default()
        };

        let n = upsert_videos(&conn, &m, now_ms()).expect("upsert videos");
        assert_eq!(n, 1);

        let rows: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM videos WHERE match_id = 'match-1'",
                [],
                |row| row.get(0),
            )
            .expect("count videos");
        assert_eq!(rows, 1);

        let kept: String = conn
            .query_row(
                "SELECT source_video_id FROM videos WHERE match_id = 'match-1'",
                [],
                |row| row.get(0),
            )
            .expect("kept id");
        assert_eq!(kept, "new-v");
    }

    #[test]
    fn purge_stale_matches_removes_dependent_rows_only_for_target_account() {
        let conn = open_memory_for_test().expect("memory db opens");
        migrate(&conn).expect("migration succeeds");
        conn.execute(
            "INSERT INTO matches(id, source_id, source_match_id, openid, matches_time, stats_json, raw_json, last_seen_at)
             VALUES
             ('keep', ?1, 'keep', 'account-a', 2, '{}', '{}', 2),
             ('stale', ?1, 'stale', 'account-a', 1, '{}', '{}', 1),
             ('other', ?1, 'other', 'account-b', 1, '{}', '{}', 1)",
            params![ACLOS_SOURCE_ID],
        )
        .expect("seed matches");
        conn.execute(
            "INSERT INTO videos(id, match_id, source_id, source_video_id, last_seen_at)
             VALUES('stale-video', 'stale', ?1, 'stale-video', 1)",
            params![ACLOS_SOURCE_ID],
        )
        .expect("seed stale video");
        conn.execute(
            "INSERT INTO events(id, match_id, video_id, event_type, time_ms, seek_ms, playback_seek_ms, round_idx, dedup_key)
             VALUES('stale-event', 'stale', 'stale-video', 'kill', 1, 1, 1, 0, 'stale')",
            [],
        )
        .expect("seed stale event");

        let current = HashSet::from(["keep"]);
        let removed =
            purge_stale_matches(&conn, "account-a", &current).expect("stale rows are removed");
        assert_eq!(removed, 1);

        let remaining: Vec<String> = {
            let mut stmt = conn
                .prepare("SELECT id FROM matches ORDER BY id")
                .expect("prepare");
            stmt.query_map([], |row| row.get(0))
                .expect("query")
                .collect::<rusqlite::Result<Vec<_>>>()
                .expect("collect")
        };
        assert_eq!(remaining, vec!["keep", "other"]);
        let dependent_rows: i64 = conn
            .query_row(
                "SELECT (SELECT COUNT(*) FROM videos WHERE match_id = 'stale') +
                        (SELECT COUNT(*) FROM events WHERE match_id = 'stale')",
                [],
                |row| row.get(0),
            )
            .expect("count dependents");
        assert_eq!(dependent_rows, 0);
    }
}
