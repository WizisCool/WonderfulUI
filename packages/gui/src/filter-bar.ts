import type { MatchRecord } from '@wonderful-ui/parser';
import {
  FilterState, EMPTY_FILTERS, activeFilterCount, fmtRangeLabel,
  ADVANCED_RANGE_KEYS, CATEGORY_KEYS, RANGE_KEYS,
} from './filters.ts';
import { facetValueCounts, rangeBounds } from './filter-engine.ts';
import { createDateRangePicker } from './date-picker.ts';
import { createElement, X } from 'lucide';

// ─── el() helper (mirror of app.ts) ────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('data-') || k.startsWith('aria-') || k === 'role' || k === 'tabindex' || k === 'type' || k === 'placeholder' || k === 'title') {
      node.setAttribute(k, v);
    } else {
      (node as unknown as Record<string, unknown>)[k] = v;
    }
  }
  for (const c of children) node.append(c);
  return node;
}

// ─── category display names ────────────────────────────────

const CAT_LABELS: Record<string, string> = {
  heroes: '英雄', maps: '地图', modes: '模式',
  results: '胜负', achievements: '成就', videoTypes: '视频类型',
};
const RESULT_LABELS: Record<string, string> = { win: '胜', loss: '败' };
const ACHV_LABELS: Record<string, string> = { mvp: 'MVP', svp: 'SVP' };

// ─── category section ──────────────────────────────────────

function catSection(
  key: string,
  label: string,
  matches: MatchRecord[],
  filters: FilterState,
  selected: string[],
  onToggle: (v: string) => void,
): Node {
  const counts = facetValueCounts(matches, filters, key as any);
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (entries.length === 0) return document.createTextNode('');

  const selectedSet = new Set(selected);
  const chips = el('div', { class: 'filter-chips' });

  entries.forEach(([val, count], i) => {
    const display = key === 'results' ? (RESULT_LABELS[val] ?? val)
      : key === 'achievements' ? (ACHV_LABELS[val] ?? val)
      : val;
    const isActive = selectedSet.has(val);
    const chip = el('button', {
      class: `filter-chip ${isActive ? 'is-active' : ''}`,
      type: 'button',
      'data-value': val,
    }, [`${display} ${count}`]);
    chip.style.animationDelay = `${Math.min(i, 8) * 12}ms`;
    chips.append(chip);
  });

  chips.addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest('[data-value]') as HTMLElement | null;
    if (!btn) return;
    btn.classList.toggle('is-active');
    onToggle(btn.dataset.value!);
  });

  return el('div', { class: 'filter-section' }, [
    el('div', { class: 'filter-section-title' }, [label]),
    chips,
  ]);
}

// ─── dual slider ───────────────────────────────────────────

interface SliderState {
  curMin: number;
  curMax: number;
  min: number;
  max: number;
  step: number;
}

function fmtSliderDisplay(key: string, v: number): string {
  if (key === 'videoSize') {
    return v >= 1024 * 1024 * 1024
      ? `${(v / 1024 / 1024 / 1024).toFixed(1)}GB`
      : `${(v / 1024 / 1024).toFixed(1)}MB`;
  }
  if (key === 'matchDuration' || key === 'videoDuration') {
    const m = Math.floor(v / 60);
    const s = Math.round(v % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }
  if (NUMERIC_INT.has(key)) return String(Math.round(v));
  return v.toFixed(1);
}

function dualSliderCreate(
  parent: HTMLElement,
  st: SliderState,
  key: string,
  onChange: (min: number | null, max: number | null) => void,
): void {
  const { min, max, step, curMin, curMax } = st;
  if (min >= max) {
    parent.append(el('span', { class: 'filter-empty' }, ['—']));
    return;
  }

  let actualMin = curMin;
  let actualMax = curMax;

  const valMin = el('span', { class: 'filter-slider-val' }, [fmtSliderDisplay(key, actualMin)]);
  const track = el('div', { class: 'filter-slider' });
  const trackBg = el('div', { class: 'filter-slider-track' });
  const fill = el('div', { class: 'filter-slider-fill' });
  const thumbA = el('div', { class: 'filter-slider-thumb', role: 'slider', 'aria-label': '最小值', tabindex: '0' });
  const thumbB = el('div', { class: 'filter-slider-thumb', role: 'slider', 'aria-label': '最大值', tabindex: '0' });
  const bubbleA = el('div', { class: 'filter-slider-bubble' }, [fmtSliderDisplay(key, actualMin)]);
  const bubbleB = el('div', { class: 'filter-slider-bubble' }, [fmtSliderDisplay(key, actualMax)]);
  const valMax = el('span', { class: 'filter-slider-val' }, [fmtSliderDisplay(key, actualMax)]);

  track.append(trackBg, fill, thumbA, thumbB, bubbleA, bubbleB);
  parent.append(valMin, track, valMax);

  function posToVal(clientX: number): number {
    const rect = track.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const raw = min + pct * (max - min);
    return Math.round(raw / step) * step;
  }

  function updateDOM() {
    const pMin = ((actualMin - min) / (max - min)) * 100;
    const pMax = ((actualMax - min) / (max - min)) * 100;
    thumbA.style.left = `${pMin}%`;
    thumbB.style.left = `${pMax}%`;
    fill.style.left = `${pMin}%`;
    fill.style.width = `${pMax - pMin}%`;
    valMin.textContent = fmtSliderDisplay(key, actualMin);
    valMax.textContent = fmtSliderDisplay(key, actualMax);
    bubbleA.textContent = fmtSliderDisplay(key, actualMin);
    bubbleB.textContent = fmtSliderDisplay(key, actualMax);
  }

  let dragging: 'a' | 'b' | null = null;
  let activeBubble: 'a' | 'b' | null = null;

  function setDragging(which: 'a' | 'b' | null) {
    dragging = which;
    activeBubble = which;
    if (which) {
      track.classList.add('is-dragging');
      track.setAttribute('aria-valuenow', String(which === 'a' ? actualMin : actualMax));
    } else {
      track.classList.remove('is-dragging');
    }
  }

  function startDrag(which: 'a' | 'b', e: MouseEvent) {
    setDragging(which);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  }

  function onMove(e: MouseEvent) {
    if (!dragging) return;
    const v = posToVal(e.clientX);
    if (dragging === 'a') {
      actualMin = Math.max(min, Math.min(v, actualMax - step));
    } else {
      actualMax = Math.min(max, Math.max(v, actualMin + step));
    }
    updateDOM();
  }

  function onUp() {
    if (dragging) {
      const wasDragging = dragging;
      setDragging(null);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      onChange(
        actualMin <= min ? null : actualMin,
        actualMax >= max ? null : actualMax,
      );
    }
  }

  // Keyboard support: arrow keys nudge the active thumb by step;
  // Home/End snap to min/max. The thumbs already have tabindex=0
  // so they're reachable via Tab.
  function onThumbKey(which: 'a' | 'b', e: KeyboardEvent) {
    let handled = true;
    const isMin = which === 'a';
    let next = isMin ? actualMin : actualMax;
    const lower = isMin ? min : actualMin + step;
    const upper = isMin ? actualMax - step : max;
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        next = Math.max(lower, next - step);
        break;
      case 'ArrowRight':
      case 'ArrowUp':
        next = Math.min(upper, next + step);
        break;
      case 'PageDown':
        next = Math.max(lower, next - step * 10);
        break;
      case 'PageUp':
        next = Math.min(upper, next + step * 10);
        break;
      case 'Home':
        next = lower;
        break;
      case 'End':
        next = upper;
        break;
      default:
        handled = false;
    }
    if (!handled) return;
    e.preventDefault();
    if (isMin) actualMin = next;
    else actualMax = next;
    setDragging(which);
    updateDOM();
    // briefly show the bubble on keypress
    setTimeout(() => { if (!dragging) setDragging(null); }, 600);
    onChange(
      actualMin <= min ? null : actualMin,
      actualMax >= max ? null : actualMax,
    );
  }

  thumbA.addEventListener('mousedown', e => startDrag('a', e));
  thumbB.addEventListener('mousedown', e => startDrag('b', e));
  thumbA.addEventListener('keydown', e => onThumbKey('a', e));
  thumbB.addEventListener('keydown', e => onThumbKey('b', e));

  // double-click track to reset
  track.addEventListener('dblclick', () => {
    actualMin = min;
    actualMax = max;
    updateDOM();
    onChange(null, null);
  });

  updateDOM();
}

// ─── numeric row (compact min/max input pairs) ──────────────

const NUMERIC_LABELS: Record<string, string> = {
  kills: '击杀', deaths: '死亡', assists: '助攻', score: '得分',
  kda: 'KDA', kd: 'KD', roundsWon: '胜轮', roundsLost: '败轮',
  matchDuration: '时长', videoCount: '视频数', videoDuration: '视频总长',
  videoSize: '视频大小', gameLevel: '段位',
};

const NUMERIC_STEP: Record<string, number> = {
  kills: 1, deaths: 1, assists: 1, score: 50, kda: 0.1, kd: 0.1,
  roundsWon: 1, roundsLost: 1, matchDuration: 60, videoCount: 1,
  videoDuration: 60, videoSize: 1024 * 1024, dateRange: 3600 * 1000,
  gameLevel: 1,
};

const NUMERIC_INT = new Set(['kills', 'deaths', 'assists', 'score', 'roundsWon', 'roundsLost', 'videoCount', 'gameLevel']);

/** A numeric range can be one of:
 *  - 'int'     →  integer, shown as plain number
 *  - 'float'   →  decimal, shown with 1 decimal place
 *  - 'seconds' →  shown as m:ss (parse/format on blur)
 *  - 'bytes'   →  shown as MB/GB (parse/format on blur)
 */
type NumericKind = 'int' | 'float' | 'seconds' | 'bytes';

const NUMERIC_KIND: Record<string, NumericKind> = {
  kills: 'int', deaths: 'int', assists: 'int', score: 'int',
  kda: 'float', kd: 'float',
  roundsWon: 'int', roundsLost: 'int', gameLevel: 'int',
  matchDuration: 'seconds', videoDuration: 'seconds',
  videoCount: 'int', videoSize: 'bytes',
  dateRange: 'int',
};

function pad2(n: number): string { return String(Math.floor(n)).padStart(2, '0'); }

function fmtSeconds(v: number): string {
  const m = Math.floor(v / 60);
  const s = Math.round(v % 60);
  return `${m}:${pad2(s)}`;
}

function parseSeconds(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  // Accept "1:34" / "1:34:05" / "94" (raw seconds)
  if (t.includes(':')) {
    const parts = t.split(':').map(p => Number(p));
    if (parts.some(p => !Number.isFinite(p) || p < 0)) return null;
    if (parts.length === 2) {
      const m = parts[0] as number, sec = parts[1] as number;
      return m * 60 + sec;
    }
    if (parts.length === 3) {
      const h = parts[0] as number, m = parts[1] as number, sec = parts[2] as number;
      return h * 3600 + m * 60 + sec;
    }
    return null;
  }
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function fmtBytes(v: number): string {
  if (v >= 1024 * 1024 * 1024) return `${(v / 1024 / 1024 / 1024).toFixed(1)}GB`;
  return `${Math.round(v / 1024 / 1024)}MB`;
}

function parseBytes(s: string): number | null {
  const t = s.trim().toUpperCase();
  if (!t) return null;
  const m = t.match(/^([0-9]+(?:\.[0-9]+)?)\s*(KB|MB|GB|B)?$/);
  if (!m) {
    const n = Number(t);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  const value = Number(m[1]);
  const unit = m[2] ?? 'MB';
  if (!Number.isFinite(value) || value < 0) return null;
  if (unit === 'B')  return value;
  if (unit === 'KB') return value * 1024;
  if (unit === 'MB') return value * 1024 * 1024;
  if (unit === 'GB') return value * 1024 * 1024 * 1024;
  return null;
}

function fmtInputValue(kind: NumericKind, v: number): string {
  if (kind === 'seconds') return fmtSeconds(v);
  if (kind === 'bytes')   return fmtBytes(v);
  if (kind === 'float')   return v.toFixed(1);
  return String(Math.round(v));
}

function parseInputValue(kind: NumericKind, s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  if (kind === 'seconds') return parseSeconds(t);
  if (kind === 'bytes')   return parseBytes(t);
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** A compact min/max input pair replacing the old dual-handle slider.
 *  One row per filter, label on the left, two small inputs separated
 *  by a dash, × clear button on the right when active. */
function numericInputPairCreate(
  parent: HTMLElement,
  key: string,
  bounds: [number, number],
  current: [number | null, number | null],
  onChange: (min: number | null, max: number | null) => void,
): void {
  if (bounds[0] >= bounds[1]) return;
  const kind = NUMERIC_KIND[key] ?? 'int';
  const step = NUMERIC_STEP[key] ?? 1;
  const isFloat = kind === 'float';

  const row = el('div', { class: 'filter-num-row' });
  parent.append(row);

  const minInp = el('input', {
    class: 'filter-num-input',
    type: isFloat ? 'number' : (kind === 'int' ? 'number' : 'text'),
    step: isFloat ? '0.1' : '1',
    min: String(bounds[0]),
    max: String(bounds[1]),
    placeholder: fmtInputValue(kind, bounds[0]),
    'aria-label': '最小值',
    inputmode: isFloat ? 'decimal' : 'numeric',
  }) as HTMLInputElement;
  const sep = el('span', { class: 'filter-num-sep' }, ['–']);
  const maxInp = el('input', {
    class: 'filter-num-input',
    type: isFloat ? 'number' : (kind === 'int' ? 'number' : 'text'),
    step: isFloat ? '0.1' : '1',
    min: String(bounds[0]),
    max: String(bounds[1]),
    placeholder: fmtInputValue(kind, bounds[1]),
    'aria-label': '最大值',
    inputmode: isFloat ? 'decimal' : 'numeric',
  }) as HTMLInputElement;
  const clear = el('button', {
    class: 'filter-num-clear',
    type: 'button',
    'aria-label': '清除筛选',
    title: '清除',
  }, [createElement(X, { width: 10, height: 10 })]);

  // initial values
  if (current[0] !== null) minInp.value = fmtInputValue(kind, current[0]);
  if (current[1] !== null) maxInp.value = fmtInputValue(kind, current[1]);
  const isActive = current[0] !== null || current[1] !== null;
  if (isActive) row.classList.add('is-active');

  function emit() {
    const lo = minInp.value.trim() === '' ? null : parseInputValue(kind, minInp.value);
    const hi = maxInp.value.trim() === '' ? null : parseInputValue(kind, maxInp.value);
    // Clamp
    let clampedLo = lo, clampedHi = hi;
    if (clampedLo !== null) clampedLo = Math.max(bounds[0], Math.min(clampedLo, bounds[1]));
    if (clampedHi !== null) clampedHi = Math.max(bounds[0], Math.min(clampedHi, bounds[1]));
    if (clampedLo !== null && clampedHi !== null && clampedLo > clampedHi) {
      // swap so lo <= hi
      const tmp = clampedLo; clampedLo = clampedHi; clampedHi = tmp;
    }
    const isActiveNow = clampedLo !== null || clampedHi !== null;
    row.classList.toggle('is-active', isActiveNow);
    onChange(
      clampedLo !== null && clampedLo <= bounds[0] ? null : clampedLo,
      clampedHi !== null && clampedHi >= bounds[1] ? null : clampedHi,
    );
  }

  minInp.addEventListener('input', () => {
    if (kind === 'seconds' || kind === 'bytes') return;  // parse on blur
    emit();
  });
  maxInp.addEventListener('input', () => {
    if (kind === 'seconds' || kind === 'bytes') return;
    emit();
  });
  minInp.addEventListener('blur', () => {
    const v = parseInputValue(kind, minInp.value);
    if (v !== null) minInp.value = fmtInputValue(kind, v);
    emit();
  });
  maxInp.addEventListener('blur', () => {
    const v = parseInputValue(kind, maxInp.value);
    if (v !== null) maxInp.value = fmtInputValue(kind, v);
    emit();
  });
  minInp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); }
  });
  maxInp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); }
  });
  clear.addEventListener('click', () => {
    minInp.value = '';
    maxInp.value = '';
    row.classList.remove('is-active');
    onChange(null, null);
  });

  row.append(minInp, sep, maxInp, clear);
}

/** Build a single numeric filter row (label + input pair) or, for
 *  dateRange, a date picker trigger. */
function numericRow(
  key: string,
  label: string,
  matches: MatchRecord[],
  current: [number | null, number | null],
  onChange: (min: number | null, max: number | null) => void,
): HTMLElement | null {
  // dateRange uses the custom dark-theme range picker (different widget)
  if (key === 'dateRange') {
    const row = el('div', { class: 'filter-num-row filter-num-row--date' });
    const picker = createDateRangePicker(current, onChange);
    row.append(picker);
    return row;
  }

  const bounds = rangeBounds(matches, key as any);
  if (bounds[0] >= bounds[1]) return null;

  const row = el('div', { class: 'filter-num-row' });
  row.append(el('span', { class: 'filter-num-label' }, [label]));
  numericInputPairCreate(row, key, bounds, current, onChange);
  return row;
}

// ─── rail content builder ──────────────────────────────────

function latestMatchTime(matches: MatchRecord[]): number {
  let latest = 0;
  for (const m of matches) latest = Math.max(latest, m.matches_time || 0);
  return latest || Date.now();
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfMonth(ts: number): number {
  const d = new Date(ts);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function sameRange(a: [number | null, number | null], b: [number | null, number | null]): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function dateSection(
  matches: MatchRecord[],
  current: [number | null, number | null],
  onChange: (min: number | null, max: number | null) => void,
): HTMLElement {
  const latest = latestMatchTime(matches);
  const day = 24 * 60 * 60 * 1000;
  const presets: { label: string; range: [number | null, number | null] }[] = [
    { label: '全部', range: [null, null] },
    { label: '近 7 天', range: [startOfDay(latest - 6 * day), latest] },
    { label: '近 30 天', range: [startOfDay(latest - 29 * day), latest] },
    { label: '本月', range: [startOfMonth(latest), latest] },
  ];
  const chips = el('div', { class: 'filter-chips date-filter-presets' });
  for (const preset of presets) {
    const isActive = (preset.range[0] !== null || preset.range[1] !== null) && sameRange(current, preset.range);
    const chip = el('button', {
      class: `filter-chip ${isActive ? 'is-active' : ''}`,
      type: 'button',
    }, [preset.label]);
    chip.addEventListener('click', () => onChange(preset.range[0], preset.range[1]));
    chips.append(chip);
  }

  const custom = el('div', { class: 'date-filter-custom' });
  custom.append(createDateRangePicker(current, onChange));

  return el('div', { class: 'filter-section filter-section--date', 'data-filter-key': 'dateRange' }, [
    el('div', { class: 'filter-section-title' }, ['日期']),
    chips,
    custom,
  ]);
}

function shouldShowCategorySection(key: string, matches: MatchRecord[], filters: FilterState): boolean {
  if (key !== 'videoTypes') return true;
  return filters.videoTypes.length > 0 || facetValueCounts(matches, filters, 'videoTypes').size > 1;
}

/** Build the body: primary categorical/date filters + a compact advanced
 *  performance group for the few range filters users can reason about. */
function buildRailBody(
  allMatches: MatchRecord[],
  filters: FilterState,
  onUpdate: (patch: Partial<FilterState>) => void,
): HTMLElement {
  const body = el('div', { class: 'filter-rail-body' });

  // categorical sections
  for (const key of CATEGORY_KEYS) {
    if (!shouldShowCategorySection(key, allMatches, filters)) continue;
    const label = CAT_LABELS[key] ?? key;
    const section = catSection(key, label, allMatches, filters, filters[key], v => {
      const set = new Set(filters[key]);
      if (set.has(v)) set.delete(v);
      else set.add(v);
      onUpdate({ [key]: [...set] } as any);
    });
    if (section instanceof HTMLElement) {
      (section as HTMLElement).dataset.filterKey = key;
      body.append(section);
    }
  }

  body.append(dateSection(allMatches, filters.dateRange, (lo, hi) => {
    onUpdate({ dateRange: [lo, hi] });
  }));

  // Advanced group: hidden by default, limited to high-signal performance
  // filters. Keep low-signal archival/debug fields out of the default UI.
  const groupBody = el('div', { class: 'filter-num-group-body' });
  let activeCount = 0;
  for (const key of ADVANCED_RANGE_KEYS) {
    const label = NUMERIC_LABELS[key] ?? key;
    const [lo, hi] = filters[key];
    if (lo !== null || hi !== null) activeCount += 1;
    const row = numericRow(key, label, allMatches, filters[key], (nlo, nhi) => {
      onUpdate({ [key]: [nlo, nhi] } as any);
    });
    if (row) {
      (row as HTMLElement).dataset.filterKey = key;
      groupBody.append(row);
    }
  }
  if (groupBody.childNodes.length === 0) return body;

  let expanded = activeCount > 0;
  const headerBtn = el('button', {
    class: `filter-num-group-header ${activeCount > 0 ? 'is-active' : ''}`,
    type: 'button',
    'aria-expanded': String(expanded),
  });
  const headerTitle = el('span', { class: 'filter-num-group-title' }, ['表现筛选']);
  const headerCount = el('span', { class: 'filter-num-group-count' }, [
    activeCount > 0 ? String(activeCount) : '',
  ]);
  const headerChev = el('span', { class: 'filter-num-group-chevron' }, [expanded ? '▾' : '▸']);
  headerBtn.append(headerChev, headerTitle, headerCount);
  groupBody.classList.toggle('is-collapsed', !expanded);
  headerBtn.addEventListener('click', () => {
    expanded = !expanded;
    groupBody.classList.toggle('is-collapsed', !expanded);
    headerBtn.setAttribute('aria-expanded', String(expanded));
    headerChev.textContent = expanded ? '▾' : '▸';
  });

  const group = el('section', { class: 'filter-num-group' });
  group.append(headerBtn, groupBody);
  body.append(group);
  return body;
}

// ─── filter rail (replaces popover — lives in the panes grid) ─

export function createFilterRail(
  filters: FilterState,
  allMatches: MatchRecord[],
  scopeLabel: string,
  onUpdate: (patch: Partial<FilterState>) => void,
  onClose: () => void,
): HTMLElement {
  const activeN = activeFilterCount(filters);
  const rail = el('aside', {
    class: 'pane filter-rail',
    'aria-label': '筛选',
  });

  // head
  const head = el('div', { class: 'pane-head' });
  head.append(el('div', { class: 'filter-title-stack' }, [
    el('span', { class: 'pane-title' }, ['筛选']),
    el('span', { class: 'filter-scope' }, [`${scopeLabel}中生效`]),
  ]));
  const headRight = el('div', { class: 'pane-head-right' });
  if (activeN > 0) {
    headRight.append(el('span', { class: 'pane-sub' }, [`${activeN} 个`]));
  }
  const closeBtn = el('button', {
    class: 'filter-rail-close',
    type: 'button',
    'aria-label': '关闭筛选',
  }, [createElement(X, { width: 14, height: 14 })]);
  closeBtn.addEventListener('click', onClose);
  headRight.append(closeBtn);
  head.append(headRight);
  rail.append(head);

  // body
  const body = buildRailBody(allMatches, filters, onUpdate);
  rail.append(body);

  // footer: clear-all button
  if (activeN > 0) {
    const footer = el('div', { class: 'filter-rail-footer' });
    const clearBtn = el('button', {
      class: 'filter-rail-clear',
      type: 'button',
    }, ['清除全部筛选']);
    clearBtn.addEventListener('click', () => {
      onUpdate({ ...EMPTY_FILTERS, query: filters.query });
    });
    footer.append(clearBtn);
    rail.append(footer);
  }

  return rail;
}

// ─── applied filter chips (top of match list) ──────────────

/**
 * Build a chips row showing which filters are active. Rendered above
 * the match rows when filters are active.
 *
 * Each chip: label text + × button to clear that specific filter.
 * Clicking the label triggers `onFocusSection(key)` which scrolls the
 * corresponding section in the filter rail into view.
 */
export function buildAppliedChips(
  filters: FilterState,
  onClear: (key: string, value?: string) => void,
  onFocusSection: (key: string) => void,
): HTMLElement | null {
  const chips: { key: string; value?: string; label: string }[] = [];

  for (const key of CATEGORY_KEYS) {
    for (const v of filters[key]) {
      const label = key === 'results'
        ? (v === 'win' ? '胜' : v === 'loss' ? '败' : v)
        : key === 'achievements'
        ? (ACHV_LABELS[v] ?? v)
        : v;
      chips.push({ key, value: v, label });
    }
  }

  for (const key of RANGE_KEYS) {
    const [lo, hi] = filters[key];
    if (lo === null && hi === null) continue;
    chips.push({ key, label: fmtRangeLabel(key, lo, hi) });
  }

  if (filters.query.trim()) {
    chips.push({ key: 'query', label: `"${filters.query}"` });
  }

  if (chips.length === 0) return null;

  const row = el('div', { class: 'filter-applied' });
  for (const c of chips) {
    const chip = el('span', {
      class: 'filter-applied-chip',
      'data-filter-key': c.key,
      'data-filter-value': c.value ?? '',
    }, [c.label]);

    // label click → focus in rail
    chip.addEventListener('click', e => {
      if ((e.target as HTMLElement).closest('.filter-applied-clear')) return;
      onFocusSection(c.key);
    });

    // × button
    const clearBtn = el('button', {
      class: 'filter-applied-clear',
      type: 'button',
      'aria-label': `清除${c.label}`,
    }, [createElement(X, { width: 10, height: 10 })]);
    clearBtn.addEventListener('click', e => {
      e.stopPropagation();
      onClear(c.key, c.value);
    });
    chip.append(clearBtn);
    row.append(chip);
  }

  const clearAll = el('button', {
    class: 'filter-applied-clear-all',
    type: 'button',
  }, ['清除全部']);
  clearAll.addEventListener('click', () => {
    onClear('__all__');
  });
  row.append(clearAll);
  return row;
}
