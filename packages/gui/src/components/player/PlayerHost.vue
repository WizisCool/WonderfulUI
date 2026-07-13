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

      <div class="player-stage" @click.stop="onStageClick" @contextmenu.prevent="openContextMenu">
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
          @share="onShare"
          @fullscreen="toggleFullscreen"
        />
      </div>
    </div>

    <!--
      Teleport: in fullscreen the menu must live under fullscreenElement
      (sibling of .player-modal is outside the fullscreen tree and invisible).
      Otherwise mount on body so fixed coords match the viewport.
    -->
    <Teleport :to="ctxMenuTeleportTo">
      <div
        v-show="ctxMenu"
        class="player-context-menu"
        :class="{ 'is-closing': ctxMenuClosing }"
        :style="ctxMenuStyle"
        ref="ctxMenuRef"
        role="menu"
        aria-label="视频操作"
        @contextmenu.stop.prevent
        @animationend="onCtxMenuAnimEnd"
        @keydown="onCtxMenuKeydown"
      >
        <button
          v-for="item in ctxMenuItems"
          :key="item.id"
          type="button"
          role="menuitem"
          class="player-context-item"
          :disabled="item.disabled"
          @click="item.action()"
        >
          <WIcon :icon="item.icon" :size="14" />
          <span>{{ item.label }}</span>
        </button>
      </div>
    </Teleport>

    <ShareModal
      v-if="shareOpen"
      :video-path="videoPath"
      :video-name="videoPath.split(/[\\/]/).pop() || 'video.mp4'"
      @close="shareOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import WIcon from '../common/WIcon.vue';
import { usePlayerStore } from '../../stores/player.ts';
import { useUiStore } from '../../stores/ui.ts';
import { invoke, convertFileSrc } from '../../tauri-adapter.ts';
import { clampSeekMsForDuration } from '../../utils/event-time.ts';
import { placeMenuNearCursor } from '../../utils/context-menu.ts';
import { type PlayerState, type BufferingMode, BUFFERING_DEBOUNCE_MS, SEEK_WINDOW_MS, canPlayTransition, deriveUI } from '../../utils/player-state.ts';
import PlayerControls from './PlayerControls.vue';
import ShareModal from '../share/ShareModal.vue';
import { SHARE_ICON } from '../../share/icons.ts';
import type { VideoItem } from '@wonderful-ui/parser';

const player = usePlayerStore();
const ui = useUiStore();

const closing = ref(false);
const shareOpen = ref(false);
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

// ─── Context menu ──────────────────────────────────────────────────────────
// `ctxMenu` drives v-show; `ctxMenuClosing` plays exit animation before hide.
// Outside close: mousedown capture + button===0 (NOT click — right-click race).
// Listeners are bound once via bindCtxMenuListeners / unbindCtxMenuListeners.
const ctxMenu = ref(false);
const ctxMenuClosing = ref(false);
const ctxMenuX = ref(0);
const ctxMenuY = ref(0);
const ctxMenuRef = ref<HTMLElement | null>(null);
/** Teleport target: fullscreen element when active, else body. */
const ctxMenuTeleportTo = ref<string | HTMLElement>('body');
let ctxMenuCloseTimer: ReturnType<typeof setTimeout> | null = null;
let ctxMenuListenersBound = false;
/**
 * After an outside left-click dismisses the menu, the same gesture still
 * synthesizes a `click` on whatever is under the cursor (the stage toggles
 * play). OS menus and major players treat dismiss as non-activating —
 * swallow that one click (and any same-tick stage clicks while closing).
 */
let suppressStageClickUntil = 0;
let killClickThrough: ((e: MouseEvent) => void) | null = null;

const ctxMenuStyle = computed(() => ({
  left: `${ctxMenuX.value}px`,
  top: `${ctxMenuY.value}px`,
}));

interface CtxMenuItem {
  id: string;
  label: string;
  icon: string;
  disabled?: boolean;
  action: () => void;
}

const ctxMenuItems = computed((): CtxMenuItem[] => {
  const path = videoPath.value;
  const missing = !path;
  return [
    {
      id: 'system-player',
      label: '在系统播放器中打开',
      icon: 'ph:monitor-play',
      disabled: missing,
      action: () => {
        if (!path) return;
        invoke('play_video', { path })
          .then(() => closeCtxMenu())
          .catch((e) => {
            ui.showToast(`打开系统播放器失败: ${e}`, 'error');
            closeCtxMenu();
          });
      },
    },
    {
      id: 'explorer',
      label: '在资源管理器中打开',
      icon: 'ph:folder-open',
      disabled: missing,
      action: () => {
        if (!path) return;
        invoke('reveal_in_explorer', { path })
          .then(() => closeCtxMenu())
          .catch((e) => {
            ui.showToast(`打开资源管理器失败: ${e}`, 'error');
            closeCtxMenu();
          });
      },
    },
    {
      id: 'copy-path',
      label: '复制视频路径',
      icon: 'ph:copy',
      disabled: missing,
      action: () => {
        if (!path) return;
        void navigator.clipboard.writeText(path)
          .then(() => {
            ui.showToast('已复制路径');
            closeCtxMenu();
          })
          .catch(() => {
            ui.showToast('复制路径失败', 'error');
            closeCtxMenu();
          });
      },
    },
    {
      id: 'share',
      label: '快传',
      icon: SHARE_ICON,
      disabled: missing,
      action: () => {
        closeCtxMenu();
        onShare();
      },
    },
  ];
});

function syncCtxMenuTeleport() {
  const fs = document.fullscreenElement;
  ctxMenuTeleportTo.value = (fs as HTMLElement | null) ?? 'body';
}

function bindCtxMenuListeners() {
  if (ctxMenuListenersBound) return;
  document.addEventListener('mousedown', onCtxMenuDocMouseDown, true);
  document.addEventListener('keydown', onCtxMenuEsc, true);
  window.addEventListener('resize', onCtxMenuViewportChange);
  window.addEventListener('scroll', onCtxMenuViewportChange, true);
  document.addEventListener('fullscreenchange', onCtxMenuFullscreenChange);
  ctxMenuListenersBound = true;
}

function unbindCtxMenuListeners() {
  if (!ctxMenuListenersBound) return;
  document.removeEventListener('mousedown', onCtxMenuDocMouseDown, true);
  document.removeEventListener('keydown', onCtxMenuEsc, true);
  window.removeEventListener('resize', onCtxMenuViewportChange);
  window.removeEventListener('scroll', onCtxMenuViewportChange, true);
  document.removeEventListener('fullscreenchange', onCtxMenuFullscreenChange);
  ctxMenuListenersBound = false;
}

function applyCtxMenuPosition(clientX: number, clientY: number) {
  const el = ctxMenuRef.value;
  const menuW = el?.offsetWidth || 200;
  const menuH = el?.offsetHeight || 160;
  // Fullscreen may use a subset of the window; still use visual viewport size.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const placed = placeMenuNearCursor(
    { x: clientX, y: clientY },
    { width: menuW, height: menuH },
    { width: vw, height: vh },
  );
  ctxMenuX.value = placed.x;
  ctxMenuY.value = placed.y;
}

function openContextMenu(e: MouseEvent) {
  if (ctxMenuCloseTimer) {
    clearTimeout(ctxMenuCloseTimer);
    ctxMenuCloseTimer = null;
  }
  ctxMenuClosing.value = false;
  syncCtxMenuTeleport();
  // Seed position immediately; refine after layout with real menu size.
  ctxMenuX.value = e.clientX;
  ctxMenuY.value = e.clientY;
  ctxMenu.value = true;
  bindCtxMenuListeners();
  nextTick(() => {
    applyCtxMenuPosition(e.clientX, e.clientY);
    // Focus first enabled item for keyboard users (best-effort in tests/DOM).
    try {
      const first = ctxMenuRef.value?.querySelector<HTMLElement>(
        '[role="menuitem"]:not([disabled])',
      );
      first?.focus({ preventScroll: true });
    } catch {
      /* happy-dom / detached focus may throw — ignore */
    }
  });
}

function closeCtxMenu(opts: { swallowClickThrough?: boolean } = {}) {
  if (!ctxMenu.value && !ctxMenuClosing.value) return;
  if (!ctxMenu.value) return;
  if (opts.swallowClickThrough) armClickThroughGuard();
  ctxMenuClosing.value = true;
  if (ctxMenuCloseTimer) clearTimeout(ctxMenuCloseTimer);
  ctxMenuCloseTimer = setTimeout(() => {
    ctxMenu.value = false;
    ctxMenuClosing.value = false;
    ctxMenuCloseTimer = null;
  }, 200);
  unbindCtxMenuListeners();
}

/**
 * Industry pattern (native OS menus, Material/Radix dismiss, video players):
 * the pointer gesture that dismisses a floating menu must not activate the
 * control underneath. We (1) mark a short suppress window for stage click,
 * (2) capture the following `click` once and stop it.
 */
function armClickThroughGuard() {
  suppressStageClickUntil = performance.now() + 400;
  if (killClickThrough) {
    document.removeEventListener('click', killClickThrough, true);
    killClickThrough = null;
  }
  killClickThrough = (ev: MouseEvent) => {
    // Only the completing click of this dismiss gesture.
    if (ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();
    if (killClickThrough) {
      document.removeEventListener('click', killClickThrough, true);
      killClickThrough = null;
    }
  };
  document.addEventListener('click', killClickThrough, true);
  // Safety: never leave a permanent click sink if mouseup happens elsewhere.
  window.setTimeout(() => {
    if (killClickThrough) {
      document.removeEventListener('click', killClickThrough, true);
      killClickThrough = null;
    }
  }, 500);
}

function onStageClick() {
  // Menu open/closing, or the dismiss-click guard: never toggle play.
  if (ctxMenu.value || ctxMenuClosing.value) return;
  if (performance.now() < suppressStageClickUntil) return;
  togglePlay();
}

function onCtxMenuDocMouseDown(e: MouseEvent) {
  if (e.button !== 0) return;
  if (ctxMenuRef.value?.contains(e.target as Node)) return;
  // Dismiss only — do not let this gesture reach stage togglePlay.
  closeCtxMenu({ swallowClickThrough: true });
}

function onCtxMenuAnimEnd(e: AnimationEvent) {
  if (!ctxMenuClosing.value) return;
  if (e.animationName !== 'player-ctxmenu-out') return;
  if (ctxMenuCloseTimer) {
    clearTimeout(ctxMenuCloseTimer);
    ctxMenuCloseTimer = null;
  }
  ctxMenu.value = false;
  ctxMenuClosing.value = false;
}

function onCtxMenuEsc(e: KeyboardEvent) {
  if (e.key !== 'Escape') return;
  e.preventDefault();
  e.stopPropagation();
  closeCtxMenu();
}

function onCtxMenuViewportChange() {
  // Not a pointer dismiss — no click-through risk.
  if (ctxMenu.value) closeCtxMenu();
}

function onCtxMenuFullscreenChange() {
  syncCtxMenuTeleport();
  // Fullscreen tree change invalidates fixed placement — close rather than guess.
  if (ctxMenu.value) closeCtxMenu();
}

function onCtxMenuKeydown(e: KeyboardEvent) {
  const items = Array.from(
    ctxMenuRef.value?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [],
  );
  if (items.length === 0) return;
  const active = document.activeElement as HTMLElement | null;
  const idx = items.findIndex(el => el === active);
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    const next = items[(idx + 1 + items.length) % items.length]!;
    next.focus();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    const prev = items[(idx - 1 + items.length) % items.length]!;
    prev.focus();
  } else if (e.key === 'Home') {
    e.preventDefault();
    items[0]!.focus();
  } else if (e.key === 'End') {
    e.preventDefault();
    items[items.length - 1]!.focus();
  }
}

// Close menu when the open video changes (seek context / next clip).
watch(() => player.video?.video_id, () => {
  if (ctxMenu.value) closeCtxMenu();
});

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
  if (ctxMenu.value) {
    // Force-hide without waiting for exit anim — the whole player is leaving.
    unbindCtxMenuListeners();
    if (ctxMenuCloseTimer) {
      clearTimeout(ctxMenuCloseTimer);
      ctxMenuCloseTimer = null;
    }
    ctxMenu.value = false;
    ctxMenuClosing.value = false;
  }
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

function onShare() {
  const path = videoPath.value;
  if (!path) {
    ui.showToast('没有可分享的视频', 'error');
    return;
  }
  shareOpen.value = true;
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

// Keyboard
function onKeydown(e: KeyboardEvent) {
  // AGENTS.md: only handle keys while the player is actually open; otherwise
  // a stale listener can swallow events from the underlying app.
  if (!player.isOpen) return;
  // Context menu owns Escape / arrows while open (stopPropagation on its
  // capture listener). Still early-return here as a second guard.
  if (ctxMenu.value && !ctxMenuClosing.value) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeCtxMenu();
      return;
    }
    // Don't steal arrow keys / space while menu items are focused.
    if (e.target instanceof HTMLElement && e.target.closest('.player-context-menu')) {
      return;
    }
  }
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
  unbindCtxMenuListeners();
  if (killClickThrough) {
    document.removeEventListener('click', killClickThrough, true);
    killClickThrough = null;
  }
  if (ctxMenuCloseTimer) {
    clearTimeout(ctxMenuCloseTimer);
    ctxMenuCloseTimer = null;
  }
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
  transform-origin: top left;
  animation: player-ctxmenu-in 160ms cubic-bezier(0.16, 1, 0.3, 1) both;
}
.player-context-menu.is-closing {
  animation: player-ctxmenu-out 120ms cubic-bezier(0.7, 0, 0.84, 0) both;
  pointer-events: none;
}
@keyframes player-ctxmenu-in {
  from { opacity: 0; transform: scale(0.96); }
  to   { opacity: 1; transform: scale(1); }
}
@keyframes player-ctxmenu-out {
  from { opacity: 1; transform: scale(1); }
  to   { opacity: 0; transform: scale(0.97); }
}
.player-context-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 12px;
  text-align: left;
  font: inherit;
  font-size: 13px;
  font-family: var(--font-sans);
  color: var(--ink-2);
  background: transparent;
  border: 0;
  border-radius: 4px;
  cursor: pointer;
  transition: background 80ms ease-out, color 80ms ease-out;
}
.player-context-item:hover:not(:disabled),
.player-context-item:focus-visible:not(:disabled) {
  background: var(--surface-3);
  color: var(--ink);
  outline: none;
}
.player-context-item:disabled {
  opacity: 0.45;
  cursor: default;
}
</style>
