import { ref, watch, type Ref } from 'vue';
import { layoutEventMarkers, renderCanvasMarkers, CANVAS_MARKER_THRESHOLD, type EventMarkerLayout } from '../utils/player-event-markers.ts';
import { eventMarkersForVideo, type EventMarker } from '../utils/match-events.ts';
import type { VideoItem, MatchRecord } from '@wonderful-ui/parser';

export function useEventMarkers(
  video: Ref<VideoItem | null>,
  match: Ref<MatchRecord | null>,
  canvasRef: Ref<HTMLCanvasElement | null>,
) {
  const markers = ref<EventMarker[]>([]);
  const layouts = ref<EventMarkerLayout[]>([]);
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

  function renderLayouts(width: number) {
    if (markers.value.length === 0) { layouts.value = []; return; }
    layouts.value = layoutEventMarkers(markers.value, width);
  }

  function drawCanvas() {
    const cvs = canvasRef.value;
    if (!cvs || !useCanvas.value) return;
    renderCanvasMarkers(cvs, layouts.value);
  }

  watch([video, match], recompute, { immediate: true });

  return { markers, layouts, useCanvas, recompute, renderLayouts, drawCanvas };
}
