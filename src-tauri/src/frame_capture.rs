//! Native video-frame capture at a timestamp (Windows).
//!
//! Media Foundation `IMFSourceReader`: seek + decode one RGB32 frame.
//! Caches one reader per path so repeat screenshots of the open clip stay fast.
//! COM objects are only used under a mutex (MTA + single accessor).

use base64::Engine;
use std::sync::Mutex;

/// Capture one frame as PNG (base64) at `time_ms`.
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

    let path = path.trim();
    if path.is_empty() {
        return Err("视频路径为空".into());
    }
    if !Path::new(path).is_file() {
        return Err(format!("视频文件不存在: {}", path));
    }

    ensure_mf_started()?;
    let target_hns = (time_ms as i64).saturating_mul(10_000);
    let bgra = with_reader(path, |reader| read_frame_bgra(reader, target_hns))?;
    encode_bgra_png_fast(&bgra.pixels, bgra.width, bgra.height)
}

// ── MF startup ─────────────────────────────────────────────────────────────

#[cfg(windows)]
static MF_STARTED: std::sync::OnceLock<Result<(), String>> = std::sync::OnceLock::new();

#[cfg(windows)]
fn ensure_mf_started() -> Result<(), String> {
    MF_STARTED
        .get_or_init(|| unsafe {
            let _ = windows::Win32::System::Com::CoInitializeEx(
                None,
                windows::Win32::System::Com::COINIT_MULTITHREADED,
            );
            windows::Win32::Media::MediaFoundation::MFStartup(
                windows::Win32::Media::MediaFoundation::MF_VERSION,
                windows::Win32::Media::MediaFoundation::MFSTARTUP_FULL,
            )
            .map_err(|e| format!("初始化 Media Foundation 失败: {}", e.message()))
        })
        .clone()
}

// ── Cached reader ──────────────────────────────────────────────────────────

#[cfg(windows)]
struct ReaderSession {
    path: String,
    reader: windows::Win32::Media::MediaFoundation::IMFSourceReader,
}

// SAFETY: IMFSourceReader is only used under SESSION mutex from spawn_blocking
// workers (one accessor at a time). MF is initialized as MTA.
#[cfg(windows)]
unsafe impl Send for ReaderSession {}

#[cfg(windows)]
static SESSION: Mutex<Option<ReaderSession>> = Mutex::new(None);

#[cfg(windows)]
fn with_reader<T>(
    path: &str,
    f: impl FnOnce(&windows::Win32::Media::MediaFoundation::IMFSourceReader) -> Result<T, String>,
) -> Result<T, String> {
    let mut guard = SESSION
        .lock()
        .map_err(|_| "截图会话锁失败".to_string())?;

    let need_new = match guard.as_ref() {
        Some(s) => s.path != path,
        None => true,
    };
    if need_new {
        *guard = Some(ReaderSession {
            path: path.to_string(),
            reader: create_source_reader(path)?,
        });
    }
    let session = guard.as_ref().expect("session set");
    f(&session.reader)
}

#[cfg(windows)]
fn create_source_reader(
    path: &str,
) -> Result<windows::Win32::Media::MediaFoundation::IMFSourceReader, String> {
    use windows::core::HSTRING;
    use windows::Win32::Media::MediaFoundation::*;

    unsafe {
        let mut attrs: Option<IMFAttributes> = None;
        MFCreateAttributes(&mut attrs, 2).map_err(win_err("创建 MF 属性"))?;
        let attrs = attrs.ok_or_else(|| "创建 MF 属性失败".to_string())?;
        attrs
            .SetUINT32(&MF_SOURCE_READER_ENABLE_VIDEO_PROCESSING, 1)
            .map_err(win_err("启用视频处理"))?;
        let _ = attrs.SetUINT32(&MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, 1);

        let url = HSTRING::from(path);
        let reader =
            MFCreateSourceReaderFromURL(&url, &attrs).map_err(win_err("打开视频解码器"))?;

        reader
            .SetStreamSelection(MF_SOURCE_READER_ALL_STREAMS.0 as u32, false)
            .map_err(win_err("关闭非视频流"))?;
        reader
            .SetStreamSelection(MF_SOURCE_READER_FIRST_VIDEO_STREAM.0 as u32, true)
            .map_err(win_err("选择视频流"))?;

        let media_type = MFCreateMediaType().map_err(win_err("创建媒体类型"))?;
        media_type
            .SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)
            .map_err(win_err("设置主类型"))?;
        media_type
            .SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_RGB32)
            .map_err(win_err("设置 RGB32"))?;
        reader
            .SetCurrentMediaType(
                MF_SOURCE_READER_FIRST_VIDEO_STREAM.0 as u32,
                None,
                &media_type,
            )
            .map_err(win_err("配置 RGB 输出"))?;

        Ok(reader)
    }
}

// ── Seek + decode ──────────────────────────────────────────────────────────

#[cfg(windows)]
struct BgraFrame {
    width: u32,
    height: u32,
    pixels: Vec<u8>,
}

#[cfg(windows)]
fn read_frame_bgra(
    reader: &windows::Win32::Media::MediaFoundation::IMFSourceReader,
    target_hns: i64,
) -> Result<BgraFrame, String> {
    use windows::core::GUID;
    use windows::Win32::Media::MediaFoundation::*;

    unsafe {
        let mut target = target_hns.max(0);
        if let Ok(dur) = presentation_duration_hns(reader) {
            if dur > 0 && target >= dur {
                target = dur.saturating_sub(10_000);
            }
        }

        let pos = propvariant_i8(target);
        reader
            .SetCurrentPosition(&GUID::zeroed(), &pos)
            .map_err(win_err("定位视频时间"))?;

        // Fast path: first usable sample after seek (keyframe-biased, near-target).
        // Enough for highlight screenshots; avoids long nearest-frame walks.
        const MAX_SAMPLES: u32 = 24;
        let mut chosen: Option<IMFSample> = None;

        for _ in 0..MAX_SAMPLES {
            let mut flags = 0u32;
            let mut timestamp = 0i64;
            let mut sample: Option<IMFSample> = None;
            reader
                .ReadSample(
                    MF_SOURCE_READER_FIRST_VIDEO_STREAM.0 as u32,
                    0,
                    None,
                    Some(&mut flags),
                    Some(&mut timestamp),
                    Some(&mut sample),
                )
                .map_err(win_err("解码帧"))?;

            if (flags as i32) & MF_SOURCE_READERF_ENDOFSTREAM.0 != 0 {
                break;
            }
            if (flags as i32) & MF_SOURCE_READERF_STREAMTICK.0 != 0 {
                continue;
            }
            if let Some(s) = sample {
                chosen = Some(s);
                // Prefer first sample at/after target; otherwise keep last before.
                if timestamp >= target {
                    break;
                }
            }
        }

        let sample = chosen.ok_or_else(|| "无法解码目标时间附近的帧".to_string())?;
        sample_to_bgra(reader, &sample)
    }
}

#[cfg(windows)]
fn propvariant_i8(value: i64) -> windows::Win32::System::Com::StructuredStorage::PROPVARIANT {
    use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;
    use windows::Win32::System::Variant::VT_I8;

    // Layout matches Win32 PROPVARIANT for VT_I8 (no heap allocation).
    #[repr(C)]
    struct Raw {
        vt: u16,
        r1: u16,
        r2: u16,
        r3: u16,
        h_val: i64,
        pad: u64, // rest of 16-byte data union on x64
    }
    let raw = Raw {
        vt: VT_I8.0,
        r1: 0,
        r2: 0,
        r3: 0,
        h_val: value,
        pad: 0,
    };
    unsafe {
        debug_assert!(std::mem::size_of::<Raw>() <= std::mem::size_of::<PROPVARIANT>());
        let mut out = PROPVARIANT::default();
        std::ptr::copy_nonoverlapping(
            &raw as *const Raw as *const u8,
            &mut out as *mut PROPVARIANT as *mut u8,
            std::mem::size_of::<Raw>().min(std::mem::size_of::<PROPVARIANT>()),
        );
        out
    }
}

#[cfg(windows)]
fn presentation_duration_hns(
    reader: &windows::Win32::Media::MediaFoundation::IMFSourceReader,
) -> Result<i64, String> {
    use windows::Win32::Media::MediaFoundation::*;
    use windows::Win32::System::Com::StructuredStorage::PropVariantClear;

    unsafe {
        let mut var = reader
            .GetPresentationAttribute(MF_SOURCE_READER_MEDIASOURCE.0 as u32, &MF_PD_DURATION)
            .map_err(win_err("读取时长"))?;
        let hns = propvariant_as_i64(&var);
        let _ = PropVariantClear(&mut var);
        hns.ok_or_else(|| "无效时长".to_string())
    }
}

#[cfg(windows)]
fn propvariant_as_i64(
    var: &windows::Win32::System::Com::StructuredStorage::PROPVARIANT,
) -> Option<i64> {
    unsafe {
        let vt = var.Anonymous.Anonymous.vt.0;
        // VT_I8=20, VT_UI8=21
        if vt == 20 || vt == 21 {
            Some(var.Anonymous.Anonymous.Anonymous.hVal)
        } else {
            None
        }
    }
}

#[cfg(windows)]
fn sample_to_bgra(
    reader: &windows::Win32::Media::MediaFoundation::IMFSourceReader,
    sample: &windows::Win32::Media::MediaFoundation::IMFSample,
) -> Result<BgraFrame, String> {
    use windows::core::Interface;
    use windows::Win32::Media::MediaFoundation::*;

    unsafe {
        let media_type = reader
            .GetCurrentMediaType(MF_SOURCE_READER_FIRST_VIDEO_STREAM.0 as u32)
            .map_err(win_err("读取媒体类型"))?;

        // MF_MT_FRAME_SIZE is packed: high 32 = width, low 32 = height.
        let packed = media_type
            .GetUINT64(&MF_MT_FRAME_SIZE)
            .map_err(win_err("读取分辨率"))?;
        let width = (packed >> 32) as u32;
        let height = packed as u32;
        if width == 0 || height == 0 {
            return Err("无效分辨率".into());
        }

        let buffer = sample
            .ConvertToContiguousBuffer()
            .map_err(win_err("锁定帧缓冲"))?;

        if let Ok(buf2d) = buffer.cast::<IMF2DBuffer>() {
            let mut scan0 = std::ptr::null_mut();
            let mut pitch = 0i32;
            buf2d
                .Lock2D(&mut scan0, &mut pitch)
                .map_err(win_err("Lock2D"))?;
            let result = copy_scanlines(scan0, pitch, width, height);
            let _ = buf2d.Unlock2D();
            return result;
        }

        let mut data = std::ptr::null_mut();
        let mut max_len = 0u32;
        let mut cur_len = 0u32;
        buffer
            .Lock(&mut data, Some(&mut max_len), Some(&mut cur_len))
            .map_err(win_err("Lock 缓冲"))?;
        let stride = (width as i32).saturating_mul(4);
        let result = copy_scanlines(data, stride, width, height);
        let _ = buffer.Unlock();
        result
    }
}

#[cfg(windows)]
fn copy_scanlines(
    scan0: *mut u8,
    pitch: i32,
    width: u32,
    height: u32,
) -> Result<BgraFrame, String> {
    if scan0.is_null() {
        return Err("空帧缓冲".into());
    }
    let row_bytes = (width as usize).saturating_mul(4);
    let mut pixels = vec![0u8; row_bytes.saturating_mul(height as usize)];
    unsafe {
        for y in 0..height as i32 {
            let src = scan0.offset((y as isize) * (pitch as isize));
            let dst = pixels.as_mut_ptr().add((y as usize) * row_bytes);
            std::ptr::copy_nonoverlapping(src, dst, row_bytes);
            for x in 0..width as usize {
                *dst.add(x * 4 + 3) = 0xFF;
            }
        }
    }
    Ok(BgraFrame {
        width,
        height,
        pixels,
    })
}

#[cfg(windows)]
fn encode_bgra_png_fast(pixels: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    use image::codecs::png::{CompressionType, FilterType, PngEncoder};
    use image::{ColorType, ImageEncoder};

    let mut rgba = Vec::with_capacity(pixels.len());
    for chunk in pixels.chunks_exact(4) {
        rgba.push(chunk[2]);
        rgba.push(chunk[1]);
        rgba.push(chunk[0]);
        rgba.push(chunk[3]);
    }

    let mut out = Vec::new();
    {
        let encoder =
            PngEncoder::new_with_quality(&mut out, CompressionType::Fast, FilterType::NoFilter);
        encoder
            .write_image(&rgba, width, height, ColorType::Rgba8.into())
            .map_err(|e| format!("编码 PNG 失败: {}", e))?;
    }
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
                err.contains("不存在") || err.contains("打开") || err.contains("解码"),
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
