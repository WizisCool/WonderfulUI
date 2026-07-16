/**
 * pure functions for filter state, matching, and persistence.
 *
 * Map/agent labels & image URLs are dispatched only via valorant-assets.ts
 * (resolveMatch*). Re-exports keep existing import sites stable.
 */
import type { MatchRecord } from '@wonderful-ui/parser';
import { parseAclLocalTime } from './event-state-machine.ts';
import {
  lookupMapAsset,
  resolveMatchAgentLabel,
  resolveMatchHeroImage,
  resolveMatchMapImage,
  resolveMatchMapLabel,
} from './valorant-assets.ts';

// ─── display-name helpers ─────────────────────────────────

export function fmtMap(mapId: string): string {
  const asset = lookupMapAsset(mapId);
  if (asset) return asset.cn;
  const parts = mapId.split('/');
  return parts[parts.length - 1] ?? mapId;
}

export function agentCn(m: MatchRecord): string {
  return resolveMatchAgentLabel(m);
}

export function mapCn(m: MatchRecord): string {
  return resolveMatchMapLabel(m);
}

/** Remote map cover URL (career → table). Prefer resolveMatchMapImage in new code. */
export function mapImageUrl(m: MatchRecord): string | undefined {
  return resolveMatchMapImage(m);
}

/** Remote hero portrait URL (career → table). Prefer resolveMatchHeroImage in new code. */
export function heroImageUrl(m: MatchRecord): string | undefined {
  return resolveMatchHeroImage(m);
}

export function modeCn(m: MatchRecord): string {
  return (m.career?.game_mode as string) || '';
}

export function fmtScore(m: MatchRecord): string {
  return `${m.stats.rounds_won}:${m.stats.rounds_lost}`;
}

export function fmtLevel(m: MatchRecord): string {
  const lv = m.stats.game_level;
  if (!lv) return '';
  return `Lv.${lv}`;
}

export function kdaRatio(m: MatchRecord): string {
  const d = m.stats.deaths || 1;
  return ((m.stats.kills + m.stats.assists) / d).toFixed(2);
}

function aclWallClockMs(value: string): number | undefined {
  // Prefer the same ACL local parser as the event state machine. Fall back to
  // Date only for odd fixtures (e.g. trailing Z) that still parse in WebView2.
  const parsed = parseAclLocalTime(value);
  if (parsed !== undefined) return parsed;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : undefined;
}

export function fmtMatchDuration(m: MatchRecord): string {
  const start = m.gameStartTime, end = m.gameEndTime;
  if (!start || !end) return '';
  const s = aclWallClockMs(start);
  const e = aclWallClockMs(end);
  if (s === undefined || e === undefined || e <= s) return '';
  const total = Math.round((e - s) / 1000);
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min}:${String(sec).padStart(2, '0')}`;
}

// ─── derived numeric helpers (WeakMap-cached) ──────────────

const _kda = new WeakMap<MatchRecord, number>();
const _kd = new WeakMap<MatchRecord, number>();
const _dur = new WeakMap<MatchRecord, number>();
const _vdur = new WeakMap<MatchRecord, number>();
const _vsize = new WeakMap<MatchRecord, number>();

export function kdaOf(m: MatchRecord): number {
  let v = _kda.get(m);
  if (v === undefined) {
    v = (m.stats.kills + m.stats.assists) / Math.max(m.stats.deaths, 1);
    _kda.set(m, v);
  }
  return v;
}

export function kdOf(m: MatchRecord): number {
  let v = _kd.get(m);
  if (v === undefined) {
    v = m.stats.kills / Math.max(m.stats.deaths, 1);
    _kd.set(m, v);
  }
  return v;
}

export function matchDurationSec(m: MatchRecord): number {
  let v = _dur.get(m);
  if (v === undefined) {
    const s = m.gameStartTime, e = m.gameEndTime;
    if (s && e) {
      const startMs = aclWallClockMs(s);
      const endMs = aclWallClockMs(e);
      if (startMs !== undefined && endMs !== undefined && endMs > startMs) {
        v = Math.round((endMs - startMs) / 1000);
      } else {
        v = 0;
      }
    } else {
      v = 0;
    }
    _dur.set(m, v);
  }
  return v;
}

export function videoTotalDuration(m: MatchRecord): number {
  let v = _vdur.get(m);
  if (v === undefined) {
    v = m.videos.reduce((sum, vid) => sum + (vid.video_duration || 0), 0);
    _vdur.set(m, v);
  }
  return v;
}

export function videoTotalSize(m: MatchRecord): number {
  let v = _vsize.get(m);
  if (v === undefined) {
    v = m.videos.reduce((sum, vid) => sum + (vid.video_size || 0), 0);
    _vsize.set(m, v);
  }
  return v;
}

// ─── filter state ──────────────────────────────────────────

export interface FilterState {
  heroes: string[];
  maps: string[];
  modes: string[];
  results: ('win' | 'loss')[];
  achievements: ('mvp' | 'svp')[];
  videoTypes: string[];
  kills: [number | null, number | null];
  deaths: [number | null, number | null];
  assists: [number | null, number | null];
  score: [number | null, number | null];
  kda: [number | null, number | null];
  kd: [number | null, number | null];
  roundsWon: [number | null, number | null];
  roundsLost: [number | null, number | null];
  matchDuration: [number | null, number | null];
  videoCount: [number | null, number | null];
  videoDuration: [number | null, number | null];
  videoSize: [number | null, number | null];
  dateRange: [number | null, number | null];
  gameLevel: [number | null, number | null];
  query: string;
}

function emptyRange(): [number | null, number | null] { return [null, null]; }

export const EMPTY_FILTERS: FilterState = {
  heroes: [],
  maps: [],
  modes: [],
  results: [],
  achievements: [],
  videoTypes: [],
  kills: emptyRange(),
  deaths: emptyRange(),
  assists: emptyRange(),
  score: emptyRange(),
  kda: emptyRange(),
  kd: emptyRange(),
  roundsWon: emptyRange(),
  roundsLost: emptyRange(),
  matchDuration: emptyRange(),
  videoCount: emptyRange(),
  videoDuration: emptyRange(),
  videoSize: emptyRange(),
  dateRange: emptyRange(),
  gameLevel: emptyRange(),
  query: '',
};

// ─── range helpers ─────────────────────────────────────────

export const CATEGORY_KEYS = ['heroes', 'maps', 'modes', 'results', 'achievements', 'videoTypes'] as const;
export const RANGE_KEYS = ['kills', 'deaths', 'assists', 'score', 'kda', 'kd',
  'roundsWon', 'roundsLost', 'matchDuration', 'videoCount',
  'videoDuration', 'videoSize', 'dateRange', 'gameLevel'] as const;

export type CategoryKey = (typeof CATEGORY_KEYS)[number];
export type RangeKey = (typeof RANGE_KEYS)[number];

export const PRIMARY_RANGE_KEYS = ['dateRange'] as const satisfies readonly RangeKey[];
export const ADVANCED_RANGE_KEYS = ['kills', 'kda', 'videoCount'] as const satisfies readonly RangeKey[];
export const VISIBLE_RANGE_KEYS = [...PRIMARY_RANGE_KEYS, ...ADVANCED_RANGE_KEYS] as const satisfies readonly RangeKey[];

export const RANGE_GETTERS: Record<RangeKey, (m: MatchRecord) => number> = {
  kills: m => m.stats.kills,
  deaths: m => m.stats.deaths,
  assists: m => m.stats.assists,
  score: m => m.stats.score,
  kda: kdaOf,
  kd: kdOf,
  roundsWon: m => m.stats.rounds_won,
  roundsLost: m => m.stats.rounds_lost,
  matchDuration: matchDurationSec,
  videoCount: m => m.videos.length,
  videoDuration: videoTotalDuration,
  videoSize: videoTotalSize,
  dateRange: m => m.matches_time,
  gameLevel: m => parseInt(m.stats.game_level, 10) || 0,
};

export const CATEGORY_GETTERS: Record<CategoryKey, (m: MatchRecord) => string[]> = {
  heroes: m => [agentCn(m), m.agent.agent_name],
  maps: m => [mapCn(m), m.map.map_id],
  modes: m => [modeCn(m), m.mode],
  results: m => [m.stats.has_won ? 'win' : 'loss'],
  achievements: m => {
    const t = (m as unknown as Record<string, unknown>)._achvType as string | undefined;
    return t ? [t] : [];
  },
  videoTypes: m => m.videos.map(v => v.video_type),
};

// ─── chip label helpers ─────────────────────────────────────

const RANGE_LABELS: Record<string, string> = {
  kills: '击杀', deaths: '死亡', assists: '助攻', score: '得分',
  kda: 'KDA', kd: 'KD', roundsWon: '胜轮', roundsLost: '败轮',
  matchDuration: '时长', videoCount: '视频数', videoDuration: '视频总长',
  videoSize: '视频大小', dateRange: '日期', gameLevel: '段位',
};

function pad2(n: number): string { return String(n).padStart(2, '0'); }

function fmtDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Convert a range filter's [lo, hi] into a compact chip label
 *  like "2 – 32" / "≥ 2.3" / "2024-10-12 – 2024-12-18". */
export function fmtRangeLabel(key: string, lo: number | null, hi: number | null): string {
  const durFmt = (v: number) => {
    const m = Math.floor(v / 60);
    const s = Math.round(v % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };
  const sizeFmt = (v: number) => v >= 1024 * 1024 * 1024
    ? `${(v / 1024 / 1024 / 1024).toFixed(1)}GB`
    : `${(v / 1024 / 1024).toFixed(0)}MB`;
  const numFmt = (v: number) => Number.isInteger(v) ? String(Math.round(v)) : v.toFixed(1);

  if (key === 'dateRange') {
    if (lo != null && hi != null) return `${fmtDate(lo)} – ${fmtDate(hi)}`;
    if (lo != null) return `从 ${fmtDate(lo)}`;
    if (hi != null) return `至 ${fmtDate(hi)}`;
    return '日期';
  }
  if (key === 'matchDuration' || key === 'videoDuration') {
    if (lo != null && hi != null) return `${durFmt(lo)} – ${durFmt(hi)}`;
    if (lo != null) return `≥ ${durFmt(lo)}`;
    if (hi != null) return `≤ ${durFmt(hi)}`;
    return RANGE_LABELS[key] ?? key;
  }
  if (key === 'videoSize') {
    if (lo != null && hi != null) return `${sizeFmt(lo)} – ${sizeFmt(hi)}`;
    if (lo != null) return `≥ ${sizeFmt(lo)}`;
    if (hi != null) return `≤ ${sizeFmt(hi)}`;
    return RANGE_LABELS[key] ?? key;
  }
  if (lo != null && hi != null) return `${numFmt(lo)} – ${numFmt(hi)}`;
  if (lo != null) return `≥ ${numFmt(lo)}`;
  if (hi != null) return `≤ ${numFmt(hi)}`;
  return '';
}

// ─── active filter display ─────────────────────────────────

export function activeFilterCount(fs: FilterState): number {
  let n = 0;
  for (const key of CATEGORY_KEYS) { n += fs[key].length; }
  for (const key of RANGE_KEYS) {
    const [lo, hi] = fs[key];
    if (lo !== null || hi !== null) n += 1;
  }
  if (fs.query.trim()) n += 1;
  return n;
}

export function activeFilterSummary(fs: FilterState): string {
  const parts: string[] = [];
  for (const key of CATEGORY_KEYS) {
    if (fs[key].length) parts.push(...fs[key]);
  }
  for (const key of RANGE_KEYS) {
    const [lo, hi] = fs[key];
    if (lo !== null || hi !== null) parts.push(fmtRangeLabel(key, lo, hi));
  }
  if (fs.query.trim()) parts.push(fs.query.trim());
  return parts.join(' · ');
}

export function normalizeVisibleFilters(fs: FilterState): FilterState {
  let next = fs;
  const visible = new Set<RangeKey>(VISIBLE_RANGE_KEYS);
  for (const key of RANGE_KEYS) {
    if (visible.has(key)) continue;
    const [lo, hi] = next[key];
    if (lo !== null || hi !== null) {
      next = { ...next, [key]: emptyRange() };
    }
  }
  return next;
}

// ─── persistence ───────────────────────────────────────────

const LS_KEY = 'wui:filters.v1';
const LS_OPEN = 'wui:filters.open';

export function loadFilters(): FilterState {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...EMPTY_FILTERS };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...EMPTY_FILTERS };
    const fs: FilterState = { ...EMPTY_FILTERS };
    for (const key of CATEGORY_KEYS) {
      if (Array.isArray(parsed[key])) fs[key] = parsed[key];
    }
    for (const key of RANGE_KEYS) {
      if (Array.isArray(parsed[key]) && parsed[key].length === 2) {
        fs[key] = [
          parsed[key][0] != null ? Number(parsed[key][0]) : null,
          parsed[key][1] != null ? Number(parsed[key][1]) : null,
        ];
      }
    }
    if (typeof parsed.query === 'string') fs.query = parsed.query;
    return fs;
  } catch {
    return { ...EMPTY_FILTERS };
  }
}

export function saveFilters(fs: FilterState): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(fs));
  } catch { /* quota exceeded — silent */ }
}

export function loadOpen(): boolean {
  try {
    const raw = localStorage.getItem(LS_OPEN);
    if (raw == null) return false;  // default closed for new users
    return raw === '1';
  } catch { return false; }
}

export function saveOpen(v: boolean): void {
  try {
    localStorage.setItem(LS_OPEN, v ? '1' : '0');
  } catch { /* silent */ }
}
