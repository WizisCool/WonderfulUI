pub mod aclos_identity;
pub mod db;
pub mod events;
pub mod model;
pub mod scraper;
pub mod stats;

use sha2::{Digest, Sha256};

/// Wall-clock milliseconds since UNIX epoch (shared by scraper / db / stats / identity).
pub(crate) fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

/// SHA-256 of UTF-8 text as lowercase hex (asset cache keys, match/event hashes).
pub(crate) fn sha256_hex(input: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    format!("{:x}", hasher.finalize())
}
