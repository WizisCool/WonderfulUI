use std::fs::{self, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const LOG_FILE_NAME: &str = "wonderful-ui.log";
const MAX_LOG_BYTES: u64 = 1024 * 1024;
const RETAIN_LOG_BYTES: u64 = 640 * 1024;
const PREVIEW_BYTES: u64 = 48 * 1024;
const MAX_SCOPE_CHARS: usize = 64;
const MAX_MESSAGE_CHARS: usize = 8 * 1024;
const TRUNCATED_MARKER: &str = " …[truncated]";
static LOG_LOCK: Mutex<()> = Mutex::new(());

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
    status_in_dir(&dir)
}

fn status_in_dir(dir: &Path) -> Result<LogStatus, String> {
    let _guard = LOG_LOCK
        .lock()
        .map_err(|e| format!("log lock poisoned: {e}"))?;
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
    write_inner_in_dir(level, scope, message, &dir)
}

fn write_inner_in_dir(
    level: LogLevel,
    scope: &str,
    message: &str,
    dir: &Path,
) -> Result<(), String> {
    let _guard = LOG_LOCK
        .lock()
        .map_err(|e| format!("log lock poisoned: {e}"))?;
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
        .take(MAX_SCOPE_CHARS)
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
    let mut chars = value.chars();
    let mut line = chars
        .by_ref()
        .take(MAX_MESSAGE_CHARS)
        .map(|character| {
            if matches!(character, '\r' | '\n') {
                ' '
            } else {
                character
            }
        })
        .collect::<String>();
    if chars.next().is_some() {
        line.push_str(TRUNCATED_MARKER);
    }
    line
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    #[test]
    fn writes_wait_for_the_shared_log_maintenance_lock() {
        let dir = std::env::temp_dir().join(format!("wui-log-lock-test-{}", uuid::Uuid::new_v4()));
        let guard = LOG_LOCK.lock().expect("test owns log lock");
        let (started_tx, started_rx) = mpsc::channel();
        let (finished_tx, finished_rx) = mpsc::channel();
        let worker_dir = dir.clone();
        let worker = std::thread::spawn(move || {
            started_tx.send(()).expect("start signal");
            let result = write_inner_in_dir(LogLevel::Info, "test", "serialized", &worker_dir);
            finished_tx.send(result).expect("finish signal");
        });

        started_rx.recv().expect("worker starts");
        let early_result = finished_rx.recv_timeout(Duration::from_millis(30)).ok();
        let completed_while_locked = early_result.is_some();
        drop(guard);
        let result = early_result.unwrap_or_else(|| {
            finished_rx
                .recv_timeout(Duration::from_secs(1))
                .expect("write completes after unlock")
        });
        worker.join().expect("worker joins");

        assert!(!completed_while_locked);
        result.expect("serialized write succeeds");
        assert!(dir.join(LOG_FILE_NAME).is_file());
        std::fs::remove_dir_all(dir).expect("fixture removed");
    }

    #[test]
    fn log_fields_are_single_line_and_bounded_before_disk_write() {
        let scope = sanitize_token(&"scope".repeat(100));
        assert_eq!(scope.chars().count(), MAX_SCOPE_CHARS);

        let message = format!("first\n{}", "界".repeat(MAX_MESSAGE_CHARS));
        let sanitized = sanitize_line(&message);
        assert!(!sanitized.contains('\n'));
        assert!(sanitized.ends_with(TRUNCATED_MARKER));
        assert_eq!(
            sanitized.chars().count(),
            MAX_MESSAGE_CHARS + TRUNCATED_MARKER.chars().count()
        );
    }
}
