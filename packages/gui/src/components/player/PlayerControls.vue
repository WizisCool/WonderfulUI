<template>
  <div class="player-controls" ref="controlsEl" @mouseenter="show" @mouseleave="scheduleHide" @click.stop>
    <div class="player-ctrl-row">
      <button
        class="ctrl-btn player-ctrl-play"
        :aria-label="playing ? '暂停' : ended ? '重播' : '播放'"
        :title="playing ? '暂停' : ended ? '重播' : '播放'"
        @click.stop="$emit('playPause')"
      >
        <WIcon v-if="playing" icon="ph:pause" :size="16" />
        <WIcon v-else-if="ended" icon="ph:arrow-counter-clockwise" :size="16" />
        <WIcon v-else icon="ph:play" :size="16" />
      </button>

      <ProgressBar
        ref="progressRef"
        :current-time="currentTime"
        :duration="duration"
        :current-time-str="currentTimeStr"
        :duration-str="durationStr"
        :buffered-style="bufferedStyle"
        :video="video"
        :match="match"
        @seek="(pct) => $emit('seek', pct)"
        @seek-start="$emit('seekStart')"
        @seek-end="$emit('seekEnd')"
        @marker-click="onMarkerClick"
      />

      <span class="player-time">{{ currentTimeStr }} / {{ durationStr }}</span>

      <div class="player-vol-wrap">
        <button
          class="ctrl-btn player-ctrl-vol"
          :aria-label="volumeMuted || volumeLevel === 0 ? '取消静音' : '静音'"
          @click.stop="$emit('volumeMuteToggle')"
          @wheel.prevent="onVolWheel"
        >
          <WIcon v-if="volumeMuted || volumeLevel === 0" icon="ph:speaker-x" :size="16" />
          <WIcon v-else-if="volumeLevel < 50" icon="ph:speaker-low" :size="16" />
          <WIcon v-else icon="ph:speaker-high" :size="16" />
        </button>
        <div
          class="player-vol-track"
          ref="volTrackRef"
          role="slider"
          tabindex="0"
          aria-label="音量"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-valuenow="displayedVolume"
          :aria-valuetext="`${displayedVolume}%`"
          @mousedown.prevent="onVolMouseDown"
          @keydown="onVolKeydown"
        >
          <div class="player-vol-fill" :style="{ width: `${displayedVolume}%` }" />
        </div>
      </div>

      <button class="ctrl-btn player-ctrl-explorer" title="在资源管理器中打开" @click.stop="$emit('explorer')">
        <WIcon icon="ph:folder-open" :size="16" />
      </button>
      <button class="ctrl-btn player-ctrl-share" title="快传（扫码下载）" aria-label="快传" @click.stop="$emit('share')">
        <WIcon :icon="SHARE_ICON" :size="SHARE_ICON_SIZE" />
      </button>
      <button class="ctrl-btn player-ctrl-fullscreen" :title="isFullscreen ? '退出全屏' : '全屏'" @click.stop="$emit('fullscreen')">
        <WIcon v-if="isFullscreen" icon="ph:arrows-in" :size="16" />
        <WIcon v-else icon="ph:arrows-out" :size="16" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';
import WIcon from '../common/WIcon.vue';
import ProgressBar from './ProgressBar.vue';
import { SHARE_ICON, SHARE_ICON_SIZE } from '../../share/icons.ts';
import { EVENT_PREROLL_MS } from '../../utils/event-time.ts';
import type { VideoItem, MatchRecord } from '@wonderful-ui/parser';

const props = defineProps<{
  playing: boolean;
  /** true when playback has ended — show replay glyph instead of play */
  ended?: boolean;
  currentTimeStr: string;
  durationStr: string;
  currentTime: number;
  duration: number;
  volumeLevel: number;
  volumeMuted: boolean;
  video: VideoItem | null;
  match: MatchRecord | null;
  bufferedStyle: Record<string, string>;
}>();

const emit = defineEmits<{
  playPause: [];
  seek: [pct: number];
  seekStart: [];
  seekEnd: [];
  volumeChange: [level: number];
  volumeMuteToggle: [];
  explorer: [];
  share: [];
  fullscreen: [];
}>();

const controlsEl = ref<HTMLElement | null>(null);
const volTrackRef = ref<HTMLElement | null>(null);
const progressRef = ref<InstanceType<typeof ProgressBar> | null>(null);
const isFullscreen = ref(false);
const displayedVolume = computed(() => {
  const level = props.volumeMuted ? 0 : props.volumeLevel;
  return Number.isFinite(level) ? Math.max(0, Math.min(100, level)) : 0;
});

function onMarkerClick(timeMs: number) {
  if (props.duration <= 0) return;
  const seekMs = Math.max(0, timeMs - EVENT_PREROLL_MS);
  const targetSec = Math.min(seekMs / 1000, props.duration - 0.05);
  emit('seek', targetSec / props.duration);
}

function onVolWheel(e: WheelEvent) {
  const cur = displayedVolume.value;
  const next = Math.max(0, Math.min(100, cur - Math.sign(e.deltaY) * 5));
  emit('volumeChange', next);
}

function onVolKeydown(e: KeyboardEvent) {
  let next: number;
  switch (e.key) {
    case 'ArrowUp':
    case 'ArrowRight':
      next = Math.min(100, displayedVolume.value + 5);
      break;
    case 'ArrowDown':
    case 'ArrowLeft':
      next = Math.max(0, displayedVolume.value - 5);
      break;
    case 'Home':
      next = 0;
      break;
    case 'End':
      next = 100;
      break;
    default:
      return;
  }
  e.preventDefault();
  e.stopPropagation();
  emit('volumeChange', next);
}

function onVolMouseDown(e: MouseEvent) {
  if (e.button !== 0) return;
  cleanupVolumeDrag();
  setVolFromClient(e.clientX);
  document.addEventListener('mousemove', onVolMouseMove);
  document.addEventListener('mouseup', cleanupVolumeDrag);
  window.addEventListener('blur', cleanupVolumeDrag);
}

function onVolMouseMove(e: MouseEvent) {
  setVolFromClient(e.clientX);
}

function cleanupVolumeDrag() {
  document.removeEventListener('mousemove', onVolMouseMove);
  document.removeEventListener('mouseup', cleanupVolumeDrag);
  window.removeEventListener('blur', cleanupVolumeDrag);
}

function setVolFromClient(clientX: number) {
  const track = volTrackRef.value;
  if (!track) return;
  const rect = track.getBoundingClientRect();
  if (!Number.isFinite(clientX) || !Number.isFinite(rect.width) || rect.width <= 0) return;
  const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  emit('volumeChange', Math.round(pct * 100));
}

// Auto-hide
let hideTimer: ReturnType<typeof setTimeout> | null = null;
function show() {
  if (hideTimer) clearTimeout(hideTimer);
  if (controlsEl.value) controlsEl.value.classList.remove('is-hidden');
}
function scheduleHide() {
  if (hideTimer) clearTimeout(hideTimer);
  if (!props.playing) return;
  hideTimer = setTimeout(() => {
    if (controlsEl.value) controlsEl.value.classList.add('is-hidden');
  }, 3000);
}

function onFullscreenChange() {
  isFullscreen.value = !!document.fullscreenElement;
}

onMounted(() => {
  document.addEventListener('fullscreenchange', onFullscreenChange);
});
onUnmounted(() => {
  document.removeEventListener('fullscreenchange', onFullscreenChange);
  cleanupVolumeDrag();
  if (hideTimer) clearTimeout(hideTimer);
});
</script>

<style scoped>
.player-controls {
  position: absolute;
  left: 0; right: 0; bottom: 0;
  z-index: 5;
  padding: 24px 14px 12px;
  background: linear-gradient(to top, oklch(0.08 0.01 30 / 0.85) 0%, transparent);
  transition: opacity 200ms ease-out;
}
.player-controls.is-hidden {
  opacity: 0;
  pointer-events: none;
}

.player-ctrl-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.player-time {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--ink-2);
  white-space: nowrap;
  flex-shrink: 0;
  min-width: 80px;
  text-align: center;
}

.player-vol-wrap {
  display: flex; align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.player-vol-track {
  width: 60px; height: 4px;
  background: var(--surface);
  border-radius: 2px;
  cursor: pointer;
}
.player-vol-fill {
  height: 100%;
  background: var(--ink-2);
  border-radius: 2px;
}
</style>
