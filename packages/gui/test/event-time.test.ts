import { describe, expect, test } from 'bun:test';
import type { VideoItem } from '@wonderful-ui/parser';
import { clampSeekMsForDuration, eventSeekMsForVideo, playbackSeekMsForVideo, EVENT_PREROLL_MS } from '../src/utils/event-time.ts';

describe('eventSeekMsForVideo', () => {
  test('uses the primary video timestamp when it fits the video duration', () => {
    const video = { video_duration: 80_000 } as VideoItem;

    expect(eventSeekMsForVideo(video, 32_000, 2_000)).toBe(32_000);
  });

  test('falls back to event-local time for short highlight videos', () => {
    const video = { video_duration: 5_000 } as VideoItem;

    expect(eventSeekMsForVideo(video, 46_800, 1_800)).toBe(1_800);
  });

  test('clamps to the end when neither timestamp fits', () => {
    const video = { video_duration: 5_000 } as VideoItem;

    expect(eventSeekMsForVideo(video, 46_800, 8_000)).toBe(4_950);
  });
});

describe('playbackSeekMsForVideo', () => {
  test('returns primaryMs minus pre-roll when primary fits the video duration', () => {
    const video = { video_duration: 80_000 } as VideoItem;

    expect(playbackSeekMsForVideo(video, 32_000, 2_000)).toBe(30_000);
  });

  test('returns localEventMs minus pre-roll for short highlight fallback', () => {
    const video = { video_duration: 5_000 } as VideoItem;

    expect(playbackSeekMsForVideo(video, 46_800, 1_800)).toBe(0);
  });

  test('clamps to 0 when pre-roll would go below zero', () => {
    const video = { video_duration: 80_000 } as VideoItem;

    expect(playbackSeekMsForVideo(video, 500, 2_000)).toBe(0);
  });

  test('clamps at clamp-end then subtracts pre-roll when neither fits', () => {
    const video = { video_duration: 5_000 } as VideoItem;

    expect(playbackSeekMsForVideo(video, 46_800, 8_000)).toBe(2_950);
  });
});

describe('clampSeekMsForDuration', () => {
  test('keeps valid seek positions and clamps invalid ones into the playable range', () => {
    expect(clampSeekMsForDuration(2_000, 5)).toBe(2_000);
    expect(clampSeekMsForDuration(8_000, 5)).toBe(4_950);
    expect(clampSeekMsForDuration(-500, 5)).toBe(0);
  });
});

describe('EVENT_PREROLL_MS', () => {
  test('is 2000', () => {
    expect(EVENT_PREROLL_MS).toBe(2000);
  });
});
