<template>
  <div
    ref="wrapRef"
    class="player-progress-wrap"
    :class="{ 'is-dragging': isDragging }"
    @mousedown.prevent="onMouseDown"
  >
    <div class="player-progress-track" ref="trackRef">
      <div class="player-progress-buffered" :style="bufferedStyle" />
      <div
        v-if="markers.length > 0"
        class="player-event-markers"
        :class="{ 'is-canvas': useCanvas }"
        :data-raw-markers="rawMarkersJson"
        :data-canvas-layouts="canvasLayoutsJson"
        ref="markersEl"
        @click.stop="onMarkerDomClick"
        @keydown.enter.prevent.stop="onMarkerDomKeydown"
        @keydown.space.prevent.stop="onMarkerDomKeydown"
      >
        <canvas v-if="useCanvas" ref="canvasRef" class="player-event-canvas" />
        <div
          v-for="layout in domLayouts"
          :key="layout.timeMs"
          class="player-event-marker"
          :class="markerClasses(layout)"
          :data-time-ms="String(layout.timeMs)"
          :data-tip="markerTip(layout)"
          :data-placement="layout.placement"
          role="button"
          tabindex="0"
          :aria-label="markerTip(layout)"
          :style="markerStyle(layout)"
        >
          <Skull v-if="layout.marker.type === 'death'" :size="11" />
          <Crosshair v-else :size="11" />
        </div>
      </div>
      <div class="player-progress-fill" :style="fillStyle" />
      <div class="player-progress-thumb" :style="thumbStyle" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick, type Ref } from 'vue';
import { Skull, Crosshair } from 'lucide-vue-next';
import { useEventMarkers } from '../../composables/useEventMarkers.ts';
import type { VideoItem, MatchRecord } from '@wonderful-ui/parser';
import type { EventMarkerLayout } from '../../player-event-markers.ts';
import type { EventMarker } from '../../utils/match-events.ts';

const props = defineProps<{
  currentTime: number;
  duration: number;
  bufferedStyle: Record<string, string>;
  video: VideoItem | null;
  match: MatchRecord | null;
}>();

const emit = defineEmits<{
  seek: [pct: number];
  markerClick: [timeMs: number];
}>();

const wrapRef = ref<HTMLElement | null>(null);
const trackRef = ref<HTMLElement | null>(null);
const markersEl = ref<HTMLElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);
const isDragging = ref(false);

const videoRef = computed(() => props.video);
const matchRef = computed(() => props.match);

const { markers, layouts, useCanvas, recompute, renderLayouts, drawCanvas } = useEventMarkers(
  videoRef as Ref<VideoItem | null>,
  matchRef as Ref<MatchRecord | null>,
  canvasRef,
);

const rawMarkersJson = computed(() => JSON.stringify(markers.value));
const canvasLayoutsJson = computed(() => JSON.stringify(layouts.value));
const domLayouts = computed(() => useCanvas.value ? [] : layouts.value);

const fillPct = computed(() =>
  props.duration > 0 ? (props.currentTime / props.duration) * 100 : 0
);
const fillStyle = computed(() => ({ transform: `scaleX(${fillPct.value / 100})` }));
const thumbStyle = computed(() => ({
  transform: `translate(calc(${fillPct.value}% - 50%), -50%)`,
}));

watch(() => props.duration, () => {
  if (props.duration > 0) renderLayouts(props.duration * 1000);
  nextTick(() => drawCanvas());
});

watch(layouts, () => nextTick(() => drawCanvas()));
watch(() => props.video, () => {
  recompute();
  if (props.duration > 0) renderLayouts(props.duration * 1000);
  nextTick(() => drawCanvas());
});

function clientToPct(clientX: number): number {
  const track = trackRef.value;
  if (!track) return 0;
  const rect = track.getBoundingClientRect();
  return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
}

function onMouseDown(e: MouseEvent) {
  if (e.button !== 0) return;
  if ((e.target as HTMLElement).closest('.player-event-marker')) return;
  isDragging.value = true;
  emit('seek', clientToPct(e.clientX));

  const onMove = (ev: MouseEvent) => {
    if (!isDragging.value) return;
    emit('seek', clientToPct(ev.clientX));
  };
  const onUp = () => {
    if (!isDragging.value) return;
    isDragging.value = false;
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function markerClasses(layout: EventMarkerLayout<EventMarker>): Record<string, boolean> {
  const toneLabel = layout.marker.type === 'death' ? 'death'
    : layout.isHeadshot ? 'headshot' : 'attack';
  return {
    [`lane-${layout.lane}`]: true,
    [`tone-${toneLabel}`]: true,
    'is-compact': layout.displayMode === 'compact',
    headshot: layout.isHeadshot,
  };
}

function markerStyle(layout: EventMarkerLayout<EventMarker>): Record<string, string> {
  return {
    left: `${layout.leftPct}%`,
    '--event-marker-top': `${layout.topPx}px`,
    '--event-marker-stem': `${layout.stemPx}px`,
  };
}

function markerTip(layout: EventMarkerLayout<EventMarker>): string {
  const m = layout.marker;
  const isKill = m.type === 'kill';
  const timeFmt = fmtMs(m.timeMs);
  return `${isKill ? '击杀' : '阵亡'}${m.playerName ? ` ${m.playerName}` : ''}${m.isHeadshot ? ' · 爆头' : ''} · ${timeFmt}`;
}

function fmtMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function onMarkerDomClick(e: MouseEvent) {
  const dot = (e.target as HTMLElement).closest('.player-event-marker') as HTMLElement | null;
  if (dot) {
    emit('markerClick', Number(dot.dataset.timeMs ?? '0'));
    return;
  }
  // Check canvas marker click
  if (useCanvas.value && canvasRef.value) {
    const canvas = canvasRef.value;
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const hit = layouts.value.find(l =>
      Math.abs((l.leftPct / 100) * rect.width - clickX) < 14
    );
    if (hit) emit('markerClick', hit.timeMs);
  }
}

function onMarkerDomKeydown(e: KeyboardEvent) {
  const dot = (e.target as HTMLElement).closest('.player-event-marker') as HTMLElement | null;
  if (dot) emit('markerClick', Number(dot.dataset.timeMs ?? '0'));
}

onMounted(() => {
  recompute();
  nextTick(() => {
    if (props.duration > 0) renderLayouts(props.duration * 1000);
    drawCanvas();
  });
});

defineExpose({
  markersEl,
  canvasRef,
  rawMarkersJson,
  canvasLayoutsJson,
  layouts,
  useCanvas,
});
</script>

<style scoped></style>
