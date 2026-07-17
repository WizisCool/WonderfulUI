import { describe, expect, test } from 'bun:test';
import {
  CANVAS_MARKER_THRESHOLD,
  MAX_STACK,
  MIN_BUCKET_MS,
  bucketEventMarkers,
  bucketWidthMs,
  effectiveMarkerDurationMs,
  layoutEventMarkers,
  renderCanvasMarkers,
} from '../src/utils/player-event-markers.ts';

describe('bucketEventMarkers', () => {
  test('merges markers within the same time bucket', () => {
    const bucketed = bucketEventMarkers(
      [
        { timeMs: 10_000, type: 'kill', isHeadshot: false },
        { timeMs: 10_200, type: 'kill', isHeadshot: true },
        { timeMs: 10_400, type: 'kill', isHeadshot: false },
        { timeMs: 40_000, type: 'death', isHeadshot: false },
      ],
      100_000,
      { minBucketMs: 500 },
    );
    expect(bucketed).toHaveLength(2);
    expect(bucketed[0]!.count).toBe(3);
    expect(bucketed[0]!.timeMs).toBe(10_000);
    expect(bucketed[0]!.isHeadshot).toBe(true);
    expect(bucketed[0]!.type).toBe('kill');
    expect(bucketed[1]!.count).toBe(1);
    expect(bucketed[1]!.type).toBe('death');
  });

  test('marks mixed kill+death buckets as mixed', () => {
    const bucketed = bucketEventMarkers(
      [
        { timeMs: 10_000, type: 'kill', isHeadshot: false },
        { timeMs: 10_100, type: 'death', isHeadshot: false },
      ],
      100_000,
      { minBucketMs: 500 },
    );
    expect(bucketed).toHaveLength(1);
    expect(bucketed[0]!.type).toBe('mixed');
    expect(bucketed[0]!.count).toBe(2);
  });

  test('keeps sparse markers unmerged', () => {
    const bucketed = bucketEventMarkers(
      [
        { timeMs: 10_000, type: 'kill', isHeadshot: false },
        { timeMs: 80_000, type: 'death', isHeadshot: false },
      ],
      100_000,
      { minBucketMs: 500 },
    );
    expect(bucketed).toHaveLength(2);
    expect(bucketed.every(m => m.count === 1)).toBe(true);
  });

  test('bucketWidthMs is at least MIN_BUCKET_MS', () => {
    expect(bucketWidthMs(100_000, { trackWidthPx: 2000 })).toBeGreaterThanOrEqual(MIN_BUCKET_MS);
  });
});

describe('layoutEventMarkers', () => {
  test('places kill and death events on separate lanes', () => {
    const markers = layoutEventMarkers([
      { timeMs: 25_000, type: 'kill', isHeadshot: false },
      { timeMs: 50_000, type: 'death', isHeadshot: false },
    ], 100_000);

    expect(markers).toHaveLength(2);
    expect(markers[0]).toMatchObject({
      lane: 'upper',
      leftPct: 25,
      isHeadshot: false,
    });
    expect(markers[0]!.marker).toMatchObject({ type: 'kill', timeMs: 25_000 });
    expect(markers[1]).toMatchObject({
      lane: 'lower',
      leftPct: 50,
      isHeadshot: false,
    });
    expect(markers[1]!.marker).toMatchObject({ type: 'death', timeMs: 50_000 });
  });

  test('places sparse markers without stacking', () => {
    const markers = layoutEventMarkers([
      { timeMs: 10_000, type: 'kill', isHeadshot: false },
      { timeMs: 40_000, type: 'death', isHeadshot: true },
      { timeMs: 70_000, type: 'kill', isHeadshot: false },
    ], 100_000);

    expect(markers).toHaveLength(3);
    expect(markers.map(m => m.stackLevel)).toEqual([0, 0, 0]);
    expect(markers[1]!.isHeadshot).toBe(true);
  });

  test('caps stack level so stems stay bounded', () => {
    // Force many collisions at same leftPct by using tiny duration + same times
    const markers = layoutEventMarkers(
      Array.from({ length: 8 }, (_, i) => ({
        timeMs: 10_000 + i,
        type: 'kill' as const,
        isHeadshot: false,
      })),
      100_000,
      { trackWidthPx: 200 },
    );
    expect(markers.every(m => m.stackLevel <= MAX_STACK)).toBe(true);
    const maxStem = Math.max(...markers.map(m => m.stemPx));
    // With MAX_STACK=2, stem must stay well below the old unbounded ~80px climb
    expect(maxStem).toBeLessThanOrEqual(40);
  });

  test('uses compact display by default', () => {
    const markers = layoutEventMarkers(Array.from({ length: 14 }, (_, idx) => ({
      timeMs: 5_000 + idx * 6_000,
      type: 'kill',
      isHeadshot: idx % 2 === 0,
    })), 100_000);

    expect(markers).toHaveLength(14);
    expect(markers.every(marker => marker.displayMode === 'compact')).toBe(true);
  });

  test('drops invalid markers and clamps positions to the video duration', () => {
    const markers = layoutEventMarkers([
      { timeMs: -500, type: 'kill', isHeadshot: false },
      { timeMs: 50_000, type: 'kill', isHeadshot: false },
      { timeMs: 130_000, type: 'death', isHeadshot: false },
    ], 100_000);

    expect(markers).toHaveLength(2);
    expect(markers[0]!.leftPct).toBe(50);
    expect(markers[1]!.marker.timeMs).toBe(100_000);
    expect(markers[1]!.leftPct).toBe(100);
  });

  test('bucket then layout collapses dense montage', () => {
    const raw = Array.from({ length: 40 }, (_, i) => ({
      timeMs: 20_000 + i * 120,
      type: 'kill' as const,
      isHeadshot: false,
    }));
    const durationMs = 100_000;
    const bucketed = bucketEventMarkers(raw, durationMs, { minBucketMs: 500 });
    const layouts = layoutEventMarkers(bucketed, durationMs);
    expect(bucketed.length).toBeLessThan(raw.length);
    expect(layouts.length).toBe(bucketed.length);
    expect(layouts.every(l => l.stackLevel <= MAX_STACK)).toBe(true);
  });
});

describe('effectiveMarkerDurationMs', () => {
  test('uses the real media duration when metadata is available', () => {
    const markers = [
      { timeMs: 30_000, type: 'kill', isHeadshot: false },
      { timeMs: 60_000, type: 'death', isHeadshot: false },
    ];

    expect(effectiveMarkerDurationMs(markers, 0, 120)).toBe(120_000);
  });

  test('does not trust a tiny video_duration that would collapse events at the end', () => {
    const markers = [
      { timeMs: 30_000, type: 'kill', isHeadshot: false },
      { timeMs: 90_000, type: 'death', isHeadshot: false },
    ];

    expect(effectiveMarkerDurationMs(markers, 120)).toBe(90_000);
  });
});

describe('renderCanvasMarkers', () => {
  test('is importable and is a function', () => {
    expect(typeof renderCanvasMarkers).toBe('function');
  });
});

describe('CANVAS_MARKER_THRESHOLD', () => {
  test('is Infinity (canvas mode disabled)', () => {
    expect(CANVAS_MARKER_THRESHOLD).toBe(Infinity);
  });
});
