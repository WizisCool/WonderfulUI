<template>
  <div v-if="player.isOpen" class="player-backdrop" :class="{ 'is-closing': closing }">
    <div class="player-modal" ref="modalRef" :class="{ 'is-closing': closing }">
      <button class="ctrl-btn player-close-top" aria-label="关闭" @click.stop="doClose">
        <X :size="16" />
      </button>

      <div class="player-stage" ref="stageRef" @click.stop="togglePlay" @contextmenu.prevent="openContextMenu">
        <video
          ref="videoRef"
          class="player-video"
          preload="auto"
          :src="src"
          @loadedmetadata="onLoadedMeta"
          @canplay="onCanPlay"
          @play="onPlay"
          @pause="onPause"
          @ended="onEnded"
          @timeupdate="onTimeUpdate"
          @error="onError"
        />

        <div class="player-loading" :class="{ 'is-hidden': !showLoading }">
          <img v-if="posterSrc" class="player-loading-poster" :src="posterSrc" alt="" />
          <div v-else class="player-loading-poster" />
          <div class="player-loading-darken" />
          <div class="player-spinner" />
        </div>

        <div class="player-error" :class="{ 'is-hidden': !showError }">
          <div class="player-error-icon">⚠</div>
          <div class="player-error-title">该高光视频源不可用</div>
          <div class="player-error-path"><code>{{ videoPath }}</code></div>
          <div class="player-error-actions">
            <button class="btn ghost" @click.stop="doClose">关闭</button>
            <button class="btn ghost" @click.stop="revealInExplorer">在资源管理器中打开</button>
          </div>
        </div>

        <button
          class="player-replay-btn"
          :class="{ 'is-visible': showReplay }"
          aria-label="重播"
          @click.stop="replay"
        >
          <Play :size="28" />
        </button>

        <div class="player-frame-stepper" :class="{ 'is-visible': showFrameStepper }">
          <button class="frame-stepper-btn" aria-label="上一帧" @click.stop="stepFrame(-1)">
            <ChevronLeft :size="24" />
          </button>
          <button class="frame-stepper-btn" aria-label="下一帧" @click.stop="stepFrame(1)">
            <ChevronRight :size="24" />
          </button>
        </div>

        <PlayerControls
          ref="controlsRef"
          :playing="isPlaying"
          :current-time-str="currentTimeStr"
          :duration-str="durationStr"
          :current-time="currentTime"
          :duration="duration"
          :volume-level="volLevel"
          :volume-muted="isMuted"
          :video="player.video"
          :match="player.matchContext"
          :progress-fill-style="progressFillStyle"
          :progress-thumb-style="progressThumbStyle"
          :buffered-style="bufferedStyle"
          :progress-wrap-ref="progressWrapRef"
          @play-pause="togglePlay"
          @seek="onControlsSeek"
          @seek-start="onSeekStart"
          @seek-end="onSeekEnd"
          @volume-change="setVolume"
          @volume-mute-toggle="toggleMute"
          @explorer="revealInExplorer"
          @fullscreen="toggleFullscreen"
        />
      </div>
    </div>

    <div v-if="ctxMenu" class="player-context-menu" :style="ctxMenuStyle" ref="ctxMenuRef">
      <button
        v-for="item in ctxMenuItems"
        :key="item.label"
        class="player-context-item"
        @click="item.action()"
      >{{ item.label }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick, type Ref } from 'vue';
import { X, Play, ChevronLeft, ChevronRight } from 'lucide-vue-next';
import { usePlayerStore } from '../../stores/player.ts';
import { useUiStore } from '../../stores/ui.ts';
import { invoke, convertFileSrc } from '../../tauri-adapter.ts';
import { clampSeekMsForDuration } from '../../event-time.ts';
import PlayerControls from './PlayerControls.vue';
import type { VideoItem } from '@wonderful-ui/parser';

const player = usePlayerStore();
const ui = useUiStore();

const closing = ref(false);
const videoRef = ref<HTMLVideoElement | null>(null);
const modalRef = ref<HTMLElement | null>(null);
const controlsRef = ref<InstanceType<typeof PlayerControls> | null>(null);
const progressWrapRef = ref<HTMLElement | null>(null);

const isPlaying = ref(false);
const currentTime = ref(0);
const duration = ref(0);
const showLoading = ref(true);
const showError = ref(false);
const showReplay = ref(false);
const showFrameStepper = ref(false);
let seeked = false;
let fps = 60;

const volLevel = ref(100);
const isMuted = ref(false);
let preMuteVol = 100;

const isDragging = ref(false);
let lastBufferedPct = 0;

let hideTimer: ReturnType<typeof setTimeout> | null = null;

const LS_VOL = 'wui:player.vol';
const LS_MUTED = 'wui:player.muted';

const src = computed(() => {
  if (!player.video) return '';
  return convertFileSrc(player.video.video_src);
});

const posterSrc = computed(() => {
  if (!player.video?.video_poster) return null;
  return convertFileSrc(player.video.video_poster);
});

const videoPath = computed(() => player.video?.video_src ?? '');

const currentTimeStr = computed(() => fmtTime(currentTime.value));
const durationStr = computed(() => fmtTime(duration.value));

const progressFillPct = computed(() =>
  duration.value > 0 ? (currentTime.value / duration.value) * 100 : 0
);

const progressFillStyle = computed(() => ({
  transform: `scaleX(${progressFillPct.value / 100})`,
}));

const progressThumbStyle = computed(() => ({
  transform: `translate(calc(${progressFillPct.value}% - 50%), -50%)`,
}));

const bufferedStyle = computed(() => ({
  transform: `scaleX(${lastBufferedPct / 100})`,
}));

// context menu
const ctxMenu = ref(false);
const ctxMenuX = ref(0);
const ctxMenuY = ref(0);
const ctxMenuRef = ref<HTMLElement | null>(null);

const ctxMenuStyle = computed(() => ({
  left: `${ctxMenuX.value}px`,
  top: `${ctxMenuY.value}px`,
}));

const ctxMenuItems = computed(() => [
  {
    label: '在系统播放器中打开',
    action: () => { invoke('play_video', { path: videoPath.value }).catch(() => {}); closeCtxMenu(); },
  },
  {
    label: '在资源管理器中打开',
    action: () => { invoke('reveal_in_explorer', { path: videoPath.value }).catch(() => {}); closeCtxMenu(); },
  },
  {
    label: '复制视频路径',
    action: () => { navigator.clipboard.writeText(videoPath.value); ui.showToast('已复制路径'); closeCtxMenu(); },
  },
]);

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function loadVolume() {
  try {
    const v = localStorage.getItem(LS_VOL);
    const m = localStorage.getItem(LS_MUTED);
    volLevel.value = Math.max(0, Math.min(100, Number(v) || 100));
    isMuted.value = m === '1';
    preMuteVol = volLevel.value;
  } catch {
    volLevel.value = 100;
    isMuted.value = false;
    preMuteVol = 100;
  }
}

function saveVolume() {
  try { localStorage.setItem(LS_VOL, String(volLevel.value)); } catch {}
  try { localStorage.setItem(LS_MUTED, isMuted.value ? '1' : '0'); } catch {}
}

function applyVolumeToVideo() {
  const v = videoRef.value;
  if (!v) return;
  if (isMuted.value || volLevel.value === 0) {
    v.volume = 0;
    v.muted = true;
  } else {
    v.muted = false;
    v.volume = volLevel.value / 100;
  }
}

function setVolume(level: number) {
  volLevel.value = level;
  isMuted.value = false;
  preMuteVol = level;
  applyVolumeToVideo();
  saveVolume();
}

function toggleMute() {
  if (isMuted.value || volLevel.value === 0) {
    isMuted.value = false;
    volLevel.value = preMuteVol || 100;
    applyVolumeToVideo();
    saveVolume();
  } else {
    preMuteVol = volLevel.value;
    isMuted.value = true;
    volLevel.value = 0;
    applyVolumeToVideo();
    saveVolume();
  }
}

function showControls() {
  const ctrl = document.querySelector('.player-controls');
  if (ctrl) ctrl.classList.remove('is-hidden');
  clearHideTimer();
}

function scheduleHide() {
  clearHideTimer();
  if (!isPlaying.value) return;
  hideTimer = setTimeout(() => {
    const ctrl = document.querySelector('.player-controls');
    if (ctrl) ctrl.classList.add('is-hidden');
  }, 3000);
}

function clearHideTimer() {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
}

function togglePlay() {
  const v = videoRef.value;
  if (!v) return;
  if (v.paused) { v.play().catch(() => {}); } else { v.pause(); }
}

function doClose() {
  closing.value = true;
  setTimeout(() => {
    clearHideTimer();
    player.close();
    closing.value = false;
  }, 200);
}

function replay() {
  const v = videoRef.value;
  if (!v) return;
  v.currentTime = 0;
  v.play().catch(() => {});
  showReplay.value = false;
}

function stepFrame(delta: number) {
  const v = videoRef.value;
  if (!v || !v.paused) return;
  const t = v.currentTime + delta / fps;
  v.currentTime = Math.max(0, Math.min(v.duration, t));
}

function onControlsSeek(pct: number) {
  const v = videoRef.value;
  if (!v || !v.duration) return;
  const t = pct * v.duration;
  v.currentTime = t;
}

function onSeekStart() {
  isDragging.value = true;
}

function onSeekEnd() {
  isDragging.value = false;
}

function measureFps(v: HTMLVideoElement) {
  let lastMediaTime = -1;
  const cb = (_now: number, metadata: VideoFrameCallbackMetadata) => {
    if (lastMediaTime >= 0 && metadata.mediaTime > lastMediaTime) {
      const interval = metadata.mediaTime - lastMediaTime;
      if (interval > 0.001) {
        fps = Math.round(1 / interval);
        return;
      }
    }
    lastMediaTime = metadata.mediaTime;
    v.requestVideoFrameCallback(cb);
  };
  v.requestVideoFrameCallback(cb);
}

let fpsMeasured = false;

function onLoadedMeta() {
  const v = videoRef.value!;
  currentTime.value = 0;
  duration.value = v.duration || 0;
  if (player.seekMs !== undefined && !seeked) {
    const clampedMs = clampSeekMsForDuration(player.seekMs, v.duration);
    v.currentTime = clampedMs / 1000;
    seeked = true;
  }
}

function onCanPlay() {
  showLoading.value = false;
}

function onPlay() {
  isPlaying.value = true;
  scheduleHide();
  showFrameStepper.value = false;
  if (!fpsMeasured) { fpsMeasured = true; measureFps(videoRef.value!); }
}

function onPause() {
  isPlaying.value = false;
  showControls();
  showFrameStepper.value = true;
}

function onEnded() {
  isPlaying.value = false;
  showControls();
  showReplay.value = true;
  showFrameStepper.value = false;
}

function onTimeUpdate() {
  if (isDragging.value) return;
  const v = videoRef.value!;
  const dur = v.duration || 0;
  const cur = v.currentTime || 0;
  currentTime.value = cur;
  duration.value = dur;

  const buf = v.buffered;
  if (buf.length > 0) {
    lastBufferedPct = dur > 0 ? (buf.end(buf.length - 1) / dur) * 100 : 0;
  }
}

function onError() {
  showLoading.value = false;
  showError.value = true;
  showControls();
}

function revealInExplorer() {
  invoke('reveal_in_explorer', { path: videoPath.value }).catch((e) => {
    ui.showToast(`打开资源管理器失败: ${e}`, 'error');
  });
}

function toggleFullscreen() {
  const modal = modalRef.value;
  if (!modal) return;
  if (!document.fullscreenElement) {
    modal.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
}

function openContextMenu(e: MouseEvent) {
  ctxMenu.value = true;
  ctxMenuX.value = e.clientX;
  ctxMenuY.value = e.clientY;
  nextTick(() => {
    document.addEventListener('click', onCtxMenuDocClick);
    document.addEventListener('keydown', onCtxMenuEsc);
  });
}

function closeCtxMenu() {
  ctxMenu.value = false;
  document.removeEventListener('click', onCtxMenuDocClick);
  document.removeEventListener('keydown', onCtxMenuEsc);
}

function onCtxMenuDocClick(e: MouseEvent) {
  if (!ctxMenuRef.value?.contains(e.target as Node)) closeCtxMenu();
}

function onCtxMenuEsc(e: KeyboardEvent) {
  if (e.key === 'Escape') closeCtxMenu();
}

// Keyboard
function onKeydown(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  const v = videoRef.value;
  if (!v) return;

  switch (e.key) {
    case ' ':
      e.preventDefault();
      togglePlay();
      break;
    case 'k':
      e.preventDefault();
      stepFrame(1);
      break;
    case 'j':
      e.preventDefault();
      stepFrame(e.shiftKey ? -5 : -1);
      break;
    case 'l':
      e.preventDefault();
      if (e.shiftKey) stepFrame(5);
      else { v.play().catch(() => {}); }
      break;
    case 'ArrowLeft':
      e.preventDefault();
      v.currentTime = Math.max(0, v.currentTime - 5);
      break;
    case 'ArrowRight':
      e.preventDefault();
      v.currentTime = Math.min(v.duration || 0, v.currentTime + 5);
      break;
    case 'ArrowUp':
      e.preventDefault();
      setVolume(Math.min(100, volLevel.value + 10));
      break;
    case 'ArrowDown':
      e.preventDefault();
      setVolume(Math.max(0, volLevel.value - 10));
      break;
    case 'm':
      e.preventDefault();
      toggleMute();
      break;
    case 'F':
    case 'f':
      e.preventDefault();
      toggleFullscreen();
      break;
    case 'Escape':
      e.preventDefault();
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        doClose();
      }
      break;
  }
}

// Mouse auto-hide
function onModalMouseMove() {
  if (!isPlaying.value) { showControls(); return; }
  showControls();
  scheduleHide();
}

onMounted(() => {
  loadVolume();
  nextTick(() => {
    applyVolumeToVideo();
    const v = videoRef.value;
    if (v) {
      v.play().catch(() => {});
    }
  });
  document.addEventListener('keydown', onKeydown, true);

  // close on backdrop click
  const backdrop = document.querySelector('.player-backdrop');
  if (backdrop) {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) doClose();
    });
  }
});

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown, true);
  clearHideTimer();
});
</script>

<style scoped></style>
