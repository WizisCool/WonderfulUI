/**
 * Paint the current decoded video frame onto a canvas for **display freeze**.
 *
 * Cross-origin (asset.localhost) video taints the canvas for export (toBlob /
 * getImageData), but drawImage still paints pixels for on-screen display.
 * That lets the player show a static frame even if HTMLMediaElement.pause()
 * races with WebView2 canplay/play.
 */
export function paintVideoFrameToCanvas(
  video: Pick<HTMLVideoElement, 'videoWidth' | 'videoHeight'> & CanvasImageSource,
  canvas: HTMLCanvasElement,
): boolean {
  const w = (video.videoWidth as number) | 0;
  const h = (video.videoHeight as number) | 0;
  if (w <= 0 || h <= 0) return false;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return false;
  try {
    ctx.drawImage(video as CanvasImageSource, 0, 0, w, h);
    return true;
  } catch {
    return false;
  }
}

export function clearFreezeCanvas(canvas: HTMLCanvasElement | null | undefined): void {
  if (!canvas) return;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width || 0, canvas.height || 0);
  }
  canvas.width = 0;
  canvas.height = 0;
}
