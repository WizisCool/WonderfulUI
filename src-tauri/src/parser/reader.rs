//! Parse pipeline: read a WonderfulDb file, decrypt it, build the model.
//!
//! Matches the TS parser 1:1 in behavior:
//!   1. Read file as bytes (the file is ASCII hex)
//!   2. UTF-8 decode the bytes -> hex string
//!   3. Hex-decode the string -> ciphertext bytes
//!   4. AES-256-CBC decrypt (PKCS7) -> plaintext bytes
//!   5. UTF-8 decode plaintext -> JSON string
//!   6. Parse JSON, look up `key_wonderful_list_<openid>` (or first array)
//!   7. Deserialize to Vec<MatchRecord>
//!
//! Same scheme decrypts the per-account `snapshot<openid>` file, whose top
//! level key is `key_snapshot_list<openid>` (note: no separator) and whose
//! records carry the player's display name under `snapshot.ss_nick` /
//! `snapshot.ss_nick_id`. See `parse_snapshot_db`.

use crate::parser::crypto::{aes_decrypt, derive_key_iv};
use crate::parser::error::ParseError;
use crate::parser::hex::decode_hex;
use crate::parser::model::{MatchRecord, WonderfulDbFile, SnapshotAchievement};
use std::path::Path;

/// Parse a WonderfulDb file. `openid` is the file name without path
/// (ACLOS uses the openid as the file name with no extension).
pub fn parse_wonderful_db(path: &Path, openid: &str) -> Result<WonderfulDbFile, ParseError> {
    let bytes = std::fs::read(path)?;
    let hex_text = std::str::from_utf8(&bytes).map_err(|e| ParseError::Crypto(format!("file is not valid UTF-8: {}", e)))?;
    let cipher = decode_hex(hex_text)?;

    let (key, iv) = derive_key_iv(openid);
    let plain = aes_decrypt(&cipher, &key, &iv)?;
    let json_text = String::from_utf8(plain)?;
    parse_json(&json_text, openid)
}

fn parse_json(json_text: &str, openid: &str) -> Result<WonderfulDbFile, ParseError> {
    let raw: serde_json::Value = serde_json::from_str(json_text)?;
    let obj = raw.as_object().ok_or(ParseError::NotAnObject)?;

    let expected_key = format!("key_wonderful_list_{}", openid);
    let list_value = obj
        .get(&expected_key)
        .or_else(|| obj.values().find(|v| v.is_array()))
        .ok_or_else(|| ParseError::NoMatchList(expected_key.clone()))?;

    let matches: Vec<MatchRecord> = serde_json::from_value(list_value.clone())?;
    Ok(WonderfulDbFile {
        key: expected_key,
        matches,
        raw: Some(raw),
    })
}

/// In-game display name + #tag + per-match achievements extracted from a
/// `snapshot<openid>` file. Any field can be missing when the snapshot file
/// is empty or has no matching records.
#[derive(Debug, Clone, Default)]
pub struct SnapshotData {
    pub nick: Option<String>,
    pub tag: Option<String>,
    pub achievements: Vec<SnapshotAchievement>,
}

/// Parse the per-account `snapshot<openid>` file. Same AES scheme as
/// `parse_wonderful_db`. The top-level key is `key_snapshot_list<openid>`
/// (no separator — unlike the wonderful-list key). Each record has a
/// `snapshot` sub-object whose `ss_nick` / `ss_nick_id` give the player's
/// own display name and #tag; records with `ss_achieve_type === "mvp"` or
/// `"svp"` are collected as per-match achievements.
///
/// Returns `Ok(SnapshotData::default())` when the file is missing, empty,
/// or has no `ss_nick` / `ss_nick_id` — never an error.
pub fn parse_snapshot_db(path: &Path, openid: &str) -> Result<SnapshotData, ParseError> {
    let bytes = match std::fs::read(path) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(SnapshotData::default()),
        Err(e) => return Err(e.into()),
    };
    let hex_text = std::str::from_utf8(&bytes)
        .map_err(|e| ParseError::Crypto(format!("file is not valid UTF-8: {}", e)))?;
    let cipher = match decode_hex(hex_text) {
        Ok(c) => c,
        // Snapshot files written when ACLOS has nothing to save are exactly
        // 48 bytes of hex → 1 block. Treat anything too short to decrypt as
        // "no nick" rather than blowing up the whole account.
        Err(_) => return Ok(SnapshotData::default()),
    };
    if cipher.is_empty() {
        return Ok(SnapshotData::default());
    }
    let (key, iv) = derive_key_iv(openid);
    let plain = match aes_decrypt(&cipher, &key, &iv) {
        Ok(p) => p,
        Err(_) => return Ok(SnapshotData::default()),
    };
    let json_text = match String::from_utf8(plain) {
        Ok(s) => s,
        Err(_) => return Ok(SnapshotData::default()),
    };
    let raw: serde_json::Value = match serde_json::from_str(&json_text) {
        Ok(v) => v,
        Err(_) => return Ok(SnapshotData::default()),
    };
    let obj = match raw.as_object() {
        Some(o) => o,
        None => return Ok(SnapshotData::default()),
    };
    // Try the known key first, then fall back to "first array value" so we
    // stay robust against ACLOS renaming the key prefix.
    let expected_key = format!("key_snapshot_list{}", openid);
    let list = obj
        .get(&expected_key)
        .or_else(|| obj.values().find(|v| v.is_array()));

    let Some(list) = list.and_then(|v| v.as_array()) else {
        return Ok(SnapshotData::default());
    };

    let mut nick: Option<String> = None;
    let mut tag: Option<String> = None;
    let mut achievements: Vec<SnapshotAchievement> = Vec::new();

    for rec in list {
        let snap = rec.get("snapshot").and_then(|v| v.as_object());
        let Some(snap) = snap else { continue };
        // nick/tag: pick from the first record that has them
        if nick.is_none() && tag.is_none() {
            nick = snap
                .get("ss_nick")
                .and_then(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
            tag = snap
                .get("ss_nick_id")
                .and_then(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
        }
        // MVP/SVP: only collect when ss_achieve_type is mvp or svp
        let achv = snap
            .get("ss_achieve_type")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if achv != "mvp" && achv != "svp" {
            continue;
        }
        let mid = rec
            .get("matches_id")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if mid.is_empty() {
            continue;
        }
        let type_str = snap
            .get("ss_type_str")
            .and_then(|v| v.as_str())
            .unwrap_or(achv)
            .to_string();
        achievements.push(SnapshotAchievement {
            matches_id: mid.to_string(),
            achv_type: achv.to_string(),
            type_str,
        });
    }

    Ok(SnapshotData { nick, tag, achievements })
}

// ─── tests ────────────────────────────────────────────────────────────────
//
// Mirror `packages/parser/tests/reader.test.ts` — these hit real ACLOS files
// at the user's %APPDATA% so the Rust output is checked against a known
// working set. Tests are no-ops if the files aren't present (CI, fresh
// machines, etc.).

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::model::VideoItem;
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

    fn fixture_path(suffix: &str) -> String {
        let mut p = fixture_dir();
        p.push(suffix);
        p.to_string_lossy().to_string()
    }

    const REAL_DBS: &[(&str, &str, usize, &str)] = &[
        (
            "4807045517549591240",
            "4807045517549591240",
            40,
            "Cypher",
        ),
        (
            "14121192131852595386",
            "14121192131852595386",
            1,
            "",
        ),
        (
            "13794749312275947089",
            "13794749312275947089",
            1,
            "",
        ),
    ];

    const REAL_SNAPSHOTS: &[(&str, &str, &str, &str)] = &[
        // path_suffix, openid, expected nick, expected tag
        (
            "snapshot4807045517549591240",
            "4807045517549591240",
            "超雄小猫咪",
            "13949",
        ),
        (
            "snapshot14121192131852595386",
            "14121192131852595386",
            "相对论I",
            "65174",
        ),
        (
            // 1379... has a 96-byte snapshot = `{"key_snapshot_list1379…":[]}` → no nick
            "snapshot13794749312275947089",
            "13794749312275947089",
            "",
            "",
        ),
        (
            // 1228... is a legacy account whose WonderfulDb has zero matches;
            // the snapshot file is exactly 48 bytes of ciphertext (empty
            // JSON). parse_snapshot_db must return (None, None), not error.
            "snapshot1228584785010313960",
            "1228584785010313960",
            "",
            "",
        ),
    ];

    #[test]
    fn hex_decode_roundtrip_and_errors() {
        assert_eq!(decode_hex("").unwrap(), Vec::<u8>::new());
        assert_eq!(decode_hex("48656c6c6f").unwrap(), b"Hello");
        assert_eq!(decode_hex("00ff").unwrap(), vec![0x00, 0xff]);
        assert_eq!(decode_hex("00FF").unwrap(), vec![0x00, 0xff]);
        assert!(decode_hex("abc").is_err());
        assert!(decode_hex("zz").is_err());
    }

    #[test]
    fn key_iv_is_32_and_16_bytes() {
        let (k, iv) = derive_key_iv("4807045517549591240");
        assert_eq!(k.len(), 32);
        assert_eq!(iv.len(), 16);
    }

    #[test]
    fn video_processing_field_matches_ts_model_name() {
        let video: VideoItem = serde_json::from_value(serde_json::json!({
            "video_isProcessing": true
        }))
        .expect("video JSON should deserialize");
        assert_eq!(video.video_is_processing, Some(true));

        let out = serde_json::to_value(&video).expect("video should serialize");
        assert_eq!(
            out.get("video_isProcessing").and_then(|v| v.as_bool()),
            Some(true)
        );
        assert!(out.get("video_is_processing").is_none());
    }

    #[test]
    fn real_wonderful_db_files() {
        for (path_suffix, openid, min_matches, expected_agent) in REAL_DBS {
            let path = PathBuf::from(fixture_path(path_suffix));
            if !path.exists() {
                eprintln!("skip (file not present): {}", path.display());
                continue;
            }
            let result = parse_wonderful_db(&path, openid).expect("parse should succeed");
            eprintln!("\n--- {} ---", openid);
            eprintln!("key: {}", result.key);
            eprintln!("matches: {}", result.matches.len());
            if let Some(m) = result.matches.first() {
                eprintln!(
                    "  [0] {}  {} {}  {}/{}/{}  win={}  videos={}",
                    m.matches_id,
                    m.agent.agent_name,
                    m.map.map_id,
                    m.stats.kills,
                    m.stats.deaths,
                    m.stats.assists,
                    m.stats.has_won,
                    m.videos.len()
                );
            }
            assert!(
                result.matches.len() >= *min_matches,
                "{}: expected at least {} matches, got {}",
                openid,
                min_matches,
                result.matches.len()
            );
            if !expected_agent.is_empty() {
                assert_eq!(
                    result.matches[0].agent.agent_name,
                    *expected_agent,
                    "{}: first match agent mismatch",
                    openid
                );
            }
        }
    }

    #[test]
    fn real_snapshot_db_files() {
        for (path_suffix, openid, expected_nick, expected_tag) in REAL_SNAPSHOTS {
            let path = PathBuf::from(fixture_path(path_suffix));
            if !path.exists() {
                eprintln!("skip (file not present): {}", path.display());
                continue;
            }
            let data = parse_snapshot_db(&path, openid)
                .unwrap_or_else(|e| panic!("parse_snapshot_db({}) failed: {}", openid, e));
            eprintln!(
                "\n--- {} ---\n  nick: {:?}\n  tag:  {:?}\n  achievements: {}",
                openid, data.nick, data.tag, data.achievements.len()
            );
            let exp_nick: Option<&str> = if expected_nick.is_empty() { None } else { Some(expected_nick) };
            let exp_tag: Option<&str> = if expected_tag.is_empty() { None } else { Some(expected_tag) };
            assert_eq!(data.nick.as_deref(), exp_nick, "{}: nick mismatch", openid);
            assert_eq!(data.tag.as_deref(), exp_tag, "{}: tag mismatch", openid);
            // 4807 and 1412 have known achievement data; 1379/1228 are empty
            if openid == &"4807045517549591240" || openid == &"14121192131852595386" {
                assert!(!data.achievements.is_empty(), "{}: should have achievements", openid);
            } else {
                assert!(data.achievements.is_empty(), "{}: should be empty", openid);
            }
        }
    }
}
