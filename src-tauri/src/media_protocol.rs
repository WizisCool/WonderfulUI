//! CORS-friendly local media protocol (`wui-media`).
//!
//! WebView `<video>` loaded via the default `asset` protocol taints canvas on
//! `drawImage` unless CORS is correct. This scheme serves local highlight files
//! with `Access-Control-Allow-Origin: *` and HTTP Range so progressive play
//! stays fast and `crossOrigin="anonymous"` screenshots can export in one draw.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use http::{header, HeaderMap, HeaderValue, Method, Request, Response, StatusCode};

pub const SCHEME: &str = "wui-media";

/// Decode a `wui-media` request path into a filesystem path.
///
/// `convertFileSrc(path, "wui-media")` encodes the absolute path as the URL path
/// (percent-encoded). Leading `/` is stripped; Windows drive paths stay intact.
pub fn path_from_uri_path(uri_path: &str) -> Option<PathBuf> {
    let raw = uri_path.trim_start_matches('/');
    if raw.is_empty() {
        return None;
    }
    let decoded = percent_decode(raw);
    if decoded.is_empty() {
        return None;
    }
    // Reject empty / relative tricks; highlights are absolute Windows paths.
    let path = PathBuf::from(&decoded);
    if path.as_os_str().is_empty() {
        return None;
    }
    Some(path)
}

/// Parse a single `bytes=start-end` Range (or `bytes=start-`).
/// Returns `(start, end_inclusive_opt)` where end is inclusive when present.
pub fn parse_bytes_range(value: &str, file_len: u64) -> Option<(u64, u64)> {
    let s = value.trim();
    let rest = s.strip_prefix("bytes=")?.trim();
    // Only one range (video players use a single range).
    let part = rest.split(',').next()?.trim();
    if part.is_empty() || file_len == 0 {
        return None;
    }
    if let Some(suffix) = part.strip_prefix('-') {
        // bytes=-N → last N bytes
        let n: u64 = suffix.parse().ok()?;
        if n == 0 {
            return None;
        }
        let n = n.min(file_len);
        return Some((file_len - n, file_len - 1));
    }
    let (a, b) = part.split_once('-')?;
    let start: u64 = a.parse().ok()?;
    if start >= file_len {
        return None;
    }
    let end = if b.is_empty() {
        file_len - 1
    } else {
        let e: u64 = b.parse().ok()?;
        e.min(file_len - 1)
    };
    if end < start {
        return None;
    }
    Some((start, end))
}

pub fn guess_video_mime(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .as_deref()
    {
        Some("webm") => "video/webm",
        Some("mov") => "video/quicktime",
        Some("mkv") => "video/x-matroska",
        Some("m4v") => "video/x-m4v",
        _ => "video/mp4",
    }
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (from_hex(bytes[i + 1]), from_hex(bytes[i + 2])) {
                out.push((hi << 4) | lo);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn from_hex(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

fn cors_headers() -> HeaderMap {
    let mut h = HeaderMap::new();
    h.insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    h.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, HEAD, OPTIONS"),
    );
    h.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("Range, Content-Type, Accept, Origin"),
    );
    h.insert(
        header::ACCESS_CONTROL_EXPOSE_HEADERS,
        HeaderValue::from_static("Accept-Ranges, Content-Range, Content-Length, Content-Type"),
    );
    h.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    h
}

fn empty_response(status: StatusCode) -> Response<Vec<u8>> {
    let mut res = Response::builder()
        .status(status)
        .body(Vec::new())
        .expect("empty response");
    *res.headers_mut() = cors_headers();
    res
}

fn error_response(status: StatusCode, msg: &str) -> Response<Vec<u8>> {
    let mut res = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(msg.as_bytes().to_vec())
        .expect("error response");
    for (k, v) in cors_headers().iter() {
        res.headers_mut().insert(k, v.clone());
    }
    res
}

/// Max body size per response. Uri scheme handlers buffer the full body in a
/// `Vec` — serving multi‑MB ranges (or whole files) freezes the app. Cap chunks
/// so clients re-request with further Range headers.
pub const MAX_CHUNK_BYTES: u64 = 512 * 1024;

/// Clamp an inclusive range so `end - start + 1 <= MAX_CHUNK_BYTES`.
pub fn clamp_range_chunk(start: u64, end: u64) -> (u64, u64) {
    let max_end = start.saturating_add(MAX_CHUNK_BYTES.saturating_sub(1));
    (start, end.min(max_end))
}

/// Build the HTTP response for a `wui-media` request (runs off the UI thread).
///
/// Always serves at most [`MAX_CHUNK_BYTES`] per response (206 Partial Content)
/// so large highlight files never get fully buffered in process memory.
pub fn handle_request(request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    if request.method() == Method::OPTIONS {
        return empty_response(StatusCode::NO_CONTENT);
    }
    if request.method() != Method::GET && request.method() != Method::HEAD {
        return error_response(StatusCode::METHOD_NOT_ALLOWED, "method not allowed");
    }

    let Some(path) = path_from_uri_path(request.uri().path()) else {
        return error_response(StatusCode::BAD_REQUEST, "invalid path");
    };
    if !path.is_file() {
        return error_response(StatusCode::NOT_FOUND, "file not found");
    }

    let meta = match std::fs::metadata(&path) {
        Ok(m) => m,
        Err(_) => return error_response(StatusCode::NOT_FOUND, "file not found"),
    };
    let file_len = meta.len();
    let mime = guess_video_mime(&path);
    let is_head = request.method() == Method::HEAD;

    if file_len == 0 {
        return error_response(StatusCode::NOT_FOUND, "empty file");
    }

    let range_hdr = request
        .headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    // Prefer client Range; otherwise start at 0. Always clamp to MAX_CHUNK.
    let (start, end) = if let Some(ref range_val) = range_hdr {
        match parse_bytes_range(range_val, file_len) {
            Some((s, e)) => clamp_range_chunk(s, e),
            None => {
                let mut res = Response::builder()
                    .status(StatusCode::RANGE_NOT_SATISFIABLE)
                    .header(header::CONTENT_RANGE, format!("bytes */{}", file_len))
                    .body(Vec::new())
                    .expect("416 response");
                for (k, v) in cors_headers().iter() {
                    res.headers_mut().insert(k, v.clone());
                }
                return res;
            }
        }
    } else {
        clamp_range_chunk(0, file_len - 1)
    };

    let len = end - start + 1;
    let body = if is_head {
        Vec::new()
    } else {
        match read_file_range(&path, start, len) {
            Ok(b) => b,
            Err(_) => return error_response(StatusCode::INTERNAL_SERVER_ERROR, "read failed"),
        }
    };
    let content_range = format!("bytes {}-{}/{}", start, end, file_len);
    // Always 206 so clients keep issuing Range requests instead of expecting
    // a single full-body 200 that we refuse to buffer entirely.
    let mut res = Response::builder()
        .status(StatusCode::PARTIAL_CONTENT)
        .header(header::CONTENT_TYPE, mime)
        .header(header::CONTENT_LENGTH, len.to_string())
        .header(header::CONTENT_RANGE, content_range)
        .body(body)
        .expect("chunk response");
    for (k, v) in cors_headers().iter() {
        res.headers_mut().insert(k, v.clone());
    }
    res
}

fn read_file_range(path: &Path, start: u64, len: u64) -> Result<Vec<u8>, std::io::Error> {
    let mut file = File::open(path)?;
    file.seek(SeekFrom::Start(start))?;
    let mut buf = vec![0u8; len as usize];
    file.read_exact(&mut buf)?;
    Ok(buf)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_from_uri_decodes_windows_path() {
        let p = path_from_uri_path("/D%3A%5CVideos%5Cclip.mp4").expect("path");
        assert_eq!(p, PathBuf::from(r"D:\Videos\clip.mp4"));
    }

    #[test]
    fn path_from_uri_rejects_empty() {
        assert!(path_from_uri_path("/").is_none());
        assert!(path_from_uri_path("").is_none());
    }

    #[test]
    fn parse_range_start_end() {
        assert_eq!(parse_bytes_range("bytes=0-1023", 4096), Some((0, 1023)));
        assert_eq!(parse_bytes_range("bytes=100-", 500), Some((100, 499)));
        assert_eq!(parse_bytes_range("bytes=-200", 1000), Some((800, 999)));
    }

    #[test]
    fn parse_range_rejects_past_eof() {
        assert_eq!(parse_bytes_range("bytes=500-600", 100), None);
    }

    #[test]
    fn mime_from_extension() {
        assert_eq!(guess_video_mime(Path::new("a.mp4")), "video/mp4");
        assert_eq!(guess_video_mime(Path::new("a.WEBM")), "video/webm");
    }

    #[test]
    fn clamp_range_caps_open_ended_to_chunk() {
        let (s, e) = clamp_range_chunk(0, 50_000_000);
        assert_eq!(s, 0);
        assert_eq!(e, MAX_CHUNK_BYTES - 1);
        assert_eq!(e - s + 1, MAX_CHUNK_BYTES);
    }
}
