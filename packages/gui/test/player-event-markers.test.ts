import { describe, expect, test } from 'bun:test';
import { CANVAS_MARKER_THRESHOLD, effectiveMarkerDurationMs, layoutEventMarkers, renderCanvasMarkers } from '../src/utils/player-event-markers.ts';

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

  test('shows each marker individually — no clustering', () => {
    const markers = layoutEventMarkers([
      { timeMs: 10_000, type: 'kill', isHeadshot: false },
      { timeMs: 10_450, type: 'death', isHeadshot: true },
      { timeMs: 10_900, type: 'kill', isHeadshot: false },
      { timeMs: 40_000, type: 'death', isHeadshot: false },
    ], 100_000);

    expect(markers).toHaveLength(4);
    expect(markers[0]!.lane).toBe('upper');
    expect(markers[1]!.lane).toBe('lower');
    expect(markers[2]!.lane).toBe('upper');
    expect(markers[3]!.lane).toBe('lower');
    expect(markers[1]!.isHeadshot).toBe(true);
  });

  test('stacks near-colliding markers upward with longer stems', () => {
    const markers = layoutEventMarkers([
      { timeMs: 10_000, type: 'kill', isHeadshot: false },
      { timeMs: 10_300, type: 'kill', isHeadshot: true },
      { timeMs: 10_650, type: 'death', isHeadshot: false },
      { timeMs: 40_000, type: 'kill', isHeadshot: false },
    ], 100_000);

    expect(markers.map(m => m.stackLevel)).toEqual([0, 1, 2, 0]);
    expect(markers.map(m => m.stemPx)).toEqual([18.5, 26.5, 28.5, 18.5]);
    expect(markers[0]!.topPx).toBe(-32);
    expect(markers[1]!.topPx).toBeLessThan(markers[0]!.topPx);
    expect(markers[2]!.topPx).toBeLessThan(markers[1]!.topPx);
    // Stem tip at track top (y=0), not into the 4px progress fill.
    expect(markers.map(m => m.topPx + 11 + 3.5 - 1 + m.stemPx)).toEqual([0, 0, 0, 0]);
  });

  test('uses compact display on dense timelines to reduce visual noise', () => {
    const markers = layoutEventMarkers(Array.from({ length: 14 }, (_, idx) => ({
      timeMs: 5_000 + idx * 6_000,
      type: 'kill',
      isHeadshot: idx % 2 === 0,
    })), 100_000);

    expect(markers).toHaveLength(14);
    expect(markers.every(marker => marker.displayMode === 'compact')).toBe(true);
  });

  test('keeps sparse timeline markers in compact display mode by default', () => {
    const markers = layoutEventMarkers([
      { timeMs: 10_000, type: 'kill', isHeadshot: false },
      { timeMs: 80_000, type: 'death', isHeadshot: false },
    ], 100_000);

    expect(markers.map(marker => marker.displayMode)).toEqual(['compact', 'compact']);
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
