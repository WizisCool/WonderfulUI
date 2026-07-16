/**
 * Capture the current decoded video frame as PNG (no player chrome).
 *
 * Playing via Tauri `convertFileSrc` (asset.localhost) taints canvas on drawImage,
 * so toBlob fails with "Tainted canvases may not be exported". Fallback: load the
 * local file into a same-origin blob: URL video, seek to the same time, then export.
 */

const WIN_ILLEGAL = /[<>:"/\\|?*\u0000-\u001f]/g;

export class CaptureFrameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CaptureFrameError';
  }
}

export interface CaptureFrameOptions {
  /** Absolute filesystem path of the playing file (for untainted fallback). */
  filePath?: string | null;
  /** Tauri convertFileSrc — used to fetch bytes when asset protocol is available. */
  convertFileSrc?: (path: string) => string;
}

/** Strip Windows-illegal path characters and collapse whitespace. */
export function sanitizeFileStem(name: string): string {
  const cleaned = name
    .replace(WIN_ILLEGAL, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/\.+$/, '');
  return cleaned || '精彩时刻';
}

/** Format floor(currentTime) as m-ss for filenames (colon → hyphen). */
export function formatTimeForFilename(currentTimeSec: number): string {
  const t = Number.isFinite(currentTimeSec) ? Math.max(0, Math.floor(currentTimeSec)) : 0;
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${m}-${String(s).padStart(2, '0')}`;
}

/** Basename without extension from a local path. */
export function videoStemFromPath(videoPath: string | null | undefined): string {
  if (!videoPath) return '精彩时刻';
  const base = videoPath.split(/[/\\]/).pop() || videoPath;
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return sanitizeFileStem(stem);
}

/** Default Save As name: `{stem}_{m-ss}.png`. */
export function defaultScreenshotName(
  videoPath: string | null | undefined,
  currentTimeSec: number,
): string {
  return `${videoStemFromPath(videoPath)}_${formatTimeForFilename(currentTimeSec)}.png`;
}

export function isCanvasTaintError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /taint/i.test(msg) || /cross-origin/i.test(msg) || /SecurityError/i.test(msg);
}

function waitVideoEvent(video: HTMLVideoElement, event: string, timeoutMs = 15_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => {
      cleanup();
      reject(new CaptureFrameError('截图超时：视频未就绪'));
    }, timeoutMs);
    const onOk = () => {
      cleanup();
      resolve();
    };
    const onErr = () => {
      cleanup();
      reject(new CaptureFrameError('截图失败：视频加载错误'));
    };
    const cleanup = () => {
      window.clearTimeout(t);
      video.removeEventListener(event, onOk);
      video.removeEventListener('error', onErr);
    };
    video.addEventListener(event, onOk, { once: true });
    video.addEventListener('error', onErr, { once: true });
  });
}

/** Draw video → PNG; throws CaptureFrameError (including taint as message). */
export async function drawVideoToPng(video: HTMLVideoElement): Promise<Blob> {
  const w = video.videoWidth | 0;
  const h = video.videoHeight | 0;
  if (w <= 0 || h <= 0) {
    throw new CaptureFrameError('视频帧尚未就绪');
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new CaptureFrameError('无法创建画布');
  }

  try {
    ctx.drawImage(video, 0, 0, w, h);
  } catch (e) {
    if (isCanvasTaintError(e)) {
      throw new CaptureFrameError('Tainted canvases may not be exported.');
    }
    throw new CaptureFrameError('无法截取当前帧');
  }

  // Probe taint early (toBlob often returns null without throwing).
  try {
    canvas.toDataURL('image/png');
  } catch (e) {
    if (isCanvasTaintError(e)) {
      throw new CaptureFrameError('Tainted canvases may not be exported.');
    }
    throw new CaptureFrameError('无法导出 PNG');
  }

  const blob = await new Promise<Blob | null>((resolve, reject) => {
    try {
      canvas.toBlob((b) => resolve(b), 'image/png');
    } catch (e) {
      reject(e);
    }
  });
  if (!blob || blob.size <= 0) {
    // Chromium often returns null for tainted canvas instead of throwing.
    throw new CaptureFrameError('Tainted canvases may not be exported.');
  }
  return blob;
}

function guessVideoMime(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.mkv')) return 'video/x-matroska';
  return 'video/mp4';
}

async function loadLocalVideoBlob(
  filePath: string,
  convertFileSrc?: (path: string) => string,
): Promise<Blob> {
  if (convertFileSrc) {
    try {
      const res = await fetch(convertFileSrc(filePath));
      if (res.ok) {
        const blob = await res.blob();
        if (blob.size > 0) return blob;
      }
    } catch {
      /* fall through to fs */
    }
  }

  try {
    const { readFile } = await import('@tauri-apps/plugin-fs');
    const bytes = await readFile(filePath);
    return new Blob([bytes], { type: guessVideoMime(filePath) });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new CaptureFrameError(`无法读取视频文件: ${detail}`);
  }
}

/**
 * Same-origin clone: blob: URL is not cross-origin, so canvas export works.
 * Seeks to the live player's currentTime (clamped to clone duration).
 */
async function captureViaBlobClone(
  live: HTMLVideoElement,
  filePath: string,
  convertFileSrc?: (path: string) => string,
): Promise<Blob> {
  const targetTime = Number.isFinite(live.currentTime) ? Math.max(0, live.currentTime) : 0;
  const fileBlob = await loadLocalVideoBlob(filePath, convertFileSrc);
  const objectUrl = URL.createObjectURL(fileBlob);
  const clone = document.createElement('video');
  clone.muted = true;
  clone.playsInline = true;
  clone.preload = 'auto';

  try {
    clone.src = objectUrl;
    // loadeddata = first frame available; metadata alone may leave videoWidth 0.
    if (clone.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      await waitVideoEvent(clone, 'loadeddata');
    }
    const dur = Number.isFinite(clone.duration) ? clone.duration : 0;
    const seekTo = dur > 0 ? Math.min(targetTime, Math.max(0, dur - 0.05)) : targetTime;
    if (Math.abs(clone.currentTime - seekTo) > 0.01) {
      const seeked = waitVideoEvent(clone, 'seeked');
      clone.currentTime = seekTo;
      await seeked;
    }
    // One rAF so the decoder paints the seeked frame before drawImage.
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    return await drawVideoToPng(clone);
  } finally {
    clone.removeAttribute('src');
    clone.load();
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Draw the current video frame at native resolution into a PNG Blob.
 * Uses a same-origin blob: clone when the live asset:// source would taint canvas.
 */
export async function captureVideoFramePng(
  video: HTMLVideoElement,
  options: CaptureFrameOptions = {},
): Promise<Blob> {
  try {
    return await drawVideoToPng(video);
  } catch (e) {
    const path = options.filePath?.trim();
    if (!path || !isCanvasTaintError(e)) {
      if (e instanceof CaptureFrameError) throw e;
      throw new CaptureFrameError(e instanceof Error ? e.message : String(e));
    }
  }

  try {
    return await captureViaBlobClone(video, options.filePath!.trim(), options.convertFileSrc);
  } catch (e) {
    if (e instanceof CaptureFrameError) throw e;
    if (isCanvasTaintError(e)) {
      throw new CaptureFrameError('无法导出截图（跨域限制），请重试或检查视频路径');
    }
    throw new CaptureFrameError(e instanceof Error ? e.message : String(e));
  }
}

export async function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  const buf = await blob.arrayBuffer();
  return new Uint8Array(buf);
}

/** User-facing Chinese message for capture/clipboard failures. */
export function formatCaptureError(err: unknown, action: 'copy' | 'save'): string {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  if (isCanvasTaintError(raw) || /无法导出|跨域/.test(raw)) {
    return action === 'copy'
      ? '复制截图失败：无法导出当前帧'
      : '保存截图失败：无法导出当前帧';
  }
  if (err instanceof CaptureFrameError) {
    if (raw.includes('尚未就绪')) return '视频帧尚未就绪，请稍后再试';
    if (raw.includes('读取视频')) return raw;
    return action === 'copy' ? `复制截图失败：${raw}` : `保存截图失败：${raw}`;
  }
  return action === 'copy' ? `复制截图失败：${raw}` : `保存截图失败：${raw}`;
}
