//! Native video-frame capture at a given timestamp (Windows).
//!
//! Uses WinRT Media Editing (`MediaComposition::GetThumbnailAsync`) so the
//! OS / hardware decoder seeks and rasterizes a frame — no WebView canvas,
//! no whole-file blob load in the frontend. Playback stays on asset streaming.

use base64::Engine;

/// Capture one frame as PNG (base64) at `time_ms` into the local media file.
#[cfg(windows)]
pub fn capture_frame_png_base64(path: &str, time_ms: u64) -> Result<String, String> {
    let png = capture_frame_png(path, time_ms)?;
    Ok(base64::engine::general_purpose::STANDARD.encode(png))
}

#[cfg(not(windows))]
pub fn capture_frame_png_base64(_path: &str, _time_ms: u64) -> Result<String, String> {
    Err("截图仅支持 Windows".into())
}

#[cfg(windows)]
fn capture_frame_png(path: &str, time_ms: u64) -> Result<Vec<u8>, String> {
    use std::path::Path;

    use windows::core::HSTRING;
    use windows::Foundation::TimeSpan;
    use windows::Graphics::Imaging::ImageStream;
    use windows::Media::Editing::{MediaClip, MediaComposition, VideoFramePrecision};
    use windows::Storage::StorageFile;

    let path = path.trim();
    if path.is_empty() {
        return Err("视频路径为空".into());
    }
    if !Path::new(path).is_file() {
        return Err(format!("视频文件不存在: {}", path));
    }

    // WinRT async ops: block on this worker thread (command runs off UI via
    // spawn_blocking in the Tauri handler).
    let hpath = HSTRING::from(path);
    let file = StorageFile::GetFileFromPathAsync(&hpath)
        .map_err(win_err("打开视频文件"))?
        .get()
        .map_err(win_err("打开视频文件"))?;

    let clip = MediaClip::CreateFromFileAsync(&file)
        .map_err(win_err("解析视频"))?
        .get()
        .map_err(win_err("解析视频"))?;

    // Prefer native resolution when the container exposes it.
    let (width, height) = match clip.GetVideoEncodingProperties() {
        Ok(props) => {
            let w = props.Width().unwrap_or(0) as i32;
            let h = props.Height().unwrap_or(0) as i32;
            if w > 0 && h > 0 {
                (w, h)
            } else {
                (1920, 1080)
            }
        }
        Err(_) => (1920, 1080),
    };

    let composition = MediaComposition::new().map_err(win_err("创建合成"))?;
    composition
        .Clips()
        .map_err(win_err("访问片段列表"))?
        .Append(&clip)
        .map_err(win_err("添加视频片段"))?;

    // TimeSpan.Duration is 100 ns units.
    let time = TimeSpan {
        Duration: (time_ms as i64).saturating_mul(10_000),
    };

    // NearestFrame ≈ decoder seek + rasterize (PotPlayer-class); KeyFrame is
    // faster but can snap earlier.
    let stream: ImageStream = composition
        .GetThumbnailAsync(time, width, height, VideoFramePrecision::NearestFrame)
        .map_err(win_err("截取帧"))?
        .get()
        .map_err(win_err("截取帧"))?;

    let raw = read_image_stream(&stream)?;
    ensure_png(&raw)
}

#[cfg(windows)]
fn read_image_stream(stream: &windows::Graphics::Imaging::ImageStream) -> Result<Vec<u8>, String> {
    use windows::core::Interface;
    use windows::Storage::Streams::{DataReader, IRandomAccessStream};

    let size = stream.Size().map_err(win_err("读取流大小"))?;
    if size == 0 {
        return Err("截取结果为空".into());
    }
    if size > 64 * 1024 * 1024 {
        return Err("截取结果过大".into());
    }

    let ras: IRandomAccessStream = stream.cast().map_err(win_err("打开截图流"))?;
    let input = ras.GetInputStreamAt(0).map_err(win_err("打开截图流"))?;
    let reader = DataReader::CreateDataReader(&input).map_err(win_err("创建读取器"))?;
    reader
        .LoadAsync(size as u32)
        .map_err(win_err("加载截图数据"))?
        .get()
        .map_err(win_err("加载截图数据"))?;

    let mut buf = vec![0u8; size as usize];
    reader.ReadBytes(&mut buf).map_err(win_err("读取截图字节"))?;
    Ok(buf)
}

#[cfg(windows)]
fn ensure_png(bytes: &[u8]) -> Result<Vec<u8>, String> {
    use std::io::Cursor;

    // PNG signature
    if bytes.len() >= 8 && bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
        return Ok(bytes.to_vec());
    }

    let img = image::load_from_memory(bytes).map_err(|e| format!("解码截图失败: {}", e))?;
    let mut out = Vec::new();
    img.write_to(&mut Cursor::new(&mut out), image::ImageFormat::Png)
        .map_err(|e| format!("编码 PNG 失败: {}", e))?;
    if out.is_empty() {
        return Err("编码 PNG 失败: 空结果".into());
    }
    Ok(out)
}

#[cfg(windows)]
fn win_err(ctx: &'static str) -> impl Fn(windows::core::Error) -> String {
    move |e| format!("{}: {}", ctx, e.message())
}

#[cfg(test)]
mod tests {
    #[test]
    fn missing_file_errors() {
        #[cfg(windows)]
        {
            let err = super::capture_frame_png_base64("Z:\\definitely\\missing\\wui-frame.mp4", 0)
                .expect_err("missing file");
            assert!(
                err.contains("不存在") || err.contains("打开") || err.contains("文件"),
                "unexpected: {err}"
            );
        }
        #[cfg(not(windows))]
        {
            let err = super::capture_frame_png_base64("x.mp4", 0).unwrap_err();
            assert!(err.contains("Windows"));
        }
    }
}
