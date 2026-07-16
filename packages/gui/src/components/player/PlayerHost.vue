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
          <WIcon icon="ph:arrow-counter-clockwise" :size="48" />
        </button>

        <!-- Pause-only top-left frame dock: default collapsed; expands in-place. -->
        <div
          v-show="showFrameStepper"
          class="player-frame-panel"
          :class="{ 'is-open': framePanelOpen }"
          role="toolbar"
          aria-label="逐帧"
          @click.stop
          @pointerup="stopFrameHold"
          @pointercancel="stopFrameHold"
          @pointerleave="stopFrameHold"
        >
          <button
            class="ctrl-btn player-frame-panel-toggle"
            type="button"
            :aria-expanded="framePanelOpen"
            :aria-label="framePanelOpen ? '收起逐帧' : '展开逐帧'"
            :data-tip="framePanelOpen ? '收起' : '展开逐帧'"
            @click.stop="toggleFramePanel"
          >
            <WIcon icon="ph:film-strip" :size="14" />
            <span class="player-frame-panel-label">逐帧</span>
          </button>
          <div class="player-frame-panel-tools" :aria-hidden="framePanelOpen ? 'false' : 'true'">
            <div class="player-frame-panel-tools-inner">
              <span class="player-frame-panel-sep" aria-hidden="true" />
              <button
                class="ctrl-btn player-frame-step"
                type="button"
                tabindex="-1"
                aria-label="上一帧"
                data-tip="上一帧 · 按住连跳 · J"
                @pointerdown.stop.prevent="onFrameStepPointerDown(-1, $event)"
              >
                <span class="player-frame-step-label">−1</span>
              </button>
              <button
                class="ctrl-btn player-frame-step"
                type="button"
                tabindex="-1"
                aria-label="下一帧"
                data-tip="下一帧 · 按住连跳 · K"
                @pointerdown.stop.prevent="onFrameStepPointerDown(1, $event)"
              >
                <span class="player-frame-step-label">+1</span>
              </button>
            </div>
          </div>
        </div>

        <PlayerControls
          ref="controlsRef"
          :playing="controlsPlaying"
          :ended="showReplay"
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

      <!-- Screenshot busy: dim stage + indeterminate progress (native capture lag). -->
      <div
        class="player-screenshot-overlay"
        :class="{ 'is-visible': screenshotUi !== null }"
        role="status"
        aria-live="polite"
        :aria-busy="screenshotUi !== null"
        :aria-hidden="screenshotUi === null"
        @click.stop
        @contextmenu.stop.prevent
      >
        <div class="player-screenshot-card">
          <div class="player-screenshot-label">{{ screenshotUiLabel }}</div>
          <div class="player-screenshot-progress" aria-hidden="true">
            <div class="player-screenshot-progress-shimmer" />
          </div>
        </div>
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
        <template v-for="(entry, idx) in ctxMenuEntries" :key="entry.kind === 'separator' ? `sep-${idx}` : entry.id">
          <div
            v-if="entry.kind === 'separator'"
            class="player-context-sep"
            role="separator"
          />
          <button
            v-else-if="entry.kind === 'item'"
            type="button"
            role="menuitem"
            class="player-context-item"
            :disabled="entry.disabled"
            @mouseenter="closeSubmenu()"
            @click="entry.action()"
          >
            <WIcon :icon="entry.icon" :size="14" />
            <span>{{ entry.label }}</span>
          </button>
          <div
            v-else
            class="player-context-sub"
            :class="{ 'is-open': openSubmenuId === entry.id, 'is-flip': submenuFlipLeft }"
            @mouseenter="openSubmenu(entry.id)"
            @mouseleave="onSubmenuLeave"
            @focusin="openSubmenu(entry.id)"
          >
            <button
              type="button"
              role="menuitem"
              class="player-context-item player-context-item-parent"
              :disabled="entry.disabled"
              :aria-haspopup="true"
              :aria-expanded="openSubmenuId === entry.id"
              @click.stop="toggleSubmenu(entry.id)"
              @keydown.right.prevent="openSubmenu(entry.id)"
            >
              <WIcon :icon="entry.icon" :size="14" />
              <span class="player-context-item-label">{{ entry.label }}</span>
              <WIcon icon="ph:caret-right" :size="12" class="player-context-chevron" />
            </button>
            <div
              v-show="openSubmenuId === entry.id"
              class="player-context-flyout"
              role="menu"
              :aria-label="entry.label"
              @keydown.left.prevent="closeSubmenu()"
            >
              <button
                v-for="child in entry.children"
                :key="child.id"
                type="button"
                role="menuitem"
                class="player-context-item"
                :disabled="child.disabled || entry.disabled"
                @click="child.action()"
              >
                <WIcon :icon="child.icon" :size="14" />
                <span>{{ child.label }}</span>
              </button>
            </div>
          </div>
        </template>
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
import {
  base64PngToBlob,
  blobToUint8Array,
  defaultScreenshotName,
  formatCaptureError,
} from '../../utils/capture-video-frame.ts';
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
/** Expanded tools on the top-left frame dock. Default collapsed. */
const framePanelOpen = ref(false);

const FRAME_HOLD_DELAY_MS = 320;
/**
 * Max continuous step rate. Real pace is min(this, decoder seeked rate) —
 * flooding currentTime without waiting for seeked is what causes stutter.
 */
const FRAME_HOLD_MAX_HZ = 15;

let frameHoldDelay: ReturnType<typeof setTimeout> | null = null;
/** Monotonic generation — stale seeked / timeouts must no-op after stop. */
let frameHoldGen = 0;
/** True while pointer-driven hold-repeat owns frame stepping. */
let frameHoldActive = false;
/** In-flight seeked listener for the hold pipeline (removed on stop). */
let frameHoldOnSeeked: (() => void) | null = null;
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
    framePanelOpen.value = false;
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
  // Built-in asset protocol streams with Range; do not use wui-media here —
  // full-file buffering in a custom scheme freezes the UI on open.
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
  left: `${progressFillPct.value}%`,
  transform: 'translate(-50%, -50%)',
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

interface CtxMenuAction {
  id: string;
  label: string;
  icon: string;
  disabled?: boolean;
  action: () => void | Promise<void>;
}

type CtxMenuEntry =
  | { kind: 'separator' }
  | ({ kind: 'item' } & CtxMenuAction)
  | {
      kind: 'submenu';
      id: string;
      label: string;
      icon: string;
      disabled?: boolean;
      children: CtxMenuAction[];
    };

const openSubmenuId = ref<string | null>(null);
const submenuFlipLeft = ref(false);
/** videoWidth/Height are not Vue-reactive — keep a ref updated on media events. */
const frameReady = ref(false);
/** Blocks re-entry while native capture / write runs. */
let screenshotBusy = false;
/**
 * While true, force-hold paused at the save frame: ignore canplay→play,
 * onPlay, togglePlay, and Space (seek/dialog can re-fire play on WebView2).
 */
let screenshotPlaybackHold = false;
/** Interval that re-asserts pause while hold is active (belt-and-suspenders). */
let screenshotPauseWatchdog: ReturnType<typeof setInterval> | null = null;
/** Visual busy state on the player shell (null = idle). */
const screenshotUi = ref<'copy' | 'save' | null>(null);
const screenshotUiLabel = computed(() =>
  screenshotUi.value === 'save' ? '正在保存截图…' : '正在复制截图…',
);

function captureTimeMs(): number {
  const v = videoRef.value;
  return Math.max(
    0,
    Math.floor((v && Number.isFinite(v.currentTime) ? v.currentTime : 0) * 1000),
  );
}

/** Yield so Vue can paint the dim overlay before the native call blocks. */
async function paintScreenshotUi() {
  await nextTick();
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
}

function waitVideoSeeked(v: HTMLVideoElement, timeoutMs = 2500): Promise<void> {
  if (v.seeking === false) {
    // May already be settled; still wait one frame if we just assigned currentTime.
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      v.removeEventListener('seeked', onSeeked);
      resolve();
    };
    const onSeeked = () => finish();
    const timer = window.setTimeout(finish, timeoutMs);
    v.addEventListener('seeked', onSeeked, { once: true });
  });
}

function refreshFrameReady() {
  const v = videoRef.value;
  frameReady.value = !!(v && v.videoWidth > 0 && v.videoHeight > 0);
}

const ctxMenuEntries = computed((): CtxMenuEntry[] => {
  const path = videoPath.value;
  const missing = !path;
  // Prefer live check so open-menu path is never stuck on a stale false.
  const v = videoRef.value;
  const noFrame = !(frameReady.value || (v && v.videoWidth > 0 && v.videoHeight > 0));
  return [
    {
      kind: 'item',
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
    { kind: 'separator' },
    {
      kind: 'item',
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
      kind: 'item',
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
    { kind: 'separator' },
    {
      kind: 'submenu',
      id: 'screenshot',
      label: '截图',
      icon: 'ph:camera',
      disabled: noFrame,
      children: [
        {
          id: 'shot-copy',
          label: '复制到剪贴板',
          icon: 'ph:copy',
          disabled: noFrame,
          action: () => void copyScreenshot(),
        },
        {
          id: 'shot-save',
          label: '保存为 PNG…',
          icon: 'ph:download-simple',
          disabled: noFrame,
          action: () => void saveScreenshot(),
        },
      ],
    },
    { kind: 'separator' },
    {
      kind: 'item',
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

function openSubmenu(id: string) {
  refreshFrameReady();
  openSubmenuId.value = id;
  nextTick(() => updateSubmenuFlip());
}

function closeSubmenu() {
  openSubmenuId.value = null;
  submenuFlipLeft.value = false;
}

function toggleSubmenu(id: string) {
  if (openSubmenuId.value === id) closeSubmenu();
  else openSubmenu(id);
}

/** Close flyout when pointer leaves parent row + flyout as a unit. */
function onSubmenuLeave(e: MouseEvent) {
  const host = e.currentTarget as HTMLElement | null;
  const related = e.relatedTarget as Node | null;
  if (host && related && host.contains(related)) return;
  closeSubmenu();
}

function updateSubmenuFlip() {
  const root = ctxMenuRef.value;
  if (!root || !openSubmenuId.value) return;
  const fly = root.querySelector('.player-context-flyout') as HTMLElement | null;
  if (!fly) return;
  const parent = fly.closest('.player-context-sub') as HTMLElement | null;
  if (!parent) return;
  const pr = parent.getBoundingClientRect();
  const fw = fly.offsetWidth || 160;
  submenuFlipLeft.value = pr.right + 2 + fw > window.innerWidth - 8;
}

async function captureFrameAt(timeMs: number): Promise<Blob> {
  const path = videoPath.value?.trim();
  if (!path) throw new Error('视频路径不可用');
  // Windows-only OS decoder path — no canvas / blob fallback.
  const b64 = await invoke<string>('capture_video_frame', { path, timeMs });
  if (!b64?.length) throw new Error('截图结果为空');
  return base64PngToBlob(b64);
}

async function copyScreenshot() {
  if (screenshotBusy) return;
  screenshotBusy = true;
  const timeMs = captureTimeMs();
  closeCtxMenu();
  screenshotUi.value = 'copy';
  try {
    await paintScreenshotUi();
    const blob = await captureFrameAt(timeMs);
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
      throw new Error('当前环境不支持复制图片');
    }
    // Some Chromium builds require a Promise value for image ClipboardItem.
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': Promise.resolve(blob) }),
    ]);
    ui.showToast('已复制截图');
  } catch (e) {
    ui.showToast(formatCaptureError(e, 'copy'), 'error');
  } finally {
    screenshotUi.value = null;
    screenshotBusy = false;
  }
}

function forceVideoPaused() {
  const v = videoRef.value;
  if (!v) return;
  try {
    if (!v.paused) v.pause();
  } catch {
    /* ignore */
  }
  if (state.value !== 'ended' && state.value !== 'error') {
    state.value = 'paused';
  }
  clearBufferingTimer();
  bufferingMode.value = 'hidden';
}

function startScreenshotPauseWatchdog() {
  stopScreenshotPauseWatchdog();
  screenshotPauseWatchdog = setInterval(() => {
    if (!screenshotPlaybackHold) return;
    forceVideoPaused();
  }, 32);
}

function stopScreenshotPauseWatchdog() {
  if (screenshotPauseWatchdog) {
    clearInterval(screenshotPauseWatchdog);
    screenshotPauseWatchdog = null;
  }
}

/**
 * Hard-hold the player on the capture frame for the whole save flow
 * (dialog + progress). Returns whether playback should resume after success.
 */
async function holdPlaybackOnSaveFrame(timeSec: number): Promise<boolean> {
  const v = videoRef.value;
  if (!v) return false;

  const wasPlaying =
    state.value === 'playing'
    || state.value === 'buffering'
    || (!v.paused && state.value !== 'ended');

  screenshotPlaybackHold = true;
  stateBeforeSeek = null;
  stopFrameHold();
  forceVideoPaused();
  startScreenshotPauseWatchdog();

  const target = Math.max(0, Number.isFinite(timeSec) ? timeSec : 0);
  const needSeek = Math.abs((v.currentTime || 0) - target) > 0.01;
  if (needSeek) {
    try {
      const seekWait = waitVideoSeeked(v);
      v.currentTime = target;
      await seekWait;
    } catch {
      /* best-effort seek */
    }
  }

  forceVideoPaused();
  currentTime.value = v.currentTime || target;
  // One more rAF so the frozen frame is painted before Save As / overlay.
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  forceVideoPaused();
  showControls();
  return wasPlaying;
}

function releaseScreenshotPlaybackHold(resume: boolean) {
  stopScreenshotPauseWatchdog();
  screenshotPlaybackHold = false;
  if (!resume) return;
  const v = videoRef.value;
  if (!v || state.value === 'ended' || state.value === 'error') return;
  v.play().catch(() => {});
}

async function saveScreenshot() {
  if (screenshotBusy) return;
  screenshotBusy = true;
  // Freeze playhead at menu action — hold for dialog + progress.
  const timeMs = captureTimeMs();
  const timeSec = timeMs / 1000;
  closeCtxMenu({ swallowClickThrough: true });
  let resumeAfter = false;
  let held = false;
  try {
    // Pause on the target frame immediately (before Save As), so the shell
    // is frozen for the whole save interaction.
    resumeAfter = await holdPlaybackOnSaveFrame(timeSec);
    held = true;

    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    const name = defaultScreenshotName(videoPath.value, timeSec);
    // System picker while held paused; then dim + capture.
    const outPath = await save({
      defaultPath: name,
      filters: [{ name: 'PNG', extensions: ['png'] }],
    });
    if (!outPath) {
      // Cancelled: restore prior play state.
      releaseScreenshotPlaybackHold(resumeAfter);
      held = false;
      return;
    }

    // Re-assert freeze after native dialog returns (focus/canplay races).
    forceVideoPaused();
    const v = videoRef.value;
    if (v && Math.abs((v.currentTime || 0) - timeSec) > 0.05) {
      try {
        const seekWait = waitVideoSeeked(v);
        v.currentTime = timeSec;
        await seekWait;
      } catch {
        /* ignore */
      }
      forceVideoPaused();
    }

    screenshotUi.value = 'save';
    await paintScreenshotUi();
    forceVideoPaused();
    const blob = await captureFrameAt(timeMs);
    const bytes = await blobToUint8Array(blob);
    await writeFile(outPath, bytes);
    ui.showToast('已保存');
    releaseScreenshotPlaybackHold(resumeAfter);
    held = false;
  } catch (e) {
    ui.showToast(formatCaptureError(e, 'save'), 'error');
    // On failure leave paused at the freeze frame (user can press play).
    releaseScreenshotPlaybackHold(false);
    held = false;
  } finally {
    screenshotUi.value = null;
    screenshotBusy = false;
    if (held) {
      // Safety if an early return path forgot to release.
      stopScreenshotPauseWatchdog();
      screenshotPlaybackHold = false;
    } else {
      stopScreenshotPauseWatchdog();
      screenshotPlaybackHold = false;
    }
  }
}

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
  closeSubmenu();
  refreshFrameReady();
  syncCtxMenuTeleport();
  // Seed position immediately; refine after layout with real menu size.
  ctxMenuX.value = e.clientX;
  ctxMenuY.value = e.clientY;
  ctxMenu.value = true;
  bindCtxMenuListeners();
  nextTick(() => {
    // Re-check after paint — metadata may have settled while menu was closed.
    refreshFrameReady();
    applyCtxMenuPosition(e.clientX, e.clientY);
    // Focus first enabled item for keyboard users (best-effort in tests/DOM).
    try {
      const first = ctxMenuRef.value?.querySelector<HTMLElement>(
        ':scope > .player-context-item:not([disabled]), :scope > .player-context-sub > .player-context-item:not([disabled])',
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
  closeSubmenu();
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
  // Submenu first, then root (native menu pattern).
  if (openSubmenuId.value) {
    closeSubmenu();
    return;
  }
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
  const root = ctxMenuRef.value;
  if (!root) return;
  const inFlyout = !!(document.activeElement instanceof HTMLElement
    && document.activeElement.closest('.player-context-flyout'));
  const scope = inFlyout
    ? root.querySelector('.player-context-flyout')
    : root;
  if (!scope) return;
  // Root: only direct row items (not flyout children). Flyout: its menuitems.
  const items = inFlyout
    ? Array.from(scope.querySelectorAll<HTMLElement>(':scope > [role="menuitem"]:not([disabled])'))
    : Array.from(root.querySelectorAll<HTMLElement>(
      ':scope > .player-context-item:not([disabled]), :scope > .player-context-sub > .player-context-item:not([disabled])',
    ));
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
  } else if (e.key === 'ArrowRight' && !inFlyout) {
    const parent = active?.closest('.player-context-sub');
    if (parent && !active?.hasAttribute('disabled')) {
      e.preventDefault();
      const id = openSubmenuId.value ?? 'screenshot';
      openSubmenu(id);
      nextTick(() => {
        const first = root.querySelector<HTMLElement>(
          '.player-context-flyout > [role="menuitem"]:not([disabled])',
        );
        first?.focus({ preventScroll: true });
      });
    }
  } else if (e.key === 'ArrowLeft' && inFlyout) {
    e.preventDefault();
    closeSubmenu();
    const parentBtn = root.querySelector<HTMLElement>('.player-context-item-parent');
    parentBtn?.focus({ preventScroll: true });
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
  if (screenshotPlaybackHold || screenshotUi.value) return;
  const v = videoRef.value;
  if (!v) return;
  // At end, play() alone often stays on the last frame — restart from 0.
  if (state.value === 'ended') {
    replay();
    return;
  }
  if (v.paused) { v.play().catch(() => {}); } else { v.pause(); }
}

watch(showFrameStepper, (show) => {
  if (!show) {
    stopFrameHold();
    framePanelOpen.value = false;
  }
});

function doClose() {
  stopFrameHold();
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
  if (!v || !v.paused) return false;
  const step = delta / Math.max(fps || 30, 1);
  const t = Math.max(0, Math.min(v.duration || 0, v.currentTime + step));
  if (t === v.currentTime) return false;
  v.currentTime = t;
  currentTime.value = t;
  return true;
}

function clearFrameHoldSeeked() {
  if (frameHoldOnSeeked) {
    videoRef.value?.removeEventListener('seeked', frameHoldOnSeeked);
    frameHoldOnSeeked = null;
  }
}

function stopFrameHold() {
  frameHoldActive = false;
  frameHoldGen += 1;
  if (frameHoldDelay != null) {
    clearTimeout(frameHoldDelay);
    frameHoldDelay = null;
  }
  clearFrameHoldSeeked();
  // One final UI sync so the progress bar lands on the real frame.
  const v = videoRef.value;
  if (v) currentTime.value = v.currentTime;
}

/**
 * Continuous step paced by the decoder: only issue the next currentTime
 * after the previous seeked. Fixed-interval seeks without waiting queue up
 * and stutter (especially on NAS / high-bitrate H.264).
 */
function startFrameHoldRepeat(delta: number, gen: number) {
  if (gen !== frameHoldGen) return;
  const v0 = videoRef.value;
  if (!v0 || !v0.paused) return;

  frameHoldActive = true;
  const stepSec = delta / Math.max(fps || 30, 1);
  const minIntervalMs = Math.round(1000 / FRAME_HOLD_MAX_HZ);
  // Intentional playhead — do not re-read currentTime after each seek
  // (async lag would cause skipped / doubled frames under load).
  let target = v0.currentTime;
  let lastSeekStart = 0;
  let seeking = false;

  const scheduleNext = () => {
    if (gen !== frameHoldGen || !frameHoldActive) return;
    const elapsed = performance.now() - lastSeekStart;
    const wait = Math.max(0, minIntervalMs - elapsed);
    if (wait > 0) {
      frameHoldDelay = setTimeout(() => {
        frameHoldDelay = null;
        if (gen === frameHoldGen && frameHoldActive) advance();
      }, wait);
    } else {
      advance();
    }
  };

  const advance = () => {
    if (gen !== frameHoldGen || !frameHoldActive || seeking) return;
    const video = videoRef.value;
    if (!video || !video.paused) {
      stopFrameHold();
      return;
    }

    const next = Math.max(0, Math.min(video.duration || 0, target + stepSec));
    if (next === target) {
      currentTime.value = video.currentTime;
      stopFrameHold();
      return;
    }
    target = next;
    seeking = true;
    lastSeekStart = performance.now();

    const onSeeked = () => {
      if (frameHoldOnSeeked === onSeeked) frameHoldOnSeeked = null;
      if (gen !== frameHoldGen || !frameHoldActive) return;
      seeking = false;
      // Throttle Vue updates to seeked cadence (not every timeupdate).
      currentTime.value = video.currentTime;
      scheduleNext();
    };
    clearFrameHoldSeeked();
    frameHoldOnSeeked = onSeeked;
    video.addEventListener('seeked', onSeeked, { once: true });
    video.currentTime = target;
  };

  advance();
}

function retargetTooltip() {
  // Expand/collapse under a still cursor: stale tip host must be dropped.
  document.dispatchEvent(new CustomEvent('wui:tooltip-retarget'));
}

function toggleFramePanel() {
  framePanelOpen.value = !framePanelOpen.value;
  // After grid 0fr→1fr layout, retarget tip to whatever is under the cursor
  // (toggle tip must not stick over −1/+1; J/K tips only on step buttons).
  nextTick(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(retargetTooltip);
    });
  });
}

function onFrameStepPointerDown(delta: number, e: PointerEvent) {
  if (e.button !== 0) return;
  const el = e.currentTarget as HTMLElement;
  // Capture so release outside the button still ends the hold.
  el.setPointerCapture?.(e.pointerId);
  // Never leave focus on ±1 — Space/Enter would re-fire the button and
  // race the document keydown handler (play/pause + frame step).
  el.blur();
  // Drop tip while holding — avoid tip/keyboard-hint racing the seek loop.
  document.dispatchEvent(new CustomEvent('wui:tooltip-hide'));
  stopFrameHold();
  stepFrame(delta);
  const gen = frameHoldGen;
  frameHoldDelay = setTimeout(() => {
    frameHoldDelay = null;
    if (gen !== frameHoldGen) return;
    startFrameHoldRepeat(delta, gen);
  }, FRAME_HOLD_DELAY_MS);
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
  refreshFrameReady();
  if (player.seekMs !== undefined && !seeked) {
    const clampedMs = clampSeekMsForDuration(player.seekMs, v.duration);
    v.currentTime = clampedMs / 1000;
    seeked = true;
  }
}

function onCanPlay() {
  if (screenshotPlaybackHold || screenshotUi.value) {
    clearBufferingTimer();
    bufferingMode.value = 'hidden';
    state.value = 'paused';
    refreshFrameReady();
    forceVideoPaused();
    return;
  }
  const transition = canPlayTransition(state.value, stateBeforeSeek);
  if (transition.clearPendingBuffering) {
    clearBufferingTimer();
    bufferingMode.value = 'hidden';
  }
  state.value = transition.nextState;
  refreshFrameReady();
  if (transition.shouldPlay) {
    videoRef.value?.play().catch(() => {});
  }
}

function onPlay() {
  if (screenshotPlaybackHold || screenshotUi.value) {
    // Seek/canplay/dialog race: force stay paused on the save frame.
    forceVideoPaused();
    return;
  }
  clearBufferingTimer();
  state.value = 'playing';
  bufferingMode.value = 'hidden';
  scheduleHide();
  if (!fpsMeasured) { fpsMeasured = true; const v = videoRef.value; if (v) measureFps(v); }
}

function onPause() {
  if (state.value === 'buffering' && !screenshotPlaybackHold) return;
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
  // Hold-step owns seeking; do not mark seek windows / dim overlay.
  if (frameHoldActive) return;
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
  if (isDragging.value || frameHoldActive) return;
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
  // Pointer hold owns continuous frame stepping. Any player hotkey yields
  // ownership so keyboard seeks / play do not race the seeked hold loop.
  if (frameHoldActive || frameHoldDelay != null) {
    stopFrameHold();
  }
  // J/K tips on ±1 must not stick after keyboard steps (cursor may still hover).
  if (e.key === 'j' || e.key === 'k' || e.key === 'J' || e.key === 'K') {
    document.dispatchEvent(new CustomEvent('wui:tooltip-hide'));
  }
  // Frame-step buttons are mouse-only (tabindex=-1). If focus somehow lands
  // on one, Space must not both activate the button and togglePlay.
  if (target?.closest('.player-frame-step')) {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      return;
    }
  }
  const v = videoRef.value;
  if (!v) return;
  // Screenshot save hold: no play/seek hotkeys while frozen on the capture frame.
  if (screenshotPlaybackHold || screenshotUi.value) {
    if (
      e.key === ' '
      || e.key === 'k' || e.key === 'K'
      || e.key === 'j' || e.key === 'J'
      || e.key === 'l' || e.key === 'L'
      || e.key === 'ArrowLeft' || e.key === 'ArrowRight'
    ) {
      e.preventDefault();
    }
    return;
  }

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
      currentTime.value = v.currentTime;
      break;
    case 'ArrowRight':
      e.preventDefault();
      v.currentTime = Math.min(v.duration || 0, v.currentTime + 5);
      currentTime.value = v.currentTime;
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
  stopFrameHold();
  stopScreenshotPauseWatchdog();
  screenshotPlaybackHold = false;
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

/* Screenshot busy: gray the player shell + indeterminate accent bar. */
.player-screenshot-overlay {
  position: absolute;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  background: oklch(0.12 0.01 30 / 0.62);
  opacity: 0;
  pointer-events: none;
  transition: opacity 160ms ease;
}
.player-screenshot-overlay.is-visible {
  opacity: 1;
  pointer-events: auto;
}
.player-screenshot-card {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
  min-width: min(280px, 70%);
  padding: 16px 18px;
  border-radius: var(--r-md, 6px);
  background: var(--surface-2, oklch(0.19 0.012 30));
  border: 1px solid var(--line, oklch(0.30 0.014 30));
  box-shadow: 0 12px 32px oklch(0 0 0 / 0.35);
}
.player-screenshot-label {
  font-family: var(--font-sans, MiSans, system-ui, sans-serif);
  font-size: 13px;
  font-weight: var(--w-medium, 380);
  color: var(--ink-2, oklch(0.78 0.012 30));
  text-align: center;
}
.player-screenshot-progress {
  position: relative;
  width: 100%;
  height: 6px;
  background: var(--surface-3, oklch(0.22 0.014 30));
  border-radius: 999px;
  overflow: hidden;
}
.player-screenshot-progress-shimmer {
  position: absolute;
  top: 0;
  left: 0;
  width: 40%;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    var(--accent, oklch(0.62 0.21 25)) 50%,
    transparent 100%
  );
  opacity: 0.75;
  animation: player-screenshot-shimmer 1.6s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}
@keyframes player-screenshot-shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(250%); }
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

/* Top-left frame dock (pause only). Same chrome as .player-close-top. */
.player-frame-panel {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 6;
  display: flex;
  align-items: center;
  height: 32px;
  padding: 0 2px 0 0;
  background: oklch(0 0 0 / 0.45);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  pointer-events: auto;
  user-select: none;
  -webkit-user-select: none;
}
.player-frame-panel-toggle {
  width: auto;
  min-width: 32px;
  height: 28px;
  margin: 0 2px;
  padding: 0 8px;
  gap: 5px;
  color: var(--ink-2);
  border-radius: calc(var(--radius) - 1px);
}
.player-frame-panel-toggle:hover {
  color: var(--ink);
  background: oklch(1 0 0 / 0.08);
}
.player-frame-panel.is-open .player-frame-panel-toggle {
  color: var(--ink);
}
.player-frame-panel-label {
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: var(--w-medium);
  line-height: 1;
  white-space: nowrap;
}
/* grid 0fr→1fr expands tools without remounting or fixed max-width clipping */
.player-frame-panel-tools {
  display: grid;
  grid-template-columns: 0fr;
  opacity: 0;
  pointer-events: none;
  transition:
    grid-template-columns 180ms cubic-bezier(0.16, 1, 0.3, 1),
    opacity 140ms ease-out;
}
.player-frame-panel.is-open .player-frame-panel-tools {
  grid-template-columns: 1fr;
  opacity: 1;
  pointer-events: auto;
}
.player-frame-panel-tools-inner {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  overflow: hidden;
  padding-right: 2px;
}
.player-frame-panel-sep {
  width: 1px;
  height: 14px;
  flex-shrink: 0;
  margin: 0 2px;
  background: var(--border-soft);
}
.player-frame-step {
  width: 32px;
  height: 28px;
  flex-shrink: 0;
  color: var(--ink-2);
  border-radius: calc(var(--radius) - 1px);
  touch-action: none;
}
.player-frame-step:hover,
.player-frame-step:active {
  color: var(--ink);
  background: oklch(1 0 0 / 0.08);
}
.player-frame-step-label {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: var(--w-semibold);
  line-height: 1;
  letter-spacing: 0;
  pointer-events: none;
  white-space: nowrap;
}
@media (prefers-reduced-motion: reduce) {
  .player-frame-panel-tools {
    transition-duration: 1ms;
  }
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
.player-context-sep {
  height: 1px;
  margin: 4px 6px;
  background: var(--border-soft);
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
.player-context-item-label {
  flex: 1;
  min-width: 0;
}
.player-context-chevron {
  margin-left: auto;
  opacity: 0.55;
  flex-shrink: 0;
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
.player-context-sub {
  position: relative;
}
.player-context-sub.is-open > .player-context-item-parent {
  background: var(--surface-3);
  color: var(--ink);
}
/* Flyout shares root chrome: overlap the shared edge, light shadow, same radius. */
.player-context-flyout {
  position: absolute;
  top: -4px; /* align with root padding so first item lines up */
  left: calc(100% - 1px); /* overlap root border → one continuous surface */
  z-index: 1;
  min-width: 168px;
  padding: 4px;
  background: var(--surface-2);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  box-shadow: 4px 4px 16px oklch(0 0 0 / 0.28);
}
.player-context-sub.is-flip .player-context-flyout {
  left: auto;
  right: calc(100% - 1px);
  box-shadow: -4px 4px 16px oklch(0 0 0 / 0.28);
}
.player-context-sub.is-open > .player-context-item-parent .player-context-chevron {
  opacity: 0.9;
  color: var(--ink);
}
</style>
