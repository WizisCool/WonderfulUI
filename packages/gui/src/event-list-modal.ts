/**
 * Event list modal — shows all kill/death events for a single match.
 *
 * Lives in `#player-host` (sibling of `#app`), per the player portal
 * convention in `docs/FRONTEND_CONVENTIONS.md`. Click on a row to jump
 * straight to that moment in the built-in player. The list modal stays
 * open behind the player; the player z-index sits above so the user
 * keeps their event context.
 *
 * The "kill" and "death" counts in the header come from `m.stats.*` (the
 * real match scores), not from the event count — ACLOS rounds may
 * include every event the highlight video contains (often the whole
 * team's shots, not only the local player's), so the event list is
 * never a reliable per-player tally.
 */
import { createElement, Crosshair, Skull, X, Play } from 'lucide';
import type { MatchRecord, VideoItem } from '@wonderful-ui/parser';
import { weaponNameOnly } from './weapons.ts';
import { normalizeMatchEvents, type NormalizedMatchEvent } from './match-events.ts';

export type FlatEvent = NormalizedMatchEvent;
export const flattenMatchEvents = normalizeMatchEvents;

let backdropEl: HTMLElement | null = null;
let keyboardFn: ((e: KeyboardEvent) => void) | null = null;

export function openEventListModal(
  events: FlatEvent[],
  matchLabel: string,
  onPlay: (video: VideoItem, seekMs: number) => void,
  stats?: { kills: number; deaths: number; assists: number },
): void {
  closeEventListModal();
  const host = document.getElementById('player-host');
  if (!host) return;
  backdropEl = buildBackdrop(events, matchLabel, onPlay, stats);
  host.appendChild(backdropEl);
  requestAnimationFrame(() => {
    (backdropEl!.querySelector('.event-list-modal-close') as HTMLElement)?.focus();
  });
}

export function closeEventListModal(): void {
  // No exit animation per DESIGN.md. Remove the element synchronously.
  if (!backdropEl) return;
  backdropEl.remove();
  backdropEl = null;
  if (keyboardFn) {
    document.removeEventListener('keydown', keyboardFn, true);
    keyboardFn = null;
  }
}

/** Alias kept for clarity at call sites that immediately transition to
 *  another overlay. Behavior is now identical to `closeEventListModal`. */
export function closeEventListModalNow(): void {
  closeEventListModal();
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Record<string, string> = {}, children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('data-') || k === 'role' || k === 'tabindex' || k.startsWith('aria-') || k === 'title') {
      n.setAttribute(k, v);
    } else {
      (n as unknown as Record<string, unknown>)[k] = v;
    }
  }
  for (const c of children) n.append(c);
  return n;
}

function fmtMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function buildBackdrop(
  events: FlatEvent[],
  matchLabel: string,
  onPlay: (video: VideoItem, seekMs: number) => void,
  stats?: { kills: number; deaths: number; assists: number },
): HTMLElement {
  // ACLOS `rounds` may include the whole team's shots in the kill montage,
  // not just the local player's. Show the real per-match score from stats
  // in the header (so the user sees "10/8/2" matching the detail pane)
  // and let the list below speak for itself.
  const hdrK = stats?.kills;
  const hdrD = stats?.deaths;
  const backdrop = el('div', { class: 'event-list-modal-backdrop' });
  const modal = el('div', { class: 'event-list-modal', role: 'dialog', 'aria-label': '本局事件' });

  // ── header ──
  const closeBtn = el('button', {
    class: 'ctrl-btn event-list-modal-close',
    'aria-label': '关闭',
  }, [createElement(X, { width: 16, height: 16 })]);
  closeBtn.addEventListener('click', e => { e.stopPropagation(); closeEventListModal(); });

  const subChildren: (Node | string)[] = [matchLabel];
  if (hdrK !== undefined && hdrD !== undefined) {
    subChildren.push(
      el('span', { class: 'event-list-meta-sep' }, ['·']),
      el('span', { class: 'event-list-meta-kill' }, [`击杀 ${hdrK}`]),
      el('span', { class: 'event-list-meta-sep' }, ['·']),
      el('span', { class: 'event-list-meta-death' }, [`阵亡 ${hdrD}`]),
    );
  }
  const header = el('div', { class: 'event-list-modal-header' }, [
    el('div', { class: 'event-list-modal-title' }, ['本局事件']),
    el('div', { class: 'event-list-modal-sub' }, subChildren),
  ]);

  modal.appendChild(closeBtn);
  modal.appendChild(header);

  // ── table ──
  const tableHead = el('div', { class: 'event-list-row event-list-row-head' }, [
    el('span', { class: 'event-list-col-time' }, ['时间']),
    el('span', { class: 'event-list-col-type' }, ['']),
    el('span', { class: 'event-list-col-player' }, ['玩家']),
    el('span', { class: 'event-list-col-weapon' }, ['武器']),
    el('span', { class: 'event-list-col-extra' }, ['']),
  ]);
  const scroll = el('div', { class: 'event-list-scroll' });
  scroll.appendChild(tableHead);

  for (const ev of events) {
    scroll.appendChild(buildEventRow(ev, onPlay));
  }

  modal.appendChild(scroll);

  // ── footer hint ──
  const footer = el('div', { class: 'event-list-modal-footer' }, [
    createElement(Play, { width: 12, height: 12 }),
    el('span', {}, ['点击行跳播 · 列表留在背后，关闭播放器后可继续查看']),
  ]);
  modal.appendChild(footer);

  backdrop.addEventListener('click', () => closeEventListModal());
  modal.addEventListener('click', e => e.stopPropagation());

  keyboardFn = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); closeEventListModal(); }
  };
  document.addEventListener('keydown', keyboardFn, true);

  backdrop.appendChild(modal);
  return backdrop;
}

function buildEventRow(
  ev: FlatEvent,
  onPlay: (video: VideoItem, seekMs: number) => void,
): HTMLElement {
  const isKill = ev.type === 'kill';
  const typeText = isKill ? '击杀' : '阵亡';
  const weapon = weaponNameOnly(
    String((ev.rawEvent.event_ext as Record<string, unknown> | undefined)?.WeaponSkinName ?? ''),
  );
  const extras: string[] = [];
  if (ev.isHeadshot) extras.push('爆头');
  if (ev.assistNum > 0) extras.push(`助攻×${ev.assistNum}`);

  const row = el('div', {
    class: `event-list-row type-${ev.type}${ev.isHeadshot ? ' headshot' : ''}`,
    'data-time-ms': String(ev.timeMs),
    role: 'button',
    tabindex: '0',
  }, [
    el('span', { class: 'event-list-col-time' }, [fmtMs(ev.timeMs)]),
    el('span', { class: `event-list-col-type event-list-type-${ev.type}` }, [
      createElement(isKill ? Crosshair : Skull, { width: 11, height: 11 }),
      el('span', {}, [typeText]),
    ]),
    el('span', { class: 'event-list-col-player' }, [
      ev.playerName || '—',
    ]),
    el('span', { class: 'event-list-col-weapon' }, [weapon || '—']),
    el('span', { class: 'event-list-col-extra' }, [extras.join(' · ') || '']),
  ]);

  // Row click opens the player at this event's timestamp. The list modal
  // stays open behind the player (player z-index is higher).
  const openPlay = () => onPlay(ev.video, ev.playbackSeekMs);
  row.addEventListener('click', openPlay);
  row.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPlay(); }
  });
  return row;
}
