/**
 * Capture the current decoded video frame as PNG (no player chrome).
 *
 * Playback uses `wui-media` + `crossOrigin="anonymous"` so live `drawImage` is
 * CORS-clean (one draw + toBlob, ms-level). If the live element still taints
 * (legacy asset URL / browser debug), fall back to a same-origin blob clone.
 * Do not hot-swap the live player `src` — that kills first-play performance.
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

// ── Per-path blob cache (module-level; one video at a time in the player) ──

interface BlobCacheEntry {
  path: string;
  blob: Blob;
  objectUrl: string;
}

const blobCache = new Map<string, BlobCacheEntry>();
const blobLoads = new Map<string, Promise<BlobCacheEntry>>();

/** Hidden video reused for seek+draw when live element is still tainted. */
let cloneVideo: HTMLVideoElement | null = null;
let cloneVideoPath: string | null = null;

export function releaseVideoBlobCache(path?: string | null): void {
  if (path) {
    const e = blobCache.get(path);
    if (e) {
      URL.revokeObjectURL(e.objectUrl);
      blobCache.delete(path);
    }
    blobLoads.delete(path);
    if (cloneVideoPath === path) {
      teardownCloneVideo();
    }
    return;
  }
  for (const e of blobCache.values()) URL.revokeObjectURL(e.objectUrl);
  blobCache.clear();
  blobLoads.clear();
  teardownCloneVideo();
}

function teardownCloneVideo(): void {
  if (cloneVideo) {
    cloneVideo.removeAttribute('src');
    cloneVideo.load();
    cloneVideo = null;
  }
  cloneVideoPath = null;
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

/** Ensure path is in blob cache; concurrent callers share one load. */
export async function ensureVideoBlobCache(
  filePath: string,
  convertFileSrc?: (path: string) => string,
): Promise<BlobCacheEntry> {
  const path = filePath.trim();
  if (!path) throw new CaptureFrameError('无法读取视频文件: 路径为空');
  const hit = blobCache.get(path);
  if (hit) return hit;

  let pending = blobLoads.get(path);
  if (!pending) {
    pending = (async () => {
      const blob = await loadLocalVideoBlob(path, convertFileSrc);
      // Evict other paths — player only needs the open clip.
      for (const [k, e] of blobCache) {
        if (k !== path) {
          URL.revokeObjectURL(e.objectUrl);
          blobCache.delete(k);
        }
      }
      if (cloneVideoPath && cloneVideoPath !== path) teardownCloneVideo();
      const entry: BlobCacheEntry = {
        path,
        blob,
        objectUrl: URL.createObjectURL(blob),
      };
      blobCache.set(path, entry);
      blobLoads.delete(path);
      return entry;
    })().catch((err) => {
      blobLoads.delete(path);
      throw err;
    });
    blobLoads.set(path, pending);
  }
  return pending;
}

/** Fire-and-forget warm-up so first screenshot is not cold. */
export function prefetchVideoBlob(
  filePath: string | null | undefined,
  convertFileSrc?: (path: string) => string,
): void {
  const path = filePath?.trim();
  if (!path) return;
  void ensureVideoBlobCache(path, convertFileSrc).catch(() => {
    /* warm-up is best-effort */
  });
}

export function isBlobUrl(src: string | null | undefined): boolean {
  return !!src && src.startsWith('blob:');
}

/** True when live video can be exported without taint (blob: or data:). */
export function isExportSafeVideoSrc(src: string | null | undefined): boolean {
  if (!src) return false;
  return src.startsWith('blob:') || src.startsWith('data:');
}

// ── Filename helpers ───────────────────────────────────────────────────────

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

/**
 * Draw video → PNG. Fast path: one drawImage + one toBlob (no toDataURL probe).
 */
export async function drawVideoToPng(video: HTMLVideoElement): Promise<Blob> {
  const w = video.videoWidth | 0;
  const h = video.videoHeight | 0;
  if (w <= 0 || h <= 0) {
    throw new CaptureFrameError('视频帧尚未就绪');
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { alpha: false });
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

  const blob = await new Promise<Blob | null>((resolve, reject) => {
    try {
      // quality ignored for png; keeps encode snappy
      canvas.toBlob((b) => resolve(b), 'image/png');
    } catch (e) {
      reject(e);
    }
  });
  if (!blob || blob.size <= 0) {
    throw new CaptureFrameError('Tainted canvases may not be exported.');
  }
  return blob;
}

/**
 * Reuse one hidden video element bound to the cached blob URL.
 * Only re-seeks when currentTime differs — avoids re-reading the file.
 */
async function captureViaCachedClone(
  live: HTMLVideoElement,
  filePath: string,
  convertFileSrc?: (path: string) => string,
): Promise<Blob> {
  const targetTime = Number.isFinite(live.currentTime) ? Math.max(0, live.currentTime) : 0;
  const entry = await ensureVideoBlobCache(filePath, convertFileSrc);

  if (!cloneVideo || cloneVideoPath !== filePath) {
    teardownCloneVideo();
    cloneVideo = document.createElement('video');
    cloneVideo.muted = true;
    cloneVideo.playsInline = true;
    cloneVideo.preload = 'auto';
    cloneVideo.src = entry.objectUrl;
    cloneVideoPath = filePath;
    if (cloneVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      await waitVideoEvent(cloneVideo, 'loadeddata');
    }
  }

  const clone = cloneVideo;
  const dur = Number.isFinite(clone.duration) ? clone.duration : 0;
  const seekTo = dur > 0 ? Math.min(targetTime, Math.max(0, dur - 0.05)) : targetTime;
  if (Math.abs(clone.currentTime - seekTo) > 0.02) {
    const seeked = waitVideoEvent(clone, 'seeked', 8_000);
    clone.currentTime = seekTo;
    await seeked;
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
  }
  return drawVideoToPng(clone);
}

/**
 * Draw the current video frame at native resolution into a PNG Blob.
 * Prefer live element (CORS-clean player src); else lazy blob-clone fallback.
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
    return await captureViaCachedClone(video, options.filePath!.trim(), options.convertFileSrc);
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
