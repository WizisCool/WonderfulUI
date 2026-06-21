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
        @mousedown.stop
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
          <WIcon v-if="layout.marker.type === 'death'" icon="ph:skull" :size="11" />
          <WIcon v-else icon="ph:crosshair" :size="11" />
        </div>
      </div>
      <div class="player-progress-fill" :style="fillStyle" />
      <div class="player-progress-thumb" :style="thumbStyle" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick, type Ref } from 'vue';
import WIcon from '../common/WIcon.vue';
import { useEventMarkers } from '../../composables/useEventMarkers.ts';
import type { VideoItem, MatchRecord } from '@wonderful-ui/parser';
import type { EventMarkerLayout } from '../../utils/player-event-markers.ts';
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

<style scoped>
.player-progress-wrap {
  flex: 1;
  padding: 12px 0;
  cursor: pointer;
  position: relative;
}
.player-progress-track {
  position: relative;
  height: 4px;
  background: var(--surface);
  border-radius: 2px;
  overflow: visible;
}

.player-progress-buffered {
  position: absolute; top: 0; left: 0;
  height: 100%;
  width: 100%;
  background: var(--ink-4);
  border-radius: 2px;
  transform-origin: left center;
  transform: scaleX(0);
}
.player-progress-fill {
  position: absolute; top: 0; left: 0;
  height: 100%;
  width: 100%;
  background: var(--accent);
  border-radius: 2px;
  transform-origin: left center;
  transform: scaleX(0);
  transition: transform 180ms cubic-bezier(0.2, 0, 0, 1);
}
.player-progress-thumb {
  position: absolute;
  top: 50%;
  left: 0;
  width: 8px; height: 8px;
  background: var(--accent);
  border-radius: 50%;
  display: none;
  transform: translate(-50%, -50%);
  transition: transform 180ms cubic-bezier(0.2, 0, 0, 1);
}
.player-progress-wrap:hover .player-progress-thumb,
.player-progress-wrap.is-dragging .player-progress-thumb,
.player-progress-wrap.is-marker-seek .player-progress-thumb {
  display: block;
}
.player-progress-wrap.is-dragging .player-progress-fill,
.player-progress-wrap.is-dragging .player-progress-thumb {
  transition: none;
}

.player-event-markers {
  position: absolute; inset: 0;
  pointer-events: none;
}
.player-event-marker {
  --event-marker-color: var(--ink-2);
  --event-marker-bg: oklch(0.055 0.006 30 / 0.42);
  --event-marker-bg-hover: oklch(0.055 0.006 30 / 0.86);
  --event-marker-border: oklch(0.42 0.012 30 / 0.7);
  --event-marker-top: -28px;
  --event-marker-stem: 9px;
  --event-marker-dot-size: 16px;
  --event-marker-dot-radius: 8px;
  --event-marker-dot-overlap: 1px;
  position: absolute;
  top: var(--event-marker-top);
  transform: translateX(-50%);
  width: 20px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
  cursor: pointer;
  color: var(--event-marker-color);
  opacity: 0.92;
  transition: opacity 100ms ease, transform 120ms ease, width 120ms ease;
}
.player-event-marker::before {
  content: "";
  position: absolute;
  left: 50%;
  top: calc(50% + var(--event-marker-dot-radius) - var(--event-marker-dot-overlap));
  width: 1px;
  height: var(--event-marker-stem);
  transform: translateX(-50%);
  background: color-mix(in oklch, var(--event-marker-color), transparent 44%);
  border-radius: 999px;
}
.player-event-marker::after {
  content: "";
  position: absolute;
  left: 50%;
  top: 50%;
  width: var(--event-marker-dot-size);
  height: var(--event-marker-dot-size);
  transform: translate(-50%, -50%);
  border-radius: 999px;
  background: var(--event-marker-bg);
  border: 1px solid var(--event-marker-border);
  box-sizing: border-box;
}
.player-event-marker.lane-upper {
  --event-marker-top: -32px;
  transform: translateX(-50%);
}
.player-event-marker.lane-lower {
  --event-marker-top: -26px;
  transform: translateX(-50%);
}
.player-event-marker svg {
  position: relative;
  z-index: 1;
  width: 10px;
  height: 10px;
  stroke-width: 2.8;
  filter: drop-shadow(0 1px 1px oklch(0 0 0 / 0.6));
  opacity: 0.96;
  transform: scale(1);
  transition: opacity 100ms ease, transform 120ms ease;
}
.player-event-marker.is-compact {
  --event-marker-dot-size: 7px;
  --event-marker-dot-radius: 3.5px;
  width: 14px;
  height: 22px;
  opacity: 0.86;
}
.player-event-marker.is-compact::before {
  width: 1.5px;
  background: color-mix(in oklch, var(--event-marker-color), transparent 38%);
}
.player-event-marker.is-compact::after {
  background: color-mix(in oklch, var(--event-marker-color), transparent 8%);
  border: 1px solid color-mix(in oklch, var(--event-marker-color), transparent 28%);
}
.player-event-marker.is-compact svg {
  opacity: 0;
  transform: scale(0.72);
}
.player-event-marker.is-compact.headshot::after {
  outline: 1px solid color-mix(in oklch, var(--event-marker-color), transparent 32%);
  outline-offset: 1px;
}
.player-event-marker:hover,
.player-event-marker:focus-visible {
  opacity: 1;
  outline: none;
}
.player-event-marker.lane-upper:hover,
.player-event-marker.lane-upper:focus-visible {
  width: 22px;
  transform: translateX(-50%) translateY(-2px) scale(1.05);
}
.player-event-marker.lane-lower:hover,
.player-event-marker.lane-lower:focus-visible {
  width: 22px;
  transform: translateX(-50%) translateY(-2px) scale(1.05);
}
.player-event-marker:hover::after,
.player-event-marker:focus-visible::after {
  background: var(--event-marker-bg-hover);
}
.player-event-marker.is-compact:hover::after,
.player-event-marker.is-compact:focus-visible::after {
  width: 16px;
  height: 16px;
  background: var(--event-marker-bg-hover);
  border: 1px solid var(--event-marker-border);
}
.player-event-marker:hover svg,
.player-event-marker:focus-visible svg {
  opacity: 1;
  transform: scale(1.08);
}
.player-event-marker:focus-visible::after {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.player-event-marker.tone-attack,
.player-event-marker.tone-headshot {
  --event-marker-color: var(--marker-kill);
  --event-marker-border: color-mix(in oklch, var(--marker-kill), transparent 28%);
  --event-marker-bg: var(--marker-kill-bg);
  --event-marker-bg-hover: var(--marker-kill-hover);
}
.player-event-marker.tone-death {
  --event-marker-color: var(--marker-death);
  --event-marker-border: color-mix(in oklch, var(--marker-death), transparent 28%);
  --event-marker-bg: var(--marker-death-bg);
  --event-marker-bg-hover: var(--marker-death-hover);
}
.player-event-marker.headshot::after {
  outline: 1px solid var(--event-marker-color);
  outline-offset: 1px;
}
.player-event-marker[data-placement="bottom"]::before {
  top: auto;
  bottom: calc(50% + var(--event-marker-dot-radius) - var(--event-marker-dot-overlap));
}
.player-event-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.player-event-markers.is-canvas {
  pointer-events: auto;
}
.player-event-markers.is-canvas .player-event-canvas {
  pointer-events: none;
}
</style>
