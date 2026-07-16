import type { MatchRecord } from '@wonderful-ui/parser';

/** First non-empty local video path for a match, or null. */
export function firstMatchVideoPath(m: MatchRecord | null | undefined): string | null {
  if (!m?.videos?.length) return null;
  for (const v of m.videos) {
    const p = typeof v.video_src === 'string' ? v.video_src.trim() : '';
    if (p) return p;
  }
  return null;
}
