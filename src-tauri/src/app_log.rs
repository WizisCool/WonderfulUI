use std::fs::{self, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const LOG_FILE_NAME: &str = "wonderful-ui.log";
const MAX_LOG_BYTES: u64 = 1024 * 1024;
const RETAIN_LOG_BYTES: u64 = 640 * 1024;
const PREVIEW_BYTES: u64 = 48 * 1024;

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogStatus {
    pub log_dir: String,
    pub log_path: String,
    pub size: u64,
    pub modified_ms: i64,
    pub max_bytes: u64,
    pub latest_text: String,
}

#[derive(Clone, Copy)]
pub enum LogLevel {
    Info,
    Warn,
    Error,
}

impl LogLevel {
    fn as_str(self) -> &'static str {
        match self {
            LogLevel::Info => "INFO",
            LogLevel::Warn => "WARN",
            LogLevel::Error => "ERROR",
        }
    }
}

pub fn log_dir() -> Result<PathBuf, String> {
    let local = std::env::var("LOCALAPPDATA").map_err(|_| "LOCALAPPDATA not set".to_string())?;
    Ok(PathBuf::from(local).join("wonderful-ui").join("logs"))
}

pub fn write(level: LogLevel, scope: &str, message: impl AsRef<str>) {
    if let Err(e) = write_inner(level, scope, message.as_ref()) {
        eprintln!("app_log write failed: {e}");
    }
}

pub fn status() -> Result<LogStatus, String> {
    let dir = log_dir()?;
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir {}: {}", dir.display(), e))?;
    cleanup_old_rotations(&dir);
    let path = dir.join(LOG_FILE_NAME);
    maintain_log_file(&path)?;
    let meta = fs::metadata(&path).ok();
    let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
    let modified_ms = meta
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let latest_text = read_tail(&path, PREVIEW_BYTES).unwrap_or_default();
    Ok(LogStatus {
        log_dir: dir.to_string_lossy().into_owned(),
        log_path: path.to_string_lossy().into_owned(),
        size,
        modified_ms,
        max_bytes: MAX_LOG_BYTES,
        latest_text,
    })
}

fn write_inner(level: LogLevel, scope: &str, message: &str) -> Result<(), String> {
    let dir = log_dir()?;
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir {}: {}", dir.display(), e))?;
    cleanup_old_rotations(&dir);
    let path = dir.join(LOG_FILE_NAME);
    maintain_log_file(&path)?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("open {}: {}", path.display(), e))?;
    let line = format!(
        "{} [{}] {} - {}\n",
        timestamp_ms(),
        level.as_str(),
        sanitize_token(scope),
        sanitize_line(message),
    );
    file.write_all(line.as_bytes())
        .map_err(|e| format!("write {}: {}", path.display(), e))?;
    drop(file);
    maintain_log_file(&path)
}

fn maintain_log_file(path: &Path) -> Result<(), String> {
    let Ok(meta) = fs::metadata(path) else {
        return Ok(());
    };
    if meta.len() < MAX_LOG_BYTES {
        return Ok(());
    }

    let retained = read_tail(path, RETAIN_LOG_BYTES)?;
    let header = format!(
        "{} [INFO] logs - log compacted automatically; retained latest {} KB\n",
        timestamp_ms(),
        RETAIN_LOG_BYTES / 1024,
    );
    fs::write(path, format!("{header}{retained}"))
        .map_err(|e| format!("compact {}: {}", path.display(), e))
}

fn cleanup_old_rotations(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        if name.starts_with(&format!("{LOG_FILE_NAME}.")) {
            let _ = fs::remove_file(path);
        }
    }
}

fn read_tail(path: &Path, max_bytes: u64) -> Result<String, String> {
    let mut file = OpenOptions::new()
        .read(true)
        .open(path)
        .map_err(|e| format!("open {}: {}", path.display(), e))?;
    let len = file
        .metadata()
        .map_err(|e| format!("metadata {}: {}", path.display(), e))?
        .len();
    let start = len.saturating_sub(max_bytes);
    file.seek(SeekFrom::Start(start))
        .map_err(|e| format!("seek {}: {}", path.display(), e))?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)
        .map_err(|e| format!("read {}: {}", path.display(), e))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

fn timestamp_ms() -> String {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}.{}", duration.as_secs(), duration.subsec_millis())
}

fn sanitize_token(value: &str) -> String {
    value
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | ':' | '.') {
                c
            } else {
                '_'
            }
        })
        .collect()
}

fn sanitize_line(value: &str) -> String {
    value.replace(['\r', '\n'], " ")
}
