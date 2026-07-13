//! ACLOS account identity (nick / #tag) resolution.
//!
//! ## Sources (nick/tag), highest wins
//! 1. **Chromium Local Storage LevelDB** under `%APPDATA%\ACLOS\Local Storage\leveldb`
//!    - Key `ACLOS_USER_ROLES_INFO` → JSON array of current roles
//!    - Keys `acloshighlight_user_<openid>` → per-account role JSON
//!    Opened via pure-Rust `rusty-leveldb` (copy-on-lock if ACLOS holds LOCK).
//! 2. **`snapshot<openid>`** (`ss_nick` / `ss_nick_id`) — still used for MVP/SVP
//!    and as nick fallback when LevelDB has no row for that openid.
//! 3. Best-effort text scan of ACLOS logs / IndexedDB files (masked openids).
//!
//! Production code never hard-codes maintainer openids or nicks.
//! Read-only; never writes ACLOS / Riot / game paths.

use rusty_leveldb::{LdbIterator, Options, DB};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Display name + Riot-style #tag for one openid.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct IdentityHint {
    pub nick: Option<String>,
    pub tag: Option<String>,
}

#[derive(Debug, Clone)]
struct ScoredIdentity {
    nick: Option<String>,
    tag: Option<String>,
    /// Higher = preferred. LevelDB roles/highlight keys use high scores.
    score: u32,
}

#[derive(Debug, Clone)]
struct MaskedEntry {
    prefix: String,
    suffix: String,
    nick: Option<String>,
    tag: Option<String>,
    score: u32,
}

/// In-memory openid → nick/tag index built once per scrape.
#[derive(Debug, Default)]
pub struct AclosIdentityIndex {
    exact: HashMap<String, ScoredIdentity>,
    masks: Vec<MaskedEntry>,
}

const SCORE_LEVELDB_ROLES: u32 = 100;
const SCORE_LEVELDB_HIGHLIGHT_USER: u32 = 90;
const SCORE_LOG_CLEAN: u32 = 3;
const SCORE_LOG_MASK: u32 = 2;
const SCORE_LOG_LOOSE: u32 = 1;

impl AclosIdentityIndex {
    pub fn load_default() -> Self {
        let Some(root) = aclos_roaming_dir() else {
            return Self::default();
        };
        Self::load_from_aclos_root(&root)
    }

    pub fn load_from_aclos_root(aclos_root: &Path) -> Self {
        let mut idx = Self::default();

        // 1) Formal Local Storage LevelDB (primary for nick/tag).
        let ls = aclos_root.join("Local Storage").join("leveldb");
        if ls.is_dir() {
            load_from_local_storage_leveldb(&ls, &mut idx);
        }

        // 2) Secondary text harvest: logs + IndexedDB raw files (masked openids etc.).
        let mut paths: Vec<PathBuf> = Vec::new();
        collect_leveldb_files(
            &aclos_root
                .join("IndexedDB")
                .join("app_aclos.val.qq.com_0.indexeddb.leveldb"),
            &mut paths,
        );
        // Also re-scan Local Storage ldb as text? Unnecessary if LevelDB open worked;
        // still useful if open failed and we only have file archaeology.
        if idx.exact.is_empty() {
            collect_leveldb_files(&ls, &mut paths);
        }
        collect_log_files(&aclos_root.join("logs"), &mut paths);

        for path in paths {
            if let Ok(bytes) = std::fs::read(&path) {
                let slice = tail_utf8_slice(&bytes, 12 * 1024 * 1024);
                let text = String::from_utf8_lossy(slice);
                harvest_text(&text, &mut idx);
            }
        }
        idx
    }

    pub fn lookup(&self, openid: &str) -> IdentityHint {
        if let Some(s) = self.exact.get(openid) {
            return IdentityHint {
                nick: s.nick.clone(),
                tag: s.tag.clone(),
            };
        }
        let mut best: Option<&MaskedEntry> = None;
        for m in &self.masks {
            if mask_matches(openid, &m.prefix, &m.suffix) {
                match best {
                    None => best = Some(m),
                    Some(b) if m.score > b.score => best = Some(m),
                    Some(b) if m.score == b.score && m.tag.is_some() && b.tag.is_none() => {
                        best = Some(m);
                    }
                    _ => {}
                }
            }
        }
        match best {
            Some(m) => IdentityHint {
                nick: m.nick.clone(),
                tag: m.tag.clone(),
            },
            None => IdentityHint::default(),
        }
    }

    /// Prefer LevelDB/cache identity over snapshot for nick/tag when present.
    /// Snapshot values fill only fields still missing after cache lookup.
    pub fn merge_with_snapshot(
        &self,
        openid: &str,
        snap_nick: Option<String>,
        snap_tag: Option<String>,
    ) -> (Option<String>, Option<String>) {
        let fb = self.lookup(openid);
        let nick = fb.nick.or(snap_nick);
        let tag = fb.tag.or(snap_tag);
        (nick, tag)
    }
}

// ─── LevelDB Local Storage ───────────────────────────────────────────────────

fn load_from_local_storage_leveldb(dir: &Path, idx: &mut AclosIdentityIndex) {
    // Prefer opening in place; if LOCK is held (ACLOS running), copy to temp.
    if try_open_local_storage(dir, idx) {
        return;
    }
    let Ok(tmp) = copy_leveldb_to_temp(dir) else {
        return;
    };
    let _ = try_open_local_storage(&tmp, idx);
    let _ = std::fs::remove_dir_all(&tmp);
}

fn try_open_local_storage(dir: &Path, idx: &mut AclosIdentityIndex) -> bool {
    let mut opts = Options::default();
    opts.create_if_missing = false;
    // rusty-leveldb may still try to create lock; ignore open errors.
    let mut db = match DB::open(dir, opts) {
        Ok(db) => db,
        Err(_) => return false,
    };
    let mut iter = match db.new_iter() {
        Ok(it) => it,
        Err(_) => return false,
    };
    // Prefer advance/current for efficiency per crate docs.
    iter.reset();
    while iter.advance() {
        let Some((key, value)) = iter.current() else {
            continue;
        };
        let key_name = decode_chromium_ls_key_name(key.as_ref());
        if key_name.is_empty() {
            continue;
        }
        if key_name == "ACLOS_USER_ROLES_INFO" {
            if let Some(text) = decode_chromium_ls_value(value.as_ref()) {
                ingest_roles_json(&text, idx, SCORE_LEVELDB_ROLES);
            }
            continue;
        }
        if let Some(openid) = key_name.strip_prefix("acloshighlight_user_") {
            if is_full_openid(openid) {
                if let Some(text) = decode_chromium_ls_value(value.as_ref()) {
                    ingest_single_role_json(&text, openid, idx, SCORE_LEVELDB_HIGHLIGHT_USER);
                }
            }
        }
    }
    true
}

fn copy_leveldb_to_temp(src: &Path) -> Result<PathBuf, std::io::Error> {
    let tmp = std::env::temp_dir().join(format!(
        "wui-aclos-ls-{}-{}",
        std::process::id(),
        now_ms()
    ));
    if tmp.exists() {
        let _ = std::fs::remove_dir_all(&tmp);
    }
    std::fs::create_dir_all(&tmp)?;
    for ent in std::fs::read_dir(src)? {
        let ent = ent?;
        let name = ent.file_name();
        let name_s = name.to_string_lossy();
        // Skip live LOCK so we can open the copy.
        if name_s == "LOCK" {
            continue;
        }
        let from = ent.path();
        let to = tmp.join(&name);
        if from.is_file() {
            let _ = std::fs::copy(&from, &to);
        }
    }
    Ok(tmp)
}

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// Chromium Local Storage key: `_` + origin + `\0` + optional `\x01` + name.
fn decode_chromium_ls_key_name(key: &[u8]) -> String {
    if let Some(nul) = key.iter().position(|&b| b == 0) {
        let mut i = nul + 1;
        if i < key.len() && key[i] == 1 {
            i += 1;
        }
        return String::from_utf8_lossy(&key[i..]).into_owned();
    }
    String::from_utf8_lossy(key).into_owned()
}

/// Chromium Local Storage value: type byte + payload.
///
/// Observed ACLOS encodings (both real on one machine, generic decode):
/// - `0x01` + UTF-8 JSON — common for `app://aclos.val.qq.com` keys
/// - `0x00` + UTF-16LE JSON — common for `https://val.qq.com` keys such as
///   `acloshighlight_user_<openid>` (most multi-account nick rows)
/// - bare UTF-16LE / UTF-8 JSON without type byte (rare)
fn decode_chromium_ls_value(value: &[u8]) -> Option<String> {
    if value.is_empty() {
        return None;
    }

    // Type 1 = string (Chromium). Prefer UTF-8 JSON, then UTF-16LE.
    if value[0] == 1 && value.len() > 1 {
        let rest = &value[1..];
        if let Some(s) = jsonish_utf8(rest) {
            return Some(s);
        }
        if let Some(s) = jsonish_utf16le(rest) {
            return Some(s);
        }
        return Some(String::from_utf8_lossy(rest).into_owned());
    }

    // Type 0 on disk for some origins still carries a string payload as UTF-16LE
    // (not a JSON null). Prefer UTF-16LE when it looks like JSON.
    if value[0] == 0 && value.len() > 1 {
        let rest = &value[1..];
        if let Some(s) = jsonish_utf16le(rest) {
            return Some(s);
        }
        if let Some(s) = jsonish_utf8(rest) {
            return Some(s);
        }
    }

    // Bare payloads
    if let Some(s) = jsonish_utf16le(value) {
        return Some(s);
    }
    if let Some(s) = jsonish_utf8(value) {
        return Some(s);
    }
    None
}

fn looks_like_json_object_or_array(s: &str) -> bool {
    let t = s.trim_start();
    t.starts_with('{') || t.starts_with('[') || t.contains("openid") || t.contains("nick")
}

fn jsonish_utf8(bytes: &[u8]) -> Option<String> {
    let s = String::from_utf8_lossy(bytes);
    if looks_like_json_object_or_array(&s) {
        Some(s.into_owned())
    } else {
        None
    }
}

fn jsonish_utf16le(bytes: &[u8]) -> Option<String> {
    if bytes.len() < 2 {
        return None;
    }
    // Odd trailing byte: ignore last (common with type-prefix framing).
    let even = &bytes[..bytes.len() - (bytes.len() % 2)];
    if even.is_empty() {
        return None;
    }
    let u16s: Vec<u16> = even
        .chunks_exact(2)
        .map(|c| u16::from_le_bytes([c[0], c[1]]))
        .collect();
    let s = String::from_utf16_lossy(&u16s);
    if looks_like_json_object_or_array(&s) {
        Some(s)
    } else {
        None
    }
}

fn ingest_roles_json(text: &str, idx: &mut AclosIdentityIndex, score: u32) {
    let text = text.trim_start_matches(['\u{0}', '\u{1}']).trim();
    let Ok(v) = serde_json::from_str::<serde_json::Value>(text) else {
        // Substring array if framing junk remains
        if let (Some(i), Some(j)) = (text.find('['), text.rfind(']')) {
            if j > i {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text[i..=j]) {
                    ingest_roles_value(&v, idx, score);
                }
            }
        }
        return;
    };
    ingest_roles_value(&v, idx, score);
}

fn ingest_roles_value(v: &serde_json::Value, idx: &mut AclosIdentityIndex, score: u32) {
    let list = if let Some(arr) = v.as_array() {
        arr.as_slice()
    } else if let Some(arr) = v.get("data").and_then(|x| x.as_array()) {
        arr.as_slice()
    } else if let Some(arr) = v.get("role_list").and_then(|x| x.as_array()) {
        arr.as_slice()
    } else if v.is_object() {
        ingest_one_role_obj(v, None, idx, score);
        return;
    } else {
        return;
    };
    for item in list {
        ingest_one_role_obj(item, None, idx, score);
    }
}

fn ingest_single_role_json(
    text: &str,
    openid_from_key: &str,
    idx: &mut AclosIdentityIndex,
    score: u32,
) {
    let text = text.trim_start_matches(['\u{0}', '\u{1}']).trim();
    let Ok(v) = serde_json::from_str::<serde_json::Value>(text) else {
        return;
    };
    ingest_one_role_obj(&v, Some(openid_from_key), idx, score);
}

fn ingest_one_role_obj(
    v: &serde_json::Value,
    openid_hint: Option<&str>,
    idx: &mut AclosIdentityIndex,
    score: u32,
) {
    let openid = v
        .get("openid")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string())
        .or_else(|| openid_hint.map(|s| s.to_string()));
    let Some(openid) = openid else {
        return;
    };
    if !is_full_openid(&openid) {
        return;
    }
    let nick = v
        .get("nick")
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| is_plausible_nick(s));
    let tag = v
        .get("nick_id")
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| is_plausible_tag(s));
    if nick.is_none() && tag.is_none() {
        return;
    }
    record_exact(idx, &openid, nick, tag, score);
}

// ─── Text harvest (logs / raw files) ────────────────────────────────────────

fn aclos_roaming_dir() -> Option<PathBuf> {
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))?;
    let p = PathBuf::from(home)
        .join("AppData")
        .join("Roaming")
        .join("ACLOS");
    if p.is_dir() {
        Some(p)
    } else {
        None
    }
}

fn collect_leveldb_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    for ent in rd.flatten() {
        let name = ent.file_name();
        let name = name.to_string_lossy();
        if name.ends_with(".ldb") || name.ends_with(".log") {
            out.push(ent.path());
        }
    }
}

fn collect_log_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    for ent in rd.flatten() {
        let name = ent.file_name();
        let name = name.to_string_lossy();
        if name.ends_with(".log") || name.ends_with(".old.log") {
            out.push(ent.path());
        }
    }
}

fn tail_utf8_slice(bytes: &[u8], max_len: usize) -> &[u8] {
    if bytes.len() <= max_len {
        return bytes;
    }
    let mut start = bytes.len() - max_len;
    while start < bytes.len() && (bytes[start] & 0b1100_0000) == 0b1000_0000 {
        start += 1;
    }
    &bytes[start..]
}

fn harvest_text(text: &str, idx: &mut AclosIdentityIndex) {
    harvest_clean_full(text, idx);
    harvest_loose_full(text, idx);
    harvest_masked(text, idx);
}

fn str_window(text: &str, start: usize, max_len: usize) -> &str {
    if start >= text.len() {
        return "";
    }
    let end = text.floor_char_boundary((start + max_len).min(text.len()));
    &text[start..end]
}

fn harvest_clean_full(text: &str, idx: &mut AclosIdentityIndex) {
    let mut search_from = 0;
    while let Some(rel) = text[search_from..].find("\"openid\"") {
        let start = search_from + rel;
        let window = str_window(text, start, 600);
        if let Some((oid, nick, tag)) = parse_openid_nick_tag(window, true) {
            record_exact(idx, &oid, Some(nick), tag, SCORE_LOG_CLEAN);
        }
        search_from = start + 8;
    }
}

fn harvest_loose_full(text: &str, idx: &mut AclosIdentityIndex) {
    let mut search_from = 0;
    while let Some(rel) = text[search_from..].find("\"openid\"") {
        let start = search_from + rel;
        let window = str_window(text, start, 400);
        if let Some((oid, nick, tag)) = parse_openid_nick_optional_tag(window) {
            record_exact(idx, &oid, Some(nick), tag, SCORE_LOG_LOOSE);
        }
        search_from = start + 8;
    }
}

fn harvest_masked(text: &str, idx: &mut AclosIdentityIndex) {
    let mut search_from = 0;
    while let Some(rel) = text[search_from..].find("\"openid\"") {
        let start = search_from + rel;
        let window = str_window(text, start, 600);
        if let Some((mask, nick, tag)) = parse_masked_openid_nick_tag(window) {
            record_mask(idx, &mask, Some(nick), tag, SCORE_LOG_MASK);
        }
        search_from = start + 8;
    }
}

fn parse_openid_nick_tag(
    window: &str,
    require_full_oid: bool,
) -> Option<(String, String, Option<String>)> {
    let oid = extract_json_string_after(window, "\"openid\"")?;
    if require_full_oid && !is_full_openid(&oid) {
        return None;
    }
    let nick = extract_json_string_after(window, "\"nick\"")?;
    if !is_plausible_nick(&nick) {
        return None;
    }
    let tag = extract_json_string_after(window, "\"nick_id\"").filter(|t| is_plausible_tag(t));
    Some((oid, nick, tag))
}

fn parse_openid_nick_optional_tag(window: &str) -> Option<(String, String, Option<String>)> {
    let oid = extract_json_string_after(window, "\"openid\"")?;
    if !is_full_openid(&oid) {
        return None;
    }
    let nick = extract_json_string_after(window, "\"nick\"")?;
    if !is_plausible_nick(&nick) {
        return None;
    }
    let tag = extract_json_string_after(window, "\"nick_id\"").filter(|t| is_plausible_tag(t));
    Some((oid, nick, tag))
}

fn parse_masked_openid_nick_tag(window: &str) -> Option<(String, String, Option<String>)> {
    let oid = extract_json_string_after(window, "\"openid\"")?;
    if !is_masked_openid(&oid) {
        return None;
    }
    let nick = extract_json_string_after(window, "\"nick\"")?;
    if !is_plausible_nick(&nick) {
        return None;
    }
    let tag = extract_json_string_after(window, "\"nick_id\"").filter(|t| is_plausible_tag(t));
    Some((oid, nick, tag))
}

fn extract_json_string_after(window: &str, key: &str) -> Option<String> {
    let idx = window.find(key)?;
    let rest = &window[idx + key.len()..];
    let colon = rest.find(':')?;
    let mut chars = rest[colon + 1..].chars().peekable();
    while matches!(chars.peek(), Some(c) if c.is_whitespace()) {
        chars.next();
    }
    if chars.next() != Some('"') {
        return None;
    }
    let mut out = String::new();
    while let Some(c) = chars.next() {
        if c == '\\' {
            if let Some(n) = chars.next() {
                out.push(n);
            }
            continue;
        }
        if c == '"' {
            break;
        }
        out.push(c);
        if out.len() > 64 {
            return None;
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

fn is_full_openid(s: &str) -> bool {
    let b = s.as_bytes();
    (15..=25).contains(&b.len()) && b.iter().all(|c| c.is_ascii_digit())
}

fn is_masked_openid(s: &str) -> bool {
    if s.len() < 10 || s.len() > 30 || !s.contains('*') {
        return false;
    }
    let prefix: String = s.chars().take_while(|c| c.is_ascii_digit()).collect();
    let suffix: String = s
        .chars()
        .rev()
        .take_while(|c| c.is_ascii_digit())
        .collect::<String>()
        .chars()
        .rev()
        .collect();
    prefix.len() >= 4 && suffix.len() >= 4 && (prefix.len() + suffix.len()) >= 8
}

fn is_plausible_nick(s: &str) -> bool {
    let t = s.trim();
    if t.is_empty() || t.len() > 40 {
        return false;
    }
    if t == "我" || t.eq_ignore_ascii_case("null") {
        return false;
    }
    true
}

fn is_plausible_tag(s: &str) -> bool {
    let b = s.as_bytes();
    (3..=8).contains(&b.len()) && b.iter().all(|c| c.is_ascii_digit())
}

fn mask_matches(openid: &str, prefix: &str, suffix: &str) -> bool {
    openid.len() > prefix.len() + suffix.len()
        && openid.starts_with(prefix)
        && openid.ends_with(suffix)
}

fn split_mask(mask: &str) -> Option<(String, String)> {
    let prefix: String = mask.chars().take_while(|c| c.is_ascii_digit()).collect();
    let suffix: String = mask
        .chars()
        .rev()
        .take_while(|c| c.is_ascii_digit())
        .collect::<String>()
        .chars()
        .rev()
        .collect();
    if prefix.len() >= 4 && suffix.len() >= 4 {
        Some((prefix, suffix))
    } else {
        None
    }
}

fn record_exact(
    idx: &mut AclosIdentityIndex,
    openid: &str,
    nick: Option<String>,
    tag: Option<String>,
    score: u32,
) {
    let entry = idx.exact.entry(openid.to_string()).or_insert(ScoredIdentity {
        nick: None,
        tag: None,
        score: 0,
    });
    let better = score > entry.score
        || (score == entry.score && tag.is_some() && entry.tag.is_none() && nick.is_some());
    if better {
        if nick.is_some() {
            entry.nick = nick;
        }
        if tag.is_some() {
            entry.tag = tag;
        }
        entry.score = score;
    } else if score == entry.score {
        if nick.is_some() && nick == entry.nick {
            entry.score = entry.score.saturating_add(1);
        }
        if entry.tag.is_none() {
            if let Some(t) = tag {
                entry.tag = Some(t);
            }
        }
        if entry.nick.is_none() {
            if let Some(n) = nick {
                entry.nick = Some(n);
            }
        }
    }
}

fn record_mask(
    idx: &mut AclosIdentityIndex,
    mask: &str,
    nick: Option<String>,
    tag: Option<String>,
    score: u32,
) {
    let Some((prefix, suffix)) = split_mask(mask) else {
        return;
    };
    if let Some(existing) = idx
        .masks
        .iter_mut()
        .find(|m| m.prefix == prefix && m.suffix == suffix)
    {
        if score > existing.score
            || (score == existing.score && tag.is_some() && existing.tag.is_none())
        {
            if nick.is_some() {
                existing.nick = nick;
            }
            if tag.is_some() {
                existing.tag = tag;
            }
            existing.score = score;
        } else {
            existing.score = existing.score.saturating_add(1);
            if existing.tag.is_none() {
                if let Some(t) = tag {
                    existing.tag = Some(t);
                }
            }
            if existing.nick.is_none() {
                if let Some(n) = nick {
                    existing.nick = Some(n);
                }
            }
        }
    } else {
        idx.masks.push(MaskedEntry {
            prefix,
            suffix,
            nick,
            tag,
            score,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const OID_A: &str = "1000000000000000001";
    const OID_B: &str = "2000000000000000002";
    const OID_UNRELATED: &str = "9999999999999999999";

    #[test]
    fn decode_chromium_ls_value_utf8_json() {
        // type=1 + UTF-8 JSON (app://aclos.val.qq.com style)
        let mut raw = vec![1u8];
        raw.extend_from_slice(
            br#"[{"openid":"1000000000000000001","nick":"TestNick","nick_id":"12345"}]"#,
        );
        let s = decode_chromium_ls_value(&raw).expect("decode");
        let mut idx = AclosIdentityIndex::default();
        ingest_roles_json(&s, &mut idx, SCORE_LEVELDB_ROLES);
        let h = idx.lookup(OID_A);
        assert_eq!(h.nick.as_deref(), Some("TestNick"));
        assert_eq!(h.tag.as_deref(), Some("12345"));
    }

    #[test]
    fn decode_chromium_ls_value_type0_utf16le_json() {
        // type=0 + UTF-16LE JSON (https://val.qq.com acloshighlight_user_* style)
        let json = r#"{"openid":"2000000000000000002","nick":"Beta","nick_id":"67890"}"#;
        let mut raw = vec![0u8];
        for u in json.encode_utf16() {
            raw.extend_from_slice(&u.to_le_bytes());
        }
        let s = decode_chromium_ls_value(&raw).expect("decode type0 utf16");
        let mut idx = AclosIdentityIndex::default();
        ingest_single_role_json(&s, OID_B, &mut idx, SCORE_LEVELDB_HIGHLIGHT_USER);
        let h = idx.lookup(OID_B);
        assert_eq!(h.nick.as_deref(), Some("Beta"));
        assert_eq!(h.tag.as_deref(), Some("67890"));
    }

    #[test]
    fn decode_chromium_ls_key_name_with_origin_prefix() {
        let mut key = b"_app://aclos.val.qq.com".to_vec();
        key.push(0);
        key.push(1);
        key.extend_from_slice(b"acloshighlight_user_2000000000000000002");
        assert_eq!(
            decode_chromium_ls_key_name(&key),
            "acloshighlight_user_2000000000000000002"
        );
    }

    #[test]
    fn ingest_highlight_user_object() {
        let json = r#"{"openid":"2000000000000000002","nick":"Beta","nick_id":"67890"}"#;
        let mut idx = AclosIdentityIndex::default();
        ingest_single_role_json(json, OID_B, &mut idx, SCORE_LEVELDB_HIGHLIGHT_USER);
        let h = idx.lookup(OID_B);
        assert_eq!(h.nick.as_deref(), Some("Beta"));
        assert_eq!(h.tag.as_deref(), Some("67890"));
    }

    #[test]
    fn leveldb_identity_preferred_over_snapshot_in_merge() {
        let mut idx = AclosIdentityIndex::default();
        record_exact(
            &mut idx,
            OID_A,
            Some("FromLevelDb".into()),
            Some("11111".into()),
            SCORE_LEVELDB_HIGHLIGHT_USER,
        );
        let (nick, tag) = idx.merge_with_snapshot(
            OID_A,
            Some("FromSnapshot".into()),
            Some("22222".into()),
        );
        assert_eq!(nick.as_deref(), Some("FromLevelDb"));
        assert_eq!(tag.as_deref(), Some("11111"));
    }

    #[test]
    fn snapshot_used_when_leveldb_missing() {
        let idx = AclosIdentityIndex::default();
        let (nick, tag) =
            idx.merge_with_snapshot(OID_A, Some("SnapOnly".into()), Some("33333".into()));
        assert_eq!(nick.as_deref(), Some("SnapOnly"));
        assert_eq!(tag.as_deref(), Some("33333"));
    }

    #[test]
    fn masked_openid_matches_full_account_id() {
        let sample =
            r#"RESPONSE：{"openid":"2000***********0002","nick":"AlphaPlayer","nick_id":"67890"}"#;
        let mut idx = AclosIdentityIndex::default();
        harvest_text(sample, &mut idx);
        let h = idx.lookup(OID_B);
        assert_eq!(h.nick.as_deref(), Some("AlphaPlayer"));
        assert_eq!(h.tag.as_deref(), Some("67890"));
        assert!(idx.lookup(OID_UNRELATED).nick.is_none());
    }

    #[test]
    fn rejects_placeholder_nick_wo() {
        let sample = format!(r#"{{"openid":"{OID_A}","nick":"我","nick_id":"12345"}}"#);
        let mut idx = AclosIdentityIndex::default();
        harvest_text(&sample, &mut idx);
        assert!(idx.lookup(OID_A).nick.is_none());
    }

    /// Optional: when this machine has ACLOS Local Storage, LevelDB open must
    /// not panic. Does not assert specific openids (not a one-PC fixture).
    #[test]
    fn load_default_does_not_panic() {
        let idx = AclosIdentityIndex::load_default();
        let _ = idx.lookup("0");
    }
}
