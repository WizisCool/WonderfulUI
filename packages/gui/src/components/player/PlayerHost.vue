<template>
  <div v-if="player.isOpen" class="player-backdrop" :class="{ 'is-closing': closing }" @click.self="doClose">
    <div
      class="player-modal"
      ref="modalRef"
      :class="{ 'is-closing': closing }"
      role="dialog"
      aria-modal="true"
      aria-labelledby="player-modal-title"
      @mousemove="onModalMouseMove"
      @keydown.tab.prevent="onTabKey"
    >
      <h1 id="player-modal-title" class="sr-only">视频播放器</h1>
      <button class="ctrl-btn player-close-top" aria-label="关闭" @click.stop="doClose">
        <WIcon icon="ph:x" :size="16" />
      </button>

      <div class="player-stage" @click.stop="togglePlay" @contextmenu.prevent="openContextMenu">
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
          @waiting="onWaiting"
          @seeking="onSeeking"
          @error="onError"
        />

        <div class="player-loading" :class="{ 'is-hidden': !showLoading }">
          <img v-if="posterSrc" class="player-loading-poster" :src="posterSrc" alt="" />
          <div v-else class="player-loading-poster" />
          <div v-if="!isDimOverlay" class="player-loading-darken" />
          <div v-if="showSpinner" class="player-spinner" />
        </div>

        <div class="player-error" :class="{ 'is-hidden': !showError }" role="alert">
          <div class="player-error-icon" aria-hidden="true"><WIcon icon="ph:warning" :size="48" /></div>
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
          <WIcon icon="ph:play" :size="28" />
        </button>

        <div class="player-frame-stepper" :class="{ 'is-visible': showFrameStepper }">
          <button class="frame-stepper-btn" aria-label="上一帧" @click.stop="stepFrame(-1)">
            <WIcon icon="ph:caret-left" :size="24" />
          </button>
          <button class="frame-stepper-btn" aria-label="下一帧" @click.stop="stepFrame(1)">
            <WIcon icon="ph:caret-right" :size="24" />
          </button>
        </div>

        <PlayerControls
          ref="controlsRef"
          :playing="controlsPlaying"
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
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import WIcon from '../common/WIcon.vue';
import { usePlayerStore } from '../../stores/player.ts';
import { useUiStore } from '../../stores/ui.ts';
import { invoke, convertFileSrc } from '../../tauri-adapter.ts';
import { clampSeekMsForDuration } from '../../utils/event-time.ts';
import { type PlayerState, type BufferingMode, BUFFERING_DEBOUNCE_MS, SEEK_WINDOW_MS, canPlayTransition, deriveUI } from '../../utils/player-state.ts';
import PlayerControls from './PlayerControls.vue';
import type { VideoItem } from '@wonderful-ui/parser';

const player = usePlayerStore();
const ui = useUiStore();

const closing = ref(false);
const videoRef = ref<HTMLVideoElement | null>(null);
const modalRef = ref<HTMLElement | null>(null);
const controlsRef = ref<InstanceType<typeof PlayerControls> | null>(null);
const progressWrapRef = ref<HTMLElement | null>(null);

// Focus management for the player dialog.
// restoreFocusEl remembers which element opened the player so we can return
// focus to it on close. The trap runs only on Tab inside the dialog.
let restoreFocusEl: HTMLElement | null = null;

function getModalFocusables(): HTMLElement[] {
  const modal = modalRef.value;
  if (!modal) return [];
  const sel = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"]), input:not([disabled]), [role="button"]:not([aria-disabled="true"])';
  return Array.from(modal.querySelectorAll<HTMLElement>(sel))
    .filter(el => !el.hasAttribute('inert') && el.offsetParent !== null);
}

function onTabKey(e: KeyboardEvent) {
  const focusables = getModalFocusables();
  if (focusables.length === 0) return;
  const first = focusables[0]!;
  const last = focusables[focusables.length - 1]!;
  const active = document.activeElement as HTMLElement | null;
  if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

const state = ref<PlayerState>('loading');
const bufferingMode = ref<BufferingMode>('hidden');
let stateBeforeSeek: PlayerState | null = null;
let lastSeekTime = 0;
let bufferingTimer: ReturnType<typeof setTimeout> | null = null;

const playerUi = computed(() => deriveUI(state.value));
const showLoading = computed(() => playerUi.value.showLoading);
const showSpinner = computed(() => playerUi.value.showSpinner || bufferingMode.value === 'spinner');
const isDimOverlay = computed(() => bufferingMode.value === 'dim-overlay');
const showReplay = computed(() => playerUi.value.showReplay);
const showFrameStepper = computed(() => playerUi.value.showFrameStepper);
const showError = computed(() => playerUi.value.showError);
const controlsPlaying = computed(() => playerUi.value.controlsPlaying);
const currentTime = ref(0);
const duration = ref(0);

watch(() => player.isOpen, (open) => {
  if (open) {
    // Remember what had focus so we can restore it on close.
    restoreFocusEl = (document.activeElement as HTMLElement | null) ?? null;
    state.value = 'loading';
    bufferingMode.value = 'hidden';
    stateBeforeSeek = null;
    lastSeekTime = 0;
    clearBufferingTimer();
    currentTime.value = 0;
    duration.value = 0;
    lastBufferedPct.value = 0;
    seeked = false;
    // Move focus into the dialog once Vue has rendered it.
    nextTick(() => {
      const focusables = getModalFocusables();
      const target = focusables[0] ?? modalRef.value;
      target?.focus();
    });
  } else if (restoreFocusEl && document.contains(restoreFocusEl)) {
    // Restore focus to the element that opened the player.
    restoreFocusEl.focus();
    restoreFocusEl = null;
  }
});
let seeked = false;
let fps = 60;

const volLevel = ref(100);
const isMuted = ref(false);
let preMuteVol = 100;

const isDragging = ref(false);
const lastBufferedPct = ref(0);

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
  transform: `scaleX(${lastBufferedPct.value / 100})`,
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
  const ctrl = controlsRef.value?.$el as HTMLElement | undefined;
  ctrl?.classList.remove('is-hidden');
  clearHideTimer();
}

function scheduleHide() {
  clearHideTimer();
  if (state.value !== 'playing' && state.value !== 'buffering') return;
  hideTimer = setTimeout(() => {
    const ctrl = controlsRef.value?.$el as HTMLElement | undefined;
    ctrl?.classList.add('is-hidden');
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
    clearBufferingTimer();
    player.close();
    closing.value = false;
  }, 200);
}

function replay() {
  const v = videoRef.value;
  if (!v) return;
  v.currentTime = 0;
  v.play().catch(() => {});
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
  const v = videoRef.value;
  if (!v) return;
  // Push the persisted volume / mute onto the freshly-loaded <video>.
  // onMounted's applyVolumeToVideo runs before the <video> element exists
  // (it is rendered by the same v-if that mounts PlayerHost), so without
  // this re-apply the player would open at the HTML default (volume 1,
  // unmuted) every time, even after the user has saved a different level.
  applyVolumeToVideo();
  currentTime.value = 0;
  duration.value = v.duration || 0;
  if (player.seekMs !== undefined && !seeked) {
    const clampedMs = clampSeekMsForDuration(player.seekMs, v.duration);
    v.currentTime = clampedMs / 1000;
    seeked = true;
  }
}

function onCanPlay() {
  const transition = canPlayTransition(state.value, stateBeforeSeek);
  if (transition.clearPendingBuffering) {
    clearBufferingTimer();
    bufferingMode.value = 'hidden';
  }
  state.value = transition.nextState;
  if (transition.shouldPlay) {
    videoRef.value?.play().catch(() => {});
  }
}

function onPlay() {
  clearBufferingTimer();
  state.value = 'playing';
  bufferingMode.value = 'hidden';
  scheduleHide();
  if (!fpsMeasured) { fpsMeasured = true; const v = videoRef.value; if (v) measureFps(v); }
}

function onPause() {
  if (state.value === 'buffering') return;
  clearBufferingTimer();
  bufferingMode.value = 'hidden';
  state.value = 'paused';
  showControls();
}

function onWaiting() {
  if (state.value !== 'playing') return;
  stateBeforeSeek = state.value;
  clearBufferingTimer();
  bufferingTimer = setTimeout(() => {
    state.value = 'buffering';
    bufferingMode.value = (Date.now() - lastSeekTime < SEEK_WINDOW_MS) ? 'dim-overlay' : 'spinner';
  }, BUFFERING_DEBOUNCE_MS);
}

function onSeeking() {
  if (state.value === 'loading') return;
  stateBeforeSeek = state.value;
  lastSeekTime = Date.now();
}

function onEnded() {
  clearBufferingTimer();
  bufferingMode.value = 'hidden';
  state.value = 'ended';
  showControls();
}

function onError() {
  clearBufferingTimer();
  bufferingMode.value = 'hidden';
  state.value = 'error';
  showControls();
}

function clearBufferingTimer() {
  if (bufferingTimer) { clearTimeout(bufferingTimer); bufferingTimer = null; }
}

function onTimeUpdate() {
  if (isDragging.value) return;
  const v = videoRef.value;
  if (!v) return;
  const dur = v.duration || 0;
  const cur = v.currentTime || 0;
  currentTime.value = cur;
  duration.value = dur;

  const buf = v.buffered;
  if (buf.length > 0) {
    const next = dur > 0 ? (buf.end(buf.length - 1) / dur) * 100 : 0;
    if (Math.abs(next - lastBufferedPct.value) > 0.5) {
      lastBufferedPct.value = Math.round(next);
    }
  }
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
  // AGENTS.md: only handle keys while the player is actually open; otherwise
  // a stale listener can swallow events from the underlying app.
  if (!player.isOpen) return;
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  // The progress slider handles its own arrow / page / home / end keys
  // (WAI-ARIA slider pattern). Skip those here to avoid double-seek.
  const target = e.target as HTMLElement | null;
  if (target?.closest('.player-progress-wrap')) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'PageUp' || e.key === 'PageDown' || e.key === 'Home' || e.key === 'End') return;
  }
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
  if (state.value !== 'playing' && state.value !== 'buffering') { showControls(); return; }
  showControls();
  scheduleHide();
}

onMounted(() => {
  loadVolume();
  nextTick(() => {
    applyVolumeToVideo();
  });
  document.addEventListener('keydown', onKeydown, true);
});

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown, true);
  document.removeEventListener('click', onCtxMenuDocClick);
  document.removeEventListener('keydown', onCtxMenuEsc);
  clearHideTimer();
  clearBufferingTimer();
});
</script>

<style scoped>
.player-backdrop {
  position: fixed; inset: 0;
  z-index: 1200;
  display: flex; align-items: center; justify-content: center;
  background: oklch(0 0 0 / 0.7);
  animation: player-backdrop-in 240ms ease-out both;
}
.player-backdrop.is-closing {
  animation: player-backdrop-out 160ms ease-in both;
}
.player-modal {
  position: relative;
  display: flex; flex-direction: column;
  max-width: 80vw; max-height: 80vh;
  aspect-ratio: 16 / 9;
  width: min(80vw, calc(80vh * 16 / 9));
  background: var(--surface-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  overflow: hidden;
  animation: player-modal-in 260ms ease-out both;
}
.player-modal.is-closing {
  animation: player-modal-out 140ms ease-in both;
}
.player-modal:fullscreen {
  width: 100vw;
  max-width: 100vw;
  max-height: 100vh;
  aspect-ratio: auto;
  border: none;
  border-radius: 0;
  background: #000;
  animation: fullscreen-in 280ms ease-out;
}

.player-modal:fullscreen :deep(.ctrl-btn) {
  width: 40px;
  height: 40px;
}
.player-modal:fullscreen :deep(.player-progress-wrap) {
  padding: 14px 0;
}
.player-modal:fullscreen :deep(.player-progress-track) {
  height: 5px;
}
.player-modal:fullscreen :deep(.player-time) {
  font-size: 14px;
  min-width: 100px;
}
.player-modal:fullscreen :deep(.player-vol-track) {
  width: 76px;
  height: 5px;
}
.player-modal:fullscreen :deep(.player-controls) {
  padding: 28px 16px 14px;
}
.player-modal:fullscreen .player-close-top {
  top: 12px;
  right: 12px;
  width: 40px;
  height: 40px;
}
@keyframes fullscreen-in {
  from { opacity: 0.6; }
  to   { opacity: 1; }
}
@keyframes player-backdrop-in  { from { opacity: 0; } to { opacity: 1; } }
@keyframes player-backdrop-out { from { opacity: 1; } to { opacity: 0; } }
@keyframes player-modal-in {
  from { opacity: 0; transform: scale(0.96); }
  to   { opacity: 1; transform: scale(1); }
}
@keyframes player-modal-out {
  from { opacity: 1; transform: scale(1); }
  to   { opacity: 0; transform: scale(0.96); }
}

.player-stage {
  flex: 1;
  position: relative;
  min-height: 0;
  background: #000;
}
.player-video {
  width: 100%; height: 100%;
  object-fit: fill;
  display: block;
  border-radius: 0;
  background-color: #000;
}

.player-loading {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
}
.player-loading.is-hidden { opacity: 0; pointer-events: none; }
.player-loading-poster {
  position: absolute; inset: 0;
  width: 100%; height: 100%;
  object-fit: cover;
  filter: brightness(0.4);
}
.player-loading-darken {
  position: absolute; inset: 0;
  background: oklch(0 0 0 / 0.3);
}
.player-spinner {
  position: relative;
  width: 32px; height: 32px;
  border: 3px solid var(--surface-3);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: player-spin 0.8s linear infinite;
}
@keyframes player-spin { to { transform: rotate(360deg); } }

.player-error {
  position: absolute; inset: 0;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 12px;
  padding: 24px;
  text-align: center;
  background: var(--surface-2);
}
.player-error.is-hidden { display: none; }
.player-error-icon { font-size: 48px; color: var(--warn); line-height: 1; }
.player-error-title { font-size: 15px; font-weight: var(--w-semibold); color: var(--ink); }
.player-error-path {
  max-width: 100%;
  overflow: hidden;
}
.player-error-path code {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--ink-2);
  word-break: break-all;
  line-height: 1.6;
}
.player-error-actions {
  display: flex; gap: 8px; margin-top: 4px;
}
.player-error-actions .btn {
  padding: 5px 14px;
  background: var(--surface-3);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  color: var(--ink-2);
  font-size: 13px;
  cursor: pointer;
  transition: background 80ms ease-out;
}
.player-error-actions .btn:hover {
  background: var(--surface-2);
  color: var(--ink);
}

.player-replay-btn {
  position: absolute;
  inset: 0;
  display: flex; align-items: center; justify-content: center;
  background: oklch(0 0 0 / 0.35);
  border: 0;
  cursor: pointer;
  color: var(--ink);
  opacity: 0;
  pointer-events: none;
  transition: opacity 250ms ease-out, background 200ms ease-out;
}
.player-replay-btn.is-visible {
  opacity: 1;
  pointer-events: auto;
}
.player-replay-btn:hover { background: oklch(0 0 0 / 0.45); }
.player-replay-btn svg {
  width: 56px; height: 56px;
  color: var(--accent);
  filter: drop-shadow(0 2px 8px oklch(0 0 0 / 0.5));
}

.player-frame-stepper {
  position: absolute;
  inset: 0;
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 12px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 200ms ease-out;
}
.player-frame-stepper.is-visible {
  opacity: 1;
  pointer-events: auto;
}
.frame-stepper-btn {
  display: flex; align-items: center; justify-content: center;
  width: 44px; height: 44px;
  border-radius: 50%;
  border: 0;
  cursor: pointer;
  background: oklch(0 0 0 / 0.4);
  color: var(--ink-2);
  transition: background 150ms ease-out, color 150ms ease-out;
}
.frame-stepper-btn:hover {
  background: oklch(0 0 0 / 0.6);
  color: var(--ink);
}

.player-close-top {
  position: absolute;
  top: 8px; right: 8px;
  z-index: 10;
  background: oklch(0 0 0 / 0.45);
}
.player-close-top:hover {
  background: oklch(0 0 0 / 0.65);
  color: var(--ink);
}

.player-context-menu {
  position: fixed;
  z-index: 2000;
  background: var(--surface-2);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  padding: 4px;
  min-width: 180px;
}
.player-context-item {
  display: block;
  width: 100%;
  padding: 6px 12px;
  text-align: left;
  font: inherit;
  font-size: 13px;
  color: var(--ink-2);
  background: transparent;
  border: 0;
  border-radius: 4px;
  cursor: pointer;
  transition: background 80ms ease-out;
}
.player-context-item:hover {
  background: var(--surface-3);
  color: var(--ink);
}
</style>
