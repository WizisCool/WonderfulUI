export interface EventMarkerInput {
  timeMs: number;
  type: string;
  isHeadshot: boolean;
}

export type EventMarkerLane = 'upper' | 'lower';
export type EventMarkerDisplayMode = 'full' | 'compact';
export type EventMarkerPlacement = 'top' | 'bottom';

export interface EventMarkerLayout<T extends EventMarkerInput = EventMarkerInput> {
  timeMs: number;
  leftPct: number;
  lane: EventMarkerLane;
  stackLevel: number;
  topPx: number;
  stemPx: number;
  displayMode: EventMarkerDisplayMode;
  isHeadshot: boolean;
  placement: EventMarkerPlacement;
  marker: T;
}

export interface EventMarkerLayoutOptions {
  trackWidthPx?: number;
  placement?: EventMarkerPlacement;
  trackHeightPx?: number;
}

const MARKER_WIDTH_PX = 20;
const MARKER_GAP_PX = 4;
const DEFAULT_TRACK_WIDTH_PX = 640;
const STACK_STEP_PX = 8;
const UPPER_TOP_PX = -32;
const LOWER_TOP_PX = -26;
const FULL_MARKER_HEIGHT_PX = 24;
const COMPACT_MARKER_HEIGHT_PX = 22;
const FULL_DOT_RADIUS_PX = 8;
const COMPACT_DOT_RADIUS_PX = 3.5;
const STEM_DOT_OVERLAP_PX = 1;
const STEM_TRACK_OVERLAP_PX = 2;
const DEFAULT_TRACK_HEIGHT_PX = 4;
const GAP_BELOW_PX = 4;

export const MARKER_OVERHEAD_PX = Math.abs(UPPER_TOP_PX) + COMPACT_MARKER_HEIGHT_PX + 4;

export function effectiveMarkerDurationMs<T extends EventMarkerInput>(
  markers: T[],
  videoDurationMs = 0,
  mediaDurationSeconds = 0,
): number {
  const maxMarkerMs = Math.max(0, ...markers
    .filter(marker => Number.isFinite(marker.timeMs) && marker.timeMs >= 0)
    .map(marker => marker.timeMs));
  const mediaDurationMs = Number.isFinite(mediaDurationSeconds) && mediaDurationSeconds > 0
    ? mediaDurationSeconds * 1000
    : 0;
  const declaredDurationMs = Number.isFinite(videoDurationMs) && videoDurationMs > 0
    ? videoDurationMs
    : 0;
  return Math.max(maxMarkerMs, mediaDurationMs, declaredDurationMs);
}

export function layoutEventMarkers<T extends EventMarkerInput>(
  markers: T[],
  durationMs: number,
  options: EventMarkerLayoutOptions = {},
): EventMarkerLayout<T>[] {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return [];
  const placement = options.placement ?? 'top';
  const trackHeightPx = options.trackHeightPx ?? DEFAULT_TRACK_HEIGHT_PX;
  const minGapPct = markerCollisionPct(options.trackWidthPx);
  const layouts: EventMarkerLayout<T>[] = [];
  const validMarkers = markers
    .filter(m => Number.isFinite(m.timeMs) && m.timeMs >= 0)
    .map(m => ({
      ...m,
      timeMs: Math.min(durationMs, m.timeMs),
    }))
    .sort((a, b) => a.timeMs - b.timeMs);

  return validMarkers.map(marker => {
    const leftPct = roundPct(timeToPct(marker.timeMs, durationMs));
    const lane = marker.type === 'kill' ? 'upper' as const : 'lower' as const;
    const stackLevel = nextStackLevel(layouts, leftPct, minGapPct);
    const displayMode = 'compact' as const;
    const topPx = placement === 'top'
      ? laneTopPx(lane) - stackLevel * STACK_STEP_PX
      : trackHeightPx + GAP_BELOW_PX + stackLevel * STACK_STEP_PX;
    const layout = {
      timeMs: marker.timeMs,
      leftPct,
      lane,
      stackLevel,
      topPx,
      stemPx: markerStemPx(topPx, displayMode, placement, trackHeightPx),
      displayMode,
      isHeadshot: marker.isHeadshot,
      placement,
      marker,
    };
    layouts.push(layout);
    return layout;
  });
}

function timeToPct(timeMs: number, durationMs: number): number {
  return Math.min(100, Math.max(0, (timeMs / durationMs) * 100));
}

function roundPct(value: number): number {
  return Math.round(value * 100) / 100;
}

function markerCollisionPct(trackWidthPx?: number): number {
  const width = Number.isFinite(trackWidthPx) && trackWidthPx && trackWidthPx > 0
    ? trackWidthPx
    : DEFAULT_TRACK_WIDTH_PX;
  return ((MARKER_WIDTH_PX + MARKER_GAP_PX) / width) * 100;
}

function nextStackLevel<T extends EventMarkerInput>(
  layouts: EventMarkerLayout<T>[],
  leftPct: number,
  minGapPct: number,
): number {
  const colliding = layouts.filter(layout => Math.abs(leftPct - layout.leftPct) < minGapPct);
  if (colliding.length === 0) return 0;
  return Math.max(...colliding.map(layout => layout.stackLevel)) + 1;
}

function laneTopPx(lane: EventMarkerLane): number {
  return lane === 'upper' ? UPPER_TOP_PX : LOWER_TOP_PX;
}

function markerStemPx(
  topPx: number,
  displayMode: EventMarkerDisplayMode,
  placement: EventMarkerPlacement,
  trackHeightPx: number,
): number {
  const markerHeight = displayMode === 'compact' ? COMPACT_MARKER_HEIGHT_PX : FULL_MARKER_HEIGHT_PX;
  const dotRadius = displayMode === 'compact' ? COMPACT_DOT_RADIUS_PX : FULL_DOT_RADIUS_PX;
  if (placement === 'bottom') {
    const stemPx = topPx + markerHeight / 2 - dotRadius - trackHeightPx + STEM_TRACK_OVERLAP_PX;
    return Math.max(6, stemPx);
  }
  const stemPx = -topPx
    - markerHeight / 2
    - dotRadius
    + STEM_DOT_OVERLAP_PX
    + STEM_TRACK_OVERLAP_PX;
  return Math.max(6, stemPx);
}
