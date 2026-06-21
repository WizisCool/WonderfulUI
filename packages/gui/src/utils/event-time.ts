import type { VideoItem } from '@wonderful-ui/parser';

export const EVENT_PREROLL_MS = 2000;

export function eventSeekMsForVideo(
  video: VideoItem,
  primaryMs: number,
  localEventMs: number,
): number {
  const duration = video.video_duration;
  if (!Number.isFinite(duration) || duration <= 0) return primaryMs;
  if (primaryMs >= 0 && primaryMs <= duration) return primaryMs;
  if (localEventMs >= 0 && localEventMs <= duration) return localEventMs;
  return clampSeekMsForDuration(primaryMs, duration / 1000);
}

export function playbackSeekMsForVideo(
  video: VideoItem,
  primaryMs: number,
  localEventMs: number,
): number {
  return Math.max(0, eventSeekMsForVideo(video, primaryMs, localEventMs) - EVENT_PREROLL_MS);
}

export function clampSeekMsForDuration(seekMs: number, durationSeconds: number): number {
  if (!Number.isFinite(seekMs)) return 0;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return Math.max(0, seekMs);
  const maxMs = Math.max(0, durationSeconds * 1000 - 50);
  return Math.max(0, Math.min(seekMs, maxMs));
}
