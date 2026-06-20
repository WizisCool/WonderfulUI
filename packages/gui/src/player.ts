/**
 * WonderfulUI built-in video player.
 *
 * Modal overlay with H.264 playback via WebView2's native <video> element.
 * YouTube-style auto-hide controls (3 s) and keyboard shortcuts
 * (Space / K / ←→ / J L / ↑↓ / M / Esc).
 *
 * Visual style aligned with DESIGN.md: tonal layering (no backdrop-filter,
 * no box-shadow on the modal). Controls use the Icon Button pattern
 * (32×32, Panel Raised on hover).
 */
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import type { MatchRecord, VideoItem } from '@wonderful-ui/parser';
import { createElement, Play, Pause, Volume2, Volume1, VolumeX, FolderOpen, Share2, Maximize2, Minimize2, ChevronLeft, ChevronRight, X, Crosshair, Skull } from 'lucide';
import { clampSeekMsForDuration, EVENT_PREROLL_MS } from './event-time.ts';
import { effectiveMarkerDurationMs, layoutEventMarkers, MARKER_OVERHEAD_PX, type EventMarkerLayout } from './player-event-markers.ts';
import { eventMarkersForVideo, type EventMarker } from './match-events.ts';
/* ─── module state (singleton) ─────────────────────────────── */

let backdropEl: HTMLElement | null = null;
let videoEl: HTMLVideoElement | null = null;
let onCloseCb: (() => void) | null = null;

let hideTimer: ReturnType<typeof setTimeout> | null = null;
let preMuteVol = 100;
let keyboardFn: ((e: KeyboardEvent) => void) | null = null;
let fps = 60; /* measured via requestVideoFrameCallback on first play */

const LS_VOL  = 'wui:player.vol';
const LS_MUTED = 'wui:player.muted';

function saveVolState(level: number, muted: boolean) {
  try { localStorage.setItem(LS_VOL, String(level)); } catch {}
  try { localStorage.setItem(LS_MUTED, muted ? '1' : '0'); } catch {}
}

function loadVolState(): { level: number; muted: boolean } {
  try {
    const v = localStorage.getItem(LS_VOL);
    const m = localStorage.getItem(LS_MUTED);
    return { level: Math.max(0, Math.min(100, Number(v) || 100)), muted: m === '1' };
  } catch { return { level: 100, muted: false }; }
}

let isDragging = false;

/* ─── public API ──────────────────────────────────────────── */

export function openPlayer(
  video: VideoItem,
  onClose: () => void,
  seekMs?: number,
  matchContext?: { match: MatchRecord },
): void {
  closePlayer();
  onCloseCb = onClose;

  const host = document.getElementById('player-host');
  if (!host) return;

  const src = convertFileSrc(video.video_src);
  backdropEl = buildBackdrop(video, src, seekMs, matchContext);
  host.appendChild(backdropEl);

  requestAnimationFrame(() => {
    (backdropEl!.querySelector('.player-close-top') as HTMLElement)?.focus();
  });
}

export function closePlayer(): void {
  clearHideTimer();
  if (!backdropEl) return;

  /* exit animation → remove */
  backdropEl.classList.add('is-closing');
  const modal = backdropEl.querySelector('.player-modal');
  if (modal) modal.classList.add('is-closing');

  setTimeout(() => {
    if (backdropEl) { backdropEl.remove(); backdropEl = null; }
    videoEl = null;
    if (keyboardFn) {
      document.removeEventListener('keydown', keyboardFn, true);
      keyboardFn = null;
    }
    if (onCloseCb) { const cb = onCloseCb; onCloseCb = null; cb(); }
  }, 200);
}

/* ─── helpers ─────────────────────────────────────────────── */

function clearHideTimer() { if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; } }

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('data-') || k === 'role' || k === 'tabindex' || k.startsWith('aria-') ||
      k === 'title' || k === 'placeholder' || k === 'type' || k === 'width' || k === 'height') {
      n.setAttribute(k, v);
    } else {
      (n as unknown as Record<string, unknown>)[k] = v;
    }
  }
  for (const c of children) n.append(c);
  return n;
}

function fmtPlayerTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function toast(msg: string) {
  let host = document.getElementById('toast-host');
  if (!host) {
    host = el('div', { id: 'toast-host' });
    document.body.appendChild(host);
  }
  for (const prev of Array.from(host.children)) {
    prev.classList.add('is-closing');
  }
  const t = el('div', { class: 'toast' }, [msg]);
  host.appendChild(t);
  setTimeout(() => {
    t.classList.add('is-closing');
    t.addEventListener('transitionend', () => { if (t.isConnected) t.remove(); }, { once: true });
    setTimeout(() => { if (t.isConnected) t.remove(); }, 240);
  }, 2500);
}

/* ─── DOM builders ────────────────────────────────────────── */

function buildBackdrop(video: VideoItem, src: string, seekMs?: number, matchContext?: { match: MatchRecord }): HTMLElement {
  const backdrop = el('div', { class: 'player-backdrop' });

  const modal = el('div', { class: 'player-modal' });

  /* ── stage (16:9) ── */
  const stage = el('div', { class: 'player-stage' });

  const vEl = el('video', {
    class: 'player-video',
    preload: 'auto',
    src,
  }) as HTMLVideoElement;
  videoEl = vEl;

  const loading = buildLoading(video);
  const errorDiv = buildError(video);
  const replayBtn = buildReplayBtn();
  const frameStepper = buildFrameStepper();

  stage.appendChild(vEl);
  stage.appendChild(loading);
  stage.appendChild(errorDiv);
  stage.appendChild(replayBtn);
  stage.appendChild(frameStepper);

  /* ── controls ── */
  const controls = buildControls(video, matchContext);
  const progressWrap = controls.querySelector('.player-progress-wrap') as HTMLElement;
  const progressTrack = controls.querySelector('.player-progress-track') as HTMLElement;
  const progressFill = controls.querySelector('.player-progress-fill') as HTMLElement;
  const progressThumb = controls.querySelector('.player-progress-thumb') as HTMLElement;
  const timeDisplay = controls.querySelector('.player-time') as HTMLElement;

  const playBtn = controls.querySelector('.player-ctrl-play') as HTMLElement;
  const volBtn = controls.querySelector('.player-ctrl-vol') as HTMLElement;
  const volTrack = controls.querySelector('.player-vol-track') as HTMLElement;
  const volFill = controls.querySelector('.player-vol-fill') as HTMLElement;
  const explorerBtn = controls.querySelector('.player-ctrl-explorer') as HTMLElement;
  const shareBtn = controls.querySelector('.player-ctrl-share') as HTMLElement;
  const fullscreenBtn = controls.querySelector('.player-ctrl-fullscreen') as HTMLElement;

  /* close button — top-right corner of modal */
  const closeTop = el('button', {
    class: 'ctrl-btn player-close-top',
    'aria-label': '关闭',
  }, [createElement(X, { width: 16, height: 16 })]);
  closeTop.addEventListener('click', (e) => { e.stopPropagation(); closePlayer(); });

  modal.appendChild(closeTop);
  modal.appendChild(stage);
  modal.appendChild(controls);
  backdrop.appendChild(modal);

  /* ── wire everything ── */
  wireVideoEvents(vEl, loading, errorDiv, replayBtn, playBtn, timeDisplay,
    progressFill, progressThumb, progressWrap, video, frameStepper, seekMs);
  wireProgress(progressWrap, progressTrack, progressFill, progressThumb, vEl);
  wireVolume(volBtn, volTrack, volFill, vEl);
  wireAutoHide(controls, vEl, backdrop);
  wireContextMenu(stage, video.video_src);

  /* play/pause on stage click */
  stage.addEventListener('click', (e) => {
    e.stopPropagation();
    if (vEl.paused) { vEl.play().catch(() => {}); } else { vEl.pause(); }
  });

  /* frame stepper buttons */
  const frameBackBtn = frameStepper.querySelector('button:first-child') as HTMLElement;
  const frameFwdBtn = frameStepper.querySelector('button:last-child') as HTMLElement;
  frameBackBtn.addEventListener('click', (e) => { e.stopPropagation(); stepFrame(vEl, -1); });
  frameFwdBtn.addEventListener('click', (e) => { e.stopPropagation(); stepFrame(vEl, 1); });

  /* close on backdrop click */
  backdrop.addEventListener('click', () => closePlayer());

  /* prevent modal clicks from bubbling to backdrop close */
  modal.addEventListener('click', (e) => e.stopPropagation());

  /* action buttons */
  explorerBtn.addEventListener('click', () => {
    invoke('reveal_in_explorer', { path: video.video_src }).catch((e) => {
      toast(`打开资源管理器失败: ${e}`);
    });
  });
  shareBtn.addEventListener('click', () => {
    toast('分享功能即将推出');
  });

  /* fullscreen toggle */
  const toggleFullscreen = () => {
    if (!backdropEl) return;
    const modal = backdropEl.querySelector('.player-modal') as HTMLElement;
    if (!modal) return;
    if (!document.fullscreenElement) {
      modal.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  fullscreenBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFullscreen();
  });

  document.addEventListener('fullscreenchange', () => {
    if (!fullscreenBtn || !fullscreenBtn.isConnected) return;
    const isFS = !!document.fullscreenElement;
    fullscreenBtn.title = isFS ? '退出全屏' : '全屏';
    fullscreenBtn.innerHTML = '';
    fullscreenBtn.appendChild(createElement(isFS ? Minimize2 : Maximize2, { width: 16, height: 16 }));
    requestAnimationFrame(() => repositionEventMarkers());
  });

  /* wire keyboard — pass toggleFullscreen for F key and fullscreen-aware Esc */
  wireKeyboard(playBtn, vEl, vid => openPlayer(vid, onCloseCb!), toggleFullscreen);

  /* wire event marker clicks */
  const markersContainer = modal.querySelector('.player-event-markers') as HTMLElement | null;
  if (markersContainer) {
    const seekToMarker = (dot: HTMLElement) => {
      const timeMs = Number(dot.dataset.timeMs ?? '0');
      if (!vEl.duration) return;
      const seekMs = Math.max(0, timeMs - EVENT_PREROLL_MS);
      const targetSec = Math.min(seekMs / 1000, vEl.duration - 0.05);
      const pct = (targetSec / vEl.duration) * 100;

      progressWrap.classList.add('is-marker-seek');
      progressFill.style.width = `${pct}%`;
      progressThumb.style.left = `${pct}%`;

      vEl.currentTime = targetSec;
      if (vEl.paused) vEl.play().catch(() => {});

      setTimeout(() => progressWrap.classList.remove('is-marker-seek'), 220);
    };
    markersContainer.addEventListener('click', (e: MouseEvent) => {
      const dot = (e.target as HTMLElement).closest('.player-event-marker') as HTMLElement | null;
      if (!dot) return;
      seekToMarker(dot);
      e.stopPropagation();
    });
    markersContainer.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const dot = (e.target as HTMLElement).closest('.player-event-marker') as HTMLElement | null;
      if (!dot) return;
      seekToMarker(dot);
      e.preventDefault();
      e.stopPropagation();
    });
  }

  /* auto-play on open */
  vEl.play().catch(() => {});

  return backdrop;
}

function buildLoading(video: VideoItem): HTMLElement {
  return el('div', { class: 'player-loading' }, [
    video.video_poster
      ? el('img', { class: 'player-loading-poster', src: convertFileSrc(video.video_poster), alt: '' })
      : el('div', { class: 'player-loading-poster' }),
    el('div', { class: 'player-loading-darken' }),
    el('div', { class: 'player-spinner' }),
  ]);
}

function buildError(video: VideoItem): HTMLElement {
  const path = video.video_src;
  return el('div', { class: 'player-error is-hidden' }, [
    el('div', { class: 'player-error-icon' }, [String.fromCodePoint(0x26A0)]),
    el('div', { class: 'player-error-title' }, ['该高光视频源不可用']),
    el('div', { class: 'player-error-path' }, [
      el('code', {}, [path]),
    ]),
    el('div', { class: 'player-error-actions' }, [
      el('button', { class: 'btn ghost' }, ['关闭']),
      el('button', { class: 'btn ghost' }, ['在资源管理器中打开']),
    ]),
  ]);
}

function buildReplayBtn(): HTMLElement {
  return el('button', { class: 'player-replay-btn', 'aria-label': '重播' }, [
    createElement(Play, { width: 28, height: 28 }),
  ]);
}

function buildFrameStepper(): HTMLElement {
  const wrap = el('div', { class: 'player-frame-stepper' });
  const backBtn = el('button', { class: 'frame-stepper-btn', 'aria-label': '上一帧' }, [
    createElement(ChevronLeft, { width: 24, height: 24 }),
  ]);
  const fwdBtn = el('button', { class: 'frame-stepper-btn', 'aria-label': '下一帧' }, [
    createElement(ChevronRight, { width: 24, height: 24 }),
  ]);
  wrap.appendChild(backBtn);
  wrap.appendChild(fwdBtn);
  return wrap;
}

function buildControls(video: VideoItem, matchContext?: { match: MatchRecord }): HTMLElement {
  const ctrl = el('div', { class: 'player-controls' });
  const row = el('div', { class: 'player-ctrl-row' });

  const playBtn = el('button', {
    class: 'ctrl-btn player-ctrl-play',
    'aria-label': '播放',
  }, [createElement(Play, { width: 16, height: 16 })]);
  row.appendChild(playBtn);

  /* progress bar */
  const progressWrap = el('div', { class: 'player-progress-wrap' });
  const progressTrack = el('div', { class: 'player-progress-track' });
  const buffered = el('div', { class: 'player-progress-buffered' });
  const fill = el('div', { class: 'player-progress-fill' });
  const thumb = el('div', { class: 'player-progress-thumb' });

  /* event markers on the progress bar */
  const markers = matchContext?.match ? eventMarkersForVideo(video, matchContext.match) : [];
  const markerDurationMs = effectiveMarkerDurationMs(markers, video.video_duration);
  const markersEl = buildEventMarkers(markers, markerDurationMs);
  progressTrack.appendChild(buffered);
  if (markersEl) progressTrack.appendChild(markersEl);
  progressTrack.appendChild(fill);
  progressTrack.appendChild(thumb);
  progressWrap.appendChild(progressTrack);
  row.appendChild(progressWrap);

  /* time */
  const timeEl = el('span', { class: 'player-time' }, ['0:00 / 0:00']);
  row.appendChild(timeEl);

  /* volume */
  const volWrap = el('div', { class: 'player-vol-wrap' });
  const volBtn = el('button', {
    class: 'ctrl-btn player-ctrl-vol',
    'aria-label': '静音',
  }, [createElement(Volume2, { width: 16, height: 16 })]);
  const volTrack = el('div', { class: 'player-vol-track' });
  const volFill = el('div', { class: 'player-vol-fill' });
  volTrack.appendChild(volFill);
  volWrap.appendChild(volBtn);
  volWrap.appendChild(volTrack);
  row.appendChild(volWrap);

  /* explorer */
  const explorerBtn = el('button', {
    class: 'ctrl-btn player-ctrl-explorer',
    title: '在资源管理器中打开',
  }, [createElement(FolderOpen, { width: 16, height: 16 })]);
  row.appendChild(explorerBtn);

  /* share (placeholder) */
  const shareBtn = el('button', {
    class: 'ctrl-btn player-ctrl-share',
    disabled: 'true',
    title: '即将推出',
  }, [createElement(Share2, { width: 16, height: 16 })]);
  row.appendChild(shareBtn);

  /* fullscreen */
  const fullscreenBtn = el('button', {
    class: 'ctrl-btn player-ctrl-fullscreen',
    title: '全屏',
  }, [createElement(Maximize2, { width: 16, height: 16 })]);
  row.appendChild(fullscreenBtn);

  ctrl.appendChild(row);
  return ctrl;
}

function buildEventMarkers(markers: EventMarker[], videoDurationMs: number): HTMLElement | null {
  const layouts = layoutEventMarkers(markers, videoDurationMs);
  if (layouts.length === 0) return null;
  const container = el('div', { class: 'player-event-markers' });
  container.dataset.rawMarkers = JSON.stringify(markers);
  renderEventMarkerLayouts(container, layouts);
  return container;
}

function renderEventMarkerLayouts(
  container: HTMLElement,
  layouts: EventMarkerLayout<EventMarker>[],
) {
  container.replaceChildren();
  for (const layout of layouts) {
    const tip = eventMarkerTip(layout);
    const tone = layout.marker.type === 'death' ? 'death'
      : layout.isHeadshot ? 'headshot' : 'attack';
    const line = el('div', {
      class: [
        'player-event-marker',
        `lane-${layout.lane}`,
        `tone-${tone}`,
        layout.displayMode === 'compact' ? 'is-compact' : '',
        layout.isHeadshot ? 'headshot' : '',
      ].filter(Boolean).join(' '),
      'data-time-ms': String(layout.timeMs),
      'data-tip': tip,
      role: 'button',
      tabindex: '0',
      'aria-label': tip,
      'data-placement': layout.placement,
    }, eventMarkerChildren(layout.marker.type));
    line.style.left = `${layout.leftPct}%`;
    line.style.setProperty('--event-marker-top', `${layout.topPx}px`);
    line.style.setProperty('--event-marker-stem', `${layout.stemPx}px`);
    container.appendChild(line);
  }
}

function repositionEventMarkers() {
  const container = backdropEl?.querySelector('.player-event-markers') as HTMLElement | null;
  if (!container || !videoEl || !videoEl.duration) return;
  let markers: EventMarker[] = [];
  try {
    const raw = JSON.parse(container.dataset.rawMarkers ?? '[]');
    if (Array.isArray(raw)) markers = raw as EventMarker[];
  } catch {
    return;
  }
  const durationMs = effectiveMarkerDurationMs(markers, 0, videoEl.duration);
  const trackRect = container.getBoundingClientRect();
  const placement = trackRect.top < MARKER_OVERHEAD_PX ? 'bottom' : 'top';
  const layouts = layoutEventMarkers(markers, durationMs, {
    trackWidthPx: trackRect.width,
    placement,
    trackHeightPx: trackRect.height,
  });
  renderEventMarkerLayouts(container, layouts);
}

function eventMarkerTip(layout: EventMarkerLayout<EventMarker>): string {
  const marker = layout.marker;
  const isKill = marker.type === 'kill';
  return `${isKill ? '击杀' : '阵亡'}${marker.playerName ? ` ${marker.playerName}` : ''}${marker.isHeadshot ? ' · 爆头' : ''} · ${fmtPlayerTime(marker.timeMs / 1000)}`;
}

function eventMarkerChildren(type: string): (Node | string)[] {
  if (type === 'death') return [createElement(Skull, { width: 11, height: 11 })];
  return [createElement(Crosshair, { width: 11, height: 11 })];
}

/* ─── wiring ──────────────────────────────────────────────── */

function wireVideoEvents(
  vEl: HTMLVideoElement,
  loading: HTMLElement,
  errorDiv: HTMLElement,
  replayBtn: HTMLElement,
  playBtn: HTMLElement,
  timeDisplay: HTMLElement,
  fill: HTMLElement,
  thumb: HTMLElement,
  progressWrap: HTMLElement,
  video: VideoItem,
  frameStepper: HTMLElement,
  seekMs?: number,
) {
  let seeked = false;

  vEl.addEventListener('loadedmetadata', () => {
    timeDisplay.textContent = `0:00 / ${fmtPlayerTime(vEl.duration)}`;
    if (seekMs !== undefined && !seeked) {
      const clampedMs = clampSeekMsForDuration(seekMs, vEl.duration);
      vEl.currentTime = clampedMs / 1000;
      seeked = true;
    }
    repositionEventMarkers();
  });

  vEl.addEventListener('canplay', () => {
    loading.classList.add('is-hidden');
  });

  let fpsMeasured = false;

  vEl.addEventListener('play', () => {
    setPlayBtnIcon(playBtn, true);
    scheduleHide();
    frameStepper.classList.remove('is-visible');
    if (!fpsMeasured) { fpsMeasured = true; measureFps(vEl); }
  });
  vEl.addEventListener('pause', () => {
    setPlayBtnIcon(playBtn, false);
    showControls();
    frameStepper.classList.add('is-visible');
  });
  vEl.addEventListener('ended', () => {
    setPlayBtnIcon(playBtn, false);
    showControls();
    replayBtn.classList.add('is-visible');
    frameStepper.classList.remove('is-visible');
  });

  vEl.addEventListener('timeupdate', () => {
    if (isDragging) return;
    const dur = vEl.duration || 0;
    const cur = vEl.currentTime || 0;
    const pct = dur > 0 ? (cur / dur) * 100 : 0;
    fill.style.width = `${pct}%`;
    thumb.style.left = `${pct}%`;
    timeDisplay.textContent = `${fmtPlayerTime(cur)} / ${fmtPlayerTime(dur)}`;

    /* update buffered bar */
    const buf = vEl.buffered;
    if (buf.length > 0) {
      const bufEnd = buf.end(buf.length - 1);
      const bufPct = dur > 0 ? (bufEnd / dur) * 100 : 0;
      const bufBar = progressWrap.querySelector('.player-progress-buffered') as HTMLElement;
      if (bufBar) bufBar.style.width = `${bufPct}%`;
    }
  });

  vEl.addEventListener('error', () => {
    loading.classList.add('is-hidden');
    errorDiv.classList.remove('is-hidden');
    showControls();
    /* wire error action buttons */
    const btns = errorDiv.querySelectorAll('button');
    if (btns[0]) {
      btns[0].addEventListener('click', closePlayer);
    }
    if (btns[1]) {
      btns[1].addEventListener('click', () => {
        invoke('reveal_in_explorer', { path: video.video_src }).catch(() => {});
      });
    }
  });

  /* replay button */
  replayBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    vEl.currentTime = 0;
    vEl.play().catch(() => {});
    replayBtn.classList.remove('is-visible');
  });

  /* play/pause button */
  playBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (vEl.paused) { vEl.play().catch(() => {}); } else { vEl.pause(); }
  });
}

function setPlayBtnIcon(btn: HTMLElement, playing: boolean) {
  btn.innerHTML = '';
  if (playing) {
    btn.appendChild(createElement(Pause, { width: 16, height: 16 }));
    btn.setAttribute('aria-label', '暂停');
  } else {
    btn.appendChild(createElement(Play, { width: 16, height: 16 }));
    btn.setAttribute('aria-label', '播放');
  }
}

/* ─── progress bar ────────────────────────────────────────── */

function wireProgress(
  wrap: HTMLElement, track: HTMLElement, fill: HTMLElement, thumb: HTMLElement,
  vEl: HTMLVideoElement,
) {
  function seekFromClient(clientX: number) {
    if (!vEl.duration) return 0;
    const rect = track.getBoundingClientRect();
    let pct = (clientX - rect.left) / rect.width;
    pct = Math.max(0, Math.min(1, pct));
    const t = pct * vEl.duration;
    vEl.currentTime = t;
    fill.style.width = `${pct * 100}%`;
    thumb.style.left = `${pct * 100}%`;
    return t;
  }

  wrap.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.player-event-marker')) return;
    e.preventDefault();
    isDragging = true;
    seekFromClient(e.clientX);
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    if (!wrap.classList.contains('is-dragging')) {
      wrap.classList.add('is-dragging');
    }
    seekFromClient(e.clientX);
  });

  document.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    wrap.classList.remove('is-dragging');
  });
}

/* ─── volume ──────────────────────────────────────────────── */

function wireVolume(
  volBtn: HTMLElement, volTrack: HTMLElement, volFill: HTMLElement,
  vEl: HTMLVideoElement,
) {
  /* load persisted volume */
  const saved = loadVolState();
  preMuteVol = saved.level;
  vEl.volume = saved.muted ? 0 : saved.level / 100;
  vEl.muted = saved.muted;
  updateVolUI(volBtn, volFill, saved.muted ? 0 : saved.level, saved.level);

  volBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (vEl.muted || vEl.volume === 0) {
      vEl.muted = false;
      vEl.volume = preMuteVol / 100;
      updateVolUI(volBtn, volFill, preMuteVol, preMuteVol);
      saveVolState(preMuteVol, false);
    } else {
      preMuteVol = Math.round(vEl.volume * 100);
      vEl.muted = true;
      updateVolUI(volBtn, volFill, 0, 0);
      saveVolState(preMuteVol, true);
    }
  });

  /* scroll wheel on volume button */
  volBtn.addEventListener('wheel', (e) => {
    e.preventDefault();
    const cur = Math.round(vEl.volume * 100);
    const next = Math.max(0, Math.min(100, cur - Math.sign(e.deltaY) * 5));
    vEl.volume = next / 100;
    vEl.muted = false;
    preMuteVol = next;
    updateVolUI(volBtn, volFill, next, next);
    saveVolState(next, false);
  });

  volTrack.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setVolFromEvent(e, volFill);
    vEl.volume = preMuteVol / 100;
    vEl.muted = false;
    updateVolUI(volBtn, volFill, preMuteVol, preMuteVol);
    saveVolState(preMuteVol, false);

    const onMove = (ev: MouseEvent) => {
      setVolFromEvent(ev, volFill);
      vEl.volume = preMuteVol / 100;
      vEl.muted = false;
      updateVolUI(volBtn, volFill, preMuteVol, preMuteVol);
      saveVolState(preMuteVol, false);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  function setVolFromEvent(e: MouseEvent, fill: HTMLElement) {
    const rect = volTrack.getBoundingClientRect();
    let pct = (e.clientX - rect.left) / rect.width;
    pct = Math.max(0, Math.min(1, pct));
    preMuteVol = Math.round(pct * 100);
    fill.style.width = `${pct * 100}%`;
  }
}

function updateVolUI(btn: HTMLElement, fill: HTMLElement, level: number, preMute: number) {
  fill.style.width = `${level}%`;
  btn.innerHTML = '';
  if (level === 0) {
    btn.appendChild(createElement(VolumeX, { width: 16, height: 16 }));
    btn.setAttribute('aria-label', '取消静音');
  } else if (level < 50) {
    btn.appendChild(createElement(Volume1, { width: 16, height: 16 }));
    btn.setAttribute('aria-label', '静音');
  } else {
    btn.appendChild(createElement(Volume2, { width: 16, height: 16 }));
    btn.setAttribute('aria-label', '静音');
  }
}

/* ─── auto-hide controls ──────────────────────────────────── */

function wireAutoHide(controls: HTMLElement, vEl: HTMLVideoElement, backdrop: HTMLElement) {
  function show() {
    clearHideTimer();
    controls.classList.remove('is-hidden');
  }
  function hide() {
    clearHideTimer();
    if (!vEl.paused) {
      hideTimer = setTimeout(() => {
        controls.classList.add('is-hidden');
      }, 3000);
    }
  }

  controls.addEventListener('mouseenter', show);
  controls.addEventListener('mouseleave', () => hide());

  /* show controls when mouse is over the modal but not on controls
   * (so the user can see controls while watching, then they auto-hide) */
  const modal = backdrop.querySelector('.player-modal')!;
  modal.addEventListener('mousemove', () => {
    if (vEl.paused) { show(); return; }
    /* show briefly, then schedule hide */
    show();
    hide();
  });

  vEl.addEventListener('play', () => hide());
  vEl.addEventListener('pause', show);
  vEl.addEventListener('ended', show);
}

/* inline helper — used by auto-hide wiring */
function showControls() {
  if (!backdropEl) return;
  const ctrl = backdropEl.querySelector('.player-controls') as HTMLElement;
  if (ctrl) ctrl.classList.remove('is-hidden');
  clearHideTimer();
}
function scheduleHide() {
  if (!backdropEl) return;
  const ctrl = backdropEl.querySelector('.player-controls') as HTMLElement;
  if (!ctrl) return;
  clearHideTimer();
  hideTimer = setTimeout(() => {
    ctrl.classList.add('is-hidden');
  }, 3000);
}

/* ─── keyboard ────────────────────────────────────────────── */

function wireKeyboard(
  playBtn: HTMLElement, vEl: HTMLVideoElement,
  openAgain: (video: any) => void,
  toggleFS: () => void,
) {
  if (keyboardFn) document.removeEventListener('keydown', keyboardFn, true);

  keyboardFn = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    switch (e.key) {
      case ' ': {
        e.preventDefault();
        if (vEl.paused) { vEl.play().catch(() => {}); } else { vEl.pause(); }
        break;
      }
      case 'k': {
        e.preventDefault();
        stepFrame(vEl, 1);
        break;
      }
      case 'j': {
        e.preventDefault();
        stepFrame(vEl, e.shiftKey ? -5 : -1);
        break;
      }
      case 'l': {
        e.preventDefault();
        if (e.shiftKey) { stepFrame(vEl, 5); } else { vEl.play().catch(() => {}); }
        break;
      }
      case 'ArrowLeft': {
        e.preventDefault();
        vEl.currentTime = Math.max(0, vEl.currentTime - 5);
        break;
      }
      case 'ArrowRight': {
        e.preventDefault();
        vEl.currentTime = Math.min(vEl.duration || 0, vEl.currentTime + 5);
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        adjustVolume(vEl, 10);
        break;
      }
      case 'ArrowDown': {
        e.preventDefault();
        adjustVolume(vEl, -10);
        break;
      }
      case 'm': {
        e.preventDefault();
        if (vEl.muted || vEl.volume === 0) {
          vEl.muted = false;
          vEl.volume = preMuteVol / 100;
          saveVolState(preMuteVol, false);
        } else {
          preMuteVol = Math.round(vEl.volume * 100);
          vEl.muted = true;
          saveVolState(preMuteVol, true);
        }
        /* update volume UI */
        const volBtn = backdropEl?.querySelector('.player-ctrl-vol') as HTMLElement;
        const volFill = backdropEl?.querySelector('.player-vol-fill') as HTMLElement;
        if (volBtn && volFill) {
          const level = vEl.muted ? 0 : preMuteVol;
          updateVolUI(volBtn, volFill, level, preMuteVol);
        }
        break;
      }
      case 'F':
      case 'f': {
        e.preventDefault();
        toggleFS();
        break;
      }
      case 'Escape': {
        e.preventDefault();
        if (document.fullscreenElement) {
          document.exitFullscreen();
        } else {
          closePlayer();
        }
        break;
      }
    }
  };

  document.addEventListener('keydown', keyboardFn, true);
}

function adjustVolume(vEl: HTMLVideoElement, delta: number) {
  const cur = Math.round(vEl.volume * 100);
  const next = Math.max(0, Math.min(100, cur + delta));
  vEl.volume = next / 100;
  vEl.muted = false;
  preMuteVol = next;
  saveVolState(next, false);
  const volBtn = backdropEl?.querySelector('.player-ctrl-vol') as HTMLElement;
  const volFill = backdropEl?.querySelector('.player-vol-fill') as HTMLElement;
  if (volBtn && volFill) updateVolUI(volBtn, volFill, next, next);
}

function stepFrame(vEl: HTMLVideoElement, delta: number) {
  if (!vEl.paused) return;
  const t = vEl.currentTime + delta / fps;
  vEl.currentTime = Math.max(0, Math.min(vEl.duration, t));
}

function measureFps(vEl: HTMLVideoElement) {
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
    vEl.requestVideoFrameCallback(cb);
  };
  vEl.requestVideoFrameCallback(cb);
}

/* ─── context menu ────────────────────────────────────────── */

function wireContextMenu(stage: HTMLElement, videoPath: string) {
  stage.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const existing = document.querySelector('.player-context-menu');
    if (existing) existing.remove();

    const items = [
      { label: '在系统播放器中打开', action: () => { invoke('play_video', { path: videoPath }).catch(() => {}); } },
      { label: '在资源管理器中打开', action: () => { invoke('reveal_in_explorer', { path: videoPath }).catch(() => {}); } },
      { label: '复制视频路径', action: () => { navigator.clipboard.writeText(videoPath); toast('已复制路径'); } },
    ];

    const menu = el('div', { class: 'player-context-menu' },
      items.map(item => el('button', { class: 'player-context-item' }, [item.label])),
    );

    /* position */
    const px = (e as MouseEvent).clientX;
    const py = (e as MouseEvent).clientY;
    menu.style.left = `${px}px`;
    menu.style.top = `${py}px`;

    /* wire actions */
    const btns = menu.querySelectorAll('button');
    items.forEach((item, i) => {
      btns[i]!.addEventListener('click', () => {
        item.action();
        closeMenu(menu);
      });
    });

    /* close helpers */
    const closeOnClick = (ev: MouseEvent) => {
      if (!menu.contains(ev.target as Node)) closeMenu(menu);
    };
    const closeOnEsc = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') closeMenu(menu);
    };

    /* defer listeners so current click doesn't trigger close */
    requestAnimationFrame(() => {
      if (!menu.isConnected) return;
      document.addEventListener('click', closeOnClick);
      document.addEventListener('keydown', closeOnEsc);
    });

    document.body.appendChild(menu);
  });
}

function closeMenu(menu: HTMLElement) {
  if (menu.isConnected) menu.remove();
}
