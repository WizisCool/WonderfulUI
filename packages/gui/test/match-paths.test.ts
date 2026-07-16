import { describe, test, expect } from 'bun:test';
import { firstMatchVideoPath } from '../src/utils/match-paths.ts';
import type { MatchRecord, VideoItem } from '@wonderful-ui/parser';

function video(src: string): VideoItem {
  return {
    video_id: 'v',
    video_type: '击杀集锦',
    video_duration: 1,
    video_src: src,
    video_isProcessing: false,
    rounds: [],
  } as unknown as VideoItem;
}

function match(videos: VideoItem[]): MatchRecord {
  return { videos } as MatchRecord;
}

describe('firstMatchVideoPath', () => {
  test('returns null for empty / missing', () => {
    expect(firstMatchVideoPath(null)).toBeNull();
    expect(firstMatchVideoPath(undefined)).toBeNull();
    expect(firstMatchVideoPath(match([]))).toBeNull();
    expect(firstMatchVideoPath(match([video(''), video('  ')]))).toBeNull();
  });

  test('returns first non-empty video_src', () => {
    expect(
      firstMatchVideoPath(match([video(''), video('D:\\clips\\a.mp4'), video('D:\\clips\\b.mp4')])),
    ).toBe('D:\\clips\\a.mp4');
  });
});
