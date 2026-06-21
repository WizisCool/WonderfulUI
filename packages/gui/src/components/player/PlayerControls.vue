<template>
  <div class="player-controls" ref="controlsEl" @mouseenter="show" @mouseleave="scheduleHide">
    <div class="player-ctrl-row">
      <button class="ctrl-btn player-ctrl-play" :aria-label="playing ? '暂停' : '播放'" @click.stop="$emit('playPause')">
        <Pause v-if="playing" :size="16" />
        <Play v-else :size="16" />
      </button>

      <ProgressBar
        ref="progressRef"
        :current-time="currentTime"
        :duration="duration"
        :buffered-style="bufferedStyle"
        :video="video"
        :match="match"
        @seek="(pct) => $emit('seek', pct)"
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
          <VolumeX v-if="volumeMuted || volumeLevel === 0" :size="16" />
          <Volume1 v-else-if="volumeLevel < 50" :size="16" />
          <Volume2 v-else :size="16" />
        </button>
        <div class="player-vol-track" ref="volTrackRef" @mousedown.prevent="onVolMouseDown">
          <div class="player-vol-fill" :style="{ width: `${volumeMuted ? 0 : volumeLevel}%` }" />
        </div>
      </div>

      <button class="ctrl-btn player-ctrl-explorer" title="在资源管理器中打开" @click.stop="$emit('explorer')">
        <FolderOpen :size="16" />
      </button>
      <button class="ctrl-btn player-ctrl-share" disabled title="即将推出">
        <Share2 :size="16" />
      </button>
      <button class="ctrl-btn player-ctrl-fullscreen" :title="isFullscreen ? '退出全屏' : '全屏'" @click.stop="$emit('fullscreen')">
        <Minimize2 v-if="isFullscreen" :size="16" />
        <Maximize2 v-else :size="16" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import {
  Play, Pause, Volume1, Volume2, VolumeX,
  FolderOpen, Share2, Maximize2, Minimize2,
} from 'lucide-vue-next';
import ProgressBar from './ProgressBar.vue';
import { EVENT_PREROLL_MS } from '../../utils/event-time.ts';
import type { VideoItem, MatchRecord } from '@wonderful-ui/parser';

const props = defineProps<{
  playing: boolean;
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
  fullscreen: [];
}>();

const controlsEl = ref<HTMLElement | null>(null);
const volTrackRef = ref<HTMLElement | null>(null);
const progressRef = ref<InstanceType<typeof ProgressBar> | null>(null);
const isFullscreen = ref(false);

function onMarkerClick(timeMs: number) {
  if (props.duration <= 0) return;
  const seekMs = Math.max(0, timeMs - EVENT_PREROLL_MS);
  const targetSec = Math.min(seekMs / 1000, props.duration - 0.05);
  emit('seek', targetSec / props.duration);
}

function onVolWheel(e: WheelEvent) {
  const cur = props.volumeMuted ? 0 : props.volumeLevel;
  const next = Math.max(0, Math.min(100, cur - Math.sign(e.deltaY) * 5));
  emit('volumeChange', next);
}

function onVolMouseDown(e: MouseEvent) {
  if (e.button !== 0) return;
  setVolFromClient(e.clientX);

  const onMove = (ev: MouseEvent) => setVolFromClient(ev.clientX);
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function setVolFromClient(clientX: number) {
  const track = volTrackRef.value;
  if (!track) return;
  const rect = track.getBoundingClientRect();
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

.ctrl-btn {
  width: 32px; height: 32px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  border-radius: var(--radius);
  color: var(--ink-2);
  background: transparent;
  border: 0;
  cursor: pointer;
  transition: background 100ms ease-out, color 100ms ease-out;
}
.ctrl-btn:hover {
  background: var(--surface-2);
  color: var(--ink);
}
.ctrl-btn[disabled] {
  opacity: 0.35;
  cursor: not-allowed;
}
.ctrl-btn[disabled]:hover {
  background: transparent;
  color: var(--ink-2);
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
