/**
 * Screenshot helpers for the player context menu.
 *
 * Frame pixels come only from Rust `capture_video_frame` (Windows MediaComposition).
 * This module handles filename sanitization, base64 → Blob, and error copy.
 */

const WIN_ILLEGAL = /[<>:"/\\|?*\u0000-\u001f]/g;

export class CaptureFrameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CaptureFrameError';
  }
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

export async function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  const buf = await blob.arrayBuffer();
  return new Uint8Array(buf);
}

/** Decode standard base64 (no data: prefix) to bytes. */
export function base64ToUint8Array(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function base64PngToBlob(b64: string): Blob {
  const bytes = base64ToUint8Array(b64);
  return new Blob([bytes], { type: 'image/png' });
}

/** User-facing Chinese message for capture/clipboard failures. */
export function formatCaptureError(err: unknown, action: 'copy' | 'save'): string {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  if (/无法导出|跨域|taint|SecurityError/i.test(raw)) {
    return action === 'copy'
      ? '复制截图失败：无法导出当前帧'
      : '保存截图失败：无法导出当前帧';
  }
  if (err instanceof CaptureFrameError) {
    if (raw.includes('尚未就绪')) return '视频帧尚未就绪，请稍后再试';
    if (raw.includes('读取视频') || raw.includes('不存在') || raw.includes('打开')) return raw;
    return action === 'copy' ? `复制截图失败：${raw}` : `保存截图失败：${raw}`;
  }
  if (!raw || raw === 'undefined') {
    return action === 'copy' ? '复制截图失败' : '保存截图失败';
  }
  return action === 'copy' ? `复制截图失败：${raw}` : `保存截图失败：${raw}`;
}
