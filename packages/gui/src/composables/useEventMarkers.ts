import { ref, watch, type Ref } from 'vue';
import {
  bucketEventMarkers,
  layoutEventMarkers,
  renderCanvasMarkers,
  CANVAS_MARKER_THRESHOLD,
  type EventMarkerLayout,
  type BucketedEventMarker,
} from '../utils/player-event-markers.ts';
import { eventMarkersForVideo, type EventMarker } from '../utils/match-events.ts';
import type { VideoItem, MatchRecord } from '@wonderful-ui/parser';

export function useEventMarkers(
  video: Ref<VideoItem | null>,
  match: Ref<MatchRecord | null>,
  canvasRef: Ref<HTMLCanvasElement | null>,
) {
  /** Raw per-event markers (pre-bucket). */
  const markers = ref<EventMarker[]>([]);
  const layouts = ref<EventMarkerLayout<BucketedEventMarker<EventMarker>>[]>([]);
  const useCanvas = ref(false);

  function recompute() {
    if (!video.value || !match.value) {
      markers.value = [];
      layouts.value = [];
      return;
    }
    markers.value = eventMarkersForVideo(video.value, match.value);
    useCanvas.value = markers.value.length > CANVAS_MARKER_THRESHOLD;
  }

  /** `durationMs` = media duration in ms; optional track width for density. */
  function renderLayouts(durationMs: number, trackWidthPx?: number) {
    if (markers.value.length === 0) {
      layouts.value = [];
      return;
    }
    const bucketed = bucketEventMarkers(markers.value, durationMs, { trackWidthPx });
    layouts.value = layoutEventMarkers(bucketed, durationMs, { trackWidthPx });
  }

  function drawCanvas() {
    const cvs = canvasRef.value;
    if (!cvs || !useCanvas.value) return;
    renderCanvasMarkers(cvs, layouts.value);
  }

  watch([video, match], recompute, { immediate: true });

  return { markers, layouts, useCanvas, recompute, renderLayouts, drawCanvas };
}
