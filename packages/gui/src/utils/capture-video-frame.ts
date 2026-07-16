/**
 * Capture the current decoded video frame as PNG (no player chrome).
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

export type VideoFrameSource = Pick<HTMLVideoElement, 'videoWidth' | 'videoHeight'> & {
  // drawImage accepts HTMLVideoElement; tests may pass a mock with same dims.
};

/**
 * Draw the current video frame at native resolution into a PNG Blob.
 * Throws CaptureFrameError when dimensions are missing or export fails.
 */
export async function captureVideoFramePng(video: HTMLVideoElement): Promise<Blob> {
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
  } catch {
    throw new CaptureFrameError('无法截取当前帧');
  }

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/png');
  });
  if (!blob || blob.size <= 0) {
    throw new CaptureFrameError('无法导出 PNG');
  }
  return blob;
}

export async function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  const buf = await blob.arrayBuffer();
  return new Uint8Array(buf);
}
