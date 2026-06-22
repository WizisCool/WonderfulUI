<template>
  <template v-for="section in sections" :key="section.key">
    <div class="filter-section" :data-filter-key="section.key">
      <div class="filter-section-title">{{ section.label }}</div>
      <div class="filter-chips">
        <button
          v-for="(entry, i) in section.entries"
          :key="entry.value"
          class="filter-chip"
          :class="{ 'is-active': entry.active }"
          type="button"
          :data-value="entry.value"
          :style="{ animationDelay: `${Math.min(i, 8) * 12}ms` }"
          @click="onChipClick(section.key, entry.value)"
        >{{ entry.display }} {{ entry.count }}</button>
      </div>
    </div>
  </template>

  <div class="filter-section filter-section--date" data-filter-key="dateRange">
    <div class="filter-section-title">日期</div>
    <div class="filter-chips date-filter-presets">
      <button
        v-for="preset in datePresets"
        :key="preset.label"
        class="filter-chip"
        :class="{ 'is-active': preset.active }"
        type="button"
        @click="onDatePreset(preset)"
      >{{ preset.label }}</button>
    </div>
    <div class="date-filter-custom">
      <DateRangePicker
        :model-value="dateModel"
        @update:model-value="onDateChange"
      />
    </div>
  </div>

  <section v-if="advancedRows.length > 0" class="filter-num-group">
    <button
      class="filter-num-group-header"
      :class="{ 'is-active': advancedActiveCount > 0 }"
      type="button"
      :aria-expanded="String(advancedExpanded)"
      @click="advancedExpanded = !advancedExpanded"
    >
      <span class="filter-num-group-chevron">{{ advancedExpanded ? '▾' : '▸' }}</span>
      <span class="filter-num-group-title">表现筛选</span>
      <span class="filter-num-group-count">{{ advancedActiveCount > 0 ? advancedActiveCount : '' }}</span>
    </button>
    <div class="filter-num-group-body" :class="{ 'is-collapsed': !advancedExpanded }">
      <template v-for="row in advancedRows" :key="row.key">
        <div class="filter-num-row" :data-filter-key="row.key" :class="{ 'is-active': row.active }">
          <span class="filter-num-label">{{ row.label }}</span>
          <input
            class="filter-num-input"
            :type="row.isFloat ? 'number' : (row.isSeconds || row.isBytes ? 'text' : 'number')"
            :step="row.isFloat ? '0.1' : '1'"
            :min="String(row.bounds[0])"
            :max="String(row.bounds[1])"
            :placeholder="row.placeholderLo"
            aria-label="最小值"
            :inputmode="row.isFloat ? 'decimal' : 'numeric'"
            :value="row.loStr"
            @input="onNumInput(row.key, 'lo', ($event.target as HTMLInputElement).value)"
            @blur="onNumBlur(row.key, 'lo', ($event.target as HTMLInputElement).value)"
            @keydown.enter="($event.target as HTMLInputElement).blur()"
          />
          <span class="filter-num-sep">–</span>
          <input
            class="filter-num-input"
            :type="row.isFloat ? 'number' : (row.isSeconds || row.isBytes ? 'text' : 'number')"
            :step="row.isFloat ? '0.1' : '1'"
            :min="String(row.bounds[0])"
            :max="String(row.bounds[1])"
            :placeholder="row.placeholderHi"
            aria-label="最大值"
            :inputmode="row.isFloat ? 'decimal' : 'numeric'"
            :value="row.hiStr"
            @input="onNumInput(row.key, 'hi', ($event.target as HTMLInputElement).value)"
            @blur="onNumBlur(row.key, 'hi', ($event.target as HTMLInputElement).value)"
            @keydown.enter="($event.target as HTMLInputElement).blur()"
          />
          <button
            class="filter-num-clear"
            type="button"
            aria-label="清除筛选"
            title="清除"
            @click="onNumClear(row.key)"
          >
            <WIcon icon="ph:x" :size="10" />
          </button>
        </div>
      </template>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import WIcon from '../common/WIcon.vue';
import DateRangePicker from './DateRangePicker.vue';
import {
  CATEGORY_KEYS, ADVANCED_RANGE_KEYS,
  type FilterState, type RangeKey,
} from '../../utils/filters.ts';
import { facetValueCounts, rangeBounds } from '../../utils/filter-engine.ts';
import type { MatchRecord } from '@wonderful-ui/parser';
import { useFilterStore } from '../../stores/filter.ts';
import { useAccountStore, ALL_ACCOUNTS } from '../../stores/account.ts';

const filterStore = useFilterStore();
const account = useAccountStore();

const allMatches = computed(() => {
  const openid = account.selectedAccountId;
  if (!openid || openid === ALL_ACCOUNTS) return account.matches;
  return account.matches.filter(m => m.openID === openid);
});

const advancedExpanded = ref(false);

const CAT_LABELS: Record<string, string> = {
  heroes: '英雄', maps: '地图', modes: '模式',
  results: '胜负', achievements: '成就', videoTypes: '视频类型',
};
const RESULT_LABELS: Record<string, string> = { win: '胜', loss: '败' };
const ACHV_LABELS: Record<string, string> = { mvp: 'MVP', svp: 'SVP' };

const NUMERIC_LABELS: Record<string, string> = {
  kills: '击杀', kda: 'KDA', videoCount: '视频数',
};

const sections = computed(() => {
  return CATEGORY_KEYS.map(key => {
    if (key === 'videoTypes') {
      const counts = facetValueCounts(allMatches.value, filterStore.filters, 'videoTypes');
      if (filterStore.filters.videoTypes.length === 0 && counts.size <= 1) return null;
    }
    const counts = facetValueCounts(allMatches.value, filterStore.filters, key as any);
    const entries = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (entries.length === 0) return null;
    const selectedSet = new Set(filterStore.filters[key]);
    return {
      key,
      label: CAT_LABELS[key] ?? key,
      entries: entries.map(([val, count]) => ({
        value: val,
        count,
        active: selectedSet.has(val),
        display: key === 'results' ? (RESULT_LABELS[val] ?? val)
          : key === 'achievements' ? (ACHV_LABELS[val] ?? val)
          : val,
      })),
    };
  }).filter(Boolean) as Array<{
    key: string;
    label: string;
    entries: Array<{ value: string; count: number; active: boolean; display: string }>;
  }>;
});

function onChipClick(key: string, value: string) {
  const set = new Set(filterStore.filters[key as keyof FilterState] as string[]);
  if (set.has(value)) set.delete(value);
  else set.add(value);
  filterStore.setFilters( { [key]: [...set] } as any);
}

// Date
const dateModel = computed(() => filterStore.filters.dateRange);

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

const datePresets = computed(() => {
  const latest = latestMatchTime(allMatches.value);
  const day = 24 * 60 * 60 * 1000;
  const presets = [
    { label: '全部', range: [null, null] as [number | null, number | null] },
    { label: '近 7 天', range: [startOfDay(latest - 6 * day), latest] as [number | null, number | null] },
    { label: '近 30 天', range: [startOfDay(latest - 29 * day), latest] as [number | null, number | null] },
    { label: '本月', range: [startOfMonth(latest), latest] as [number | null, number | null] },
  ];
  return presets.map(p => ({
    ...p,
    active: (p.range[0] !== null || p.range[1] !== null) && sameRange(filterStore.filters.dateRange, p.range),
  }));
});

function onDatePreset(preset: { range: [number | null, number | null] }) {
  filterStore.setFilters( { dateRange: preset.range });
}

function onDateChange(range: [number | null, number | null]) {
  filterStore.setFilters( { dateRange: range });
}

// Numeric helpers
const NUMERIC_KIND: Record<string, string> = {
  kills: 'int', kda: 'float', videoCount: 'int',
};

function fmtInputValue(kind: string, v: number): string {
  if (kind === 'float') return v.toFixed(1);
  return String(Math.round(v));
}

function parseInputValue(kind: string, s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const advancedRows = computed(() => {
  return ADVANCED_RANGE_KEYS.map(key => {
    const bounds = rangeBounds(allMatches.value, key as RangeKey);
    if (bounds[0] >= bounds[1]) return null;
    const [lo, hi] = filterStore.filters[key];
    const kind = NUMERIC_KIND[key] ?? 'int';
    const isFloat = kind === 'float';
    return {
      key,
      label: NUMERIC_LABELS[key] ?? key,
      bounds,
      active: lo !== null || hi !== null,
      isFloat,
      isSeconds: false,
      isBytes: false,
      loStr: lo !== null ? fmtInputValue(kind, lo) : '',
      hiStr: hi !== null ? fmtInputValue(kind, hi) : '',
      placeholderLo: fmtInputValue(kind, bounds[0]),
      placeholderHi: fmtInputValue(kind, bounds[1]),
    };
  }).filter(Boolean) as Array<{
    key: string;
    label: string;
    bounds: [number, number];
    active: boolean;
    isFloat: boolean;
    isSeconds: boolean;
    isBytes: boolean;
    loStr: string;
    hiStr: string;
    placeholderLo: string;
    placeholderHi: string;
  }>;
});

const advancedActiveCount = computed(() =>
  advancedRows.value.filter(r => r.active).length
);

function emitRange(key: string, lo: number | null, hi: number | null) {
  const bounds = rangeBounds(allMatches.value, key as RangeKey);
  const clampedLo = lo !== null ? Math.max(bounds[0], Math.min(lo, bounds[1])) : null;
  const clampedHi = hi !== null ? Math.max(bounds[0], Math.min(hi, bounds[1])) : null;
  const finalLo = clampedLo !== null && clampedLo <= bounds[0] ? null : clampedLo;
  const finalHi = clampedHi !== null && clampedHi >= bounds[1] ? null : clampedHi;
  filterStore.setFilters( { [key]: [finalLo, finalHi] } as any);
}

function onNumInput(key: string, which: string, rawValue: string) {
  const kind = NUMERIC_KIND[key] ?? 'int';
  // Only update immediately for float; int/seconds/bytes update on blur
  if (kind === 'float') {
    const [lo, hi] = filterStore.filters[key];
    const v = parseInputValue(kind, rawValue);
    if (which === 'lo') emitRange(key, v, hi);
    else emitRange(key, lo, v);
  }
  // For int, also update immediately
  if (kind === 'int') {
    const [lo, hi] = filterStore.filters[key];
    const v = parseInputValue(kind, rawValue);
    if (which === 'lo') emitRange(key, v, hi);
    else emitRange(key, lo, v);
  }
}

function onNumBlur(key: string, which: string, rawValue: string) {
  const kind = NUMERIC_KIND[key] ?? 'int';
  const [lo, hi] = filterStore.filters[key];
  const v = parseInputValue(kind, rawValue);
  if (which === 'lo') emitRange(key, v, hi);
  else emitRange(key, lo, v);
}

function onNumClear(key: string) {
  filterStore.setFilters( { [key]: [null, null] } as any);
}
</script>

<style scoped>
.filter-section {
  display: flex; flex-direction: column; gap: 4px;
  padding-top: 8px;
}
.filter-section + .filter-section {
  border-top: 1px solid var(--border-soft);
  padding-top: 10px;
}
.filter-section-title {
  font-size: 11px; font-weight: var(--w-semibold);
  color: var(--ink-3); font-family: var(--font-sans);
}
.filter-chips {
  display: flex; flex-wrap: wrap; gap: 4px;
}
.filter-chip {
  font-size: 11px; padding: 2px 8px;
  border-radius: 999px;
  background: var(--surface-3);
  border: 1px solid var(--border-soft);
  color: var(--ink-2);
  font-family: var(--font-sans);
  cursor: pointer;
  transition:
    background 100ms ease-out,
    border-color 100ms ease-out,
    color 100ms ease-out,
    transform 120ms cubic-bezier(0.16, 1, 0.3, 1);
  animation: filter-chip-in 140ms cubic-bezier(0.16, 1, 0.3, 1) both;
}
@keyframes filter-chip-in {
  from { opacity: 0.55; transform: translateY(3px); }
  to   { opacity: 1; transform: translateY(0); }
}
.filter-chip:hover {
  color: var(--ink);
  border-color: var(--ink-4);
  transform: translateY(-1px);
}
.filter-chip:active { transform: translateY(0) scale(0.96); }
.filter-chip.is-active {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}
.filter-chip.is-active:hover {
  background: var(--accent-soft);
  color: var(--accent-hi);
  border-color: var(--accent-hi);
}
.filter-section--date {
  gap: 6px;
}
.date-filter-presets {
  gap: 5px;
}
.date-filter-custom {
  padding-top: 2px;
}

/* numeric filters */
.filter-numerics {
  display: flex; flex-direction: column; gap: 8px;
  border-top: 1px solid var(--border-soft);
  padding-top: 8px;
}
.filter-num-row {
  display: flex; align-items: center;
  gap: 5px;
  min-width: 0;
  position: relative;
}
.filter-num-row--date {
  display: block;
}
.filter-num-label {
  font-size: 11px;
  color: var(--ink-3);
  font-family: var(--font-sans);
  white-space: nowrap;
  flex-shrink: 0;
  width: 32px;
  text-align: right;
}
.filter-num-input {
  flex: 1; min-width: 0;
  background: var(--bg);
  border: 1px solid var(--border-soft);
  border-radius: 4px;
  padding: 3px 5px;
  color: var(--ink-3);
  font: inherit;
  font-family: var(--font-mono);
  font-size: 10.5px;
  text-align: center;
  outline: none;
  transition: border-color 100ms ease-out, color 100ms ease-out, background 100ms ease-out;
  -moz-appearance: textfield;
}
.filter-num-input::-webkit-outer-spin-button,
.filter-num-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.filter-num-input::placeholder {
  color: var(--ink-4);
  font-weight: var(--w-medium);
}
.filter-num-input:hover {
  border-color: var(--ink-4);
  color: var(--ink-2);
}
.filter-num-input:focus {
  border-color: var(--accent);
  color: var(--ink);
  background: var(--surface-3);
}
.filter-num-row.is-active .filter-num-input {
  color: var(--ink);
  border-color: var(--accent);
  background: var(--surface-2);
}
.filter-num-row.is-active .filter-num-input:focus {
  border-color: var(--accent);
  background: var(--surface-3);
}
.filter-num-sep {
  color: var(--ink-4);
  font-family: var(--font-mono);
  font-size: 10px;
  flex-shrink: 0;
  user-select: none;
}
.filter-num-clear {
  display: inline-flex; align-items: center; justify-content: center;
  width: 16px; height: 16px;
  background: transparent;
  border: 0;
  padding: 0;
  color: var(--ink-3);
  border-radius: 3px;
  cursor: pointer;
  flex-shrink: 0;
  opacity: 0;
  pointer-events: none;
  transition: background 100ms ease-out, color 100ms ease-out, opacity 120ms ease-out;
}
.filter-num-row.is-active .filter-num-clear {
  opacity: 1;
  pointer-events: auto;
}
.filter-num-clear:hover {
  background: var(--accent-soft);
  color: var(--accent);
}

.filter-num-group {
  display: flex; flex-direction: column;
  border-top: 1px solid var(--border-soft);
  padding-top: 6px;
  margin-top: 4px;
}
.filter-num-group-header {
  display: flex; align-items: center; gap: 6px;
  width: 100%;
  background: transparent;
  border: 0;
  padding: 6px 0 6px;
  cursor: pointer;
  color: var(--ink-3);
  font: inherit;
  font-size: 11px;
  font-weight: var(--w-semibold);
  text-align: left;
  border-radius: 4px;
  transition: color 100ms ease-out, background 100ms ease-out;
}
.filter-num-group-header:hover { color: var(--ink-2); }
.filter-num-group-header:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
.filter-num-group-chevron {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--ink-4);
  width: 10px;
  display: inline-block;
  transition: color 100ms ease-out;
}
.filter-num-group-header:hover .filter-num-group-chevron { color: var(--ink-2); }
.filter-num-group-title {
  flex: 1;
}
.filter-num-group-count {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--ink-3);
  background: var(--surface-3);
  border-radius: 999px;
  padding: 0 5px;
  min-width: 14px;
  text-align: center;
  line-height: 14px;
}
.filter-num-group-header.is-active .filter-num-group-count {
  color: var(--accent);
  background: var(--accent-soft);
}
.filter-num-group-body {
  display: flex; flex-direction: column;
  gap: 4px;
  padding-top: 4px;
  max-height: 160px;
  overflow: hidden;
  transition: max-height 240ms cubic-bezier(0.16, 1, 0.3, 1), opacity 200ms ease-out;
  opacity: 1;
}
.filter-num-group-body.is-collapsed {
  max-height: 0;
  opacity: 0;
  padding-top: 0;
}

.filter-empty {
  text-align: center; padding: 8px;
  color: var(--ink-3); font-size: 12px;
}

/* filter applied chips */
.filter-applied {
  display: flex; flex-wrap: wrap; align-items: center;
  gap: 6px;
  padding: 8px var(--pad);
  border-bottom: 1px solid var(--border-soft);
  background: var(--surface);
  animation: filter-applied-in 120ms cubic-bezier(0.16, 1, 0.3, 1) both;
}
@keyframes filter-applied-in {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}
.filter-applied-chip {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11px; color: var(--ink-2);
  background: var(--surface-2);
  border: 1px solid var(--border-soft);
  border-radius: 999px;
  padding: 2px 6px 2px 9px;
  cursor: pointer;
  font-family: var(--font-sans);
  transition: background 100ms ease-out, border-color 100ms ease-out, color 100ms ease-out;
}
.filter-applied-chip:hover {
  background: var(--surface-3);
  border-color: var(--ink-4);
  color: var(--ink);
}
.filter-applied-clear {
  display: inline-flex; align-items: center; justify-content: center;
  width: 14px; height: 14px;
  background: transparent;
  border: 0;
  border-radius: 3px;
  color: var(--ink-3);
  cursor: pointer;
  padding: 0;
  transition: background 100ms ease-out, color 100ms ease-out;
}
.filter-applied-clear:hover {
  background: var(--accent-soft);
  color: var(--accent);
}
.filter-applied-chip.is-active {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}
.filter-applied-chip.is-active .filter-applied-clear {
  color: var(--accent);
}
.filter-applied-chip.is-active .filter-applied-clear:hover {
  background: var(--accent);
  color: var(--accent-ink);
}
.filter-applied-clear-all {
  font-size: 11px; color: var(--ink-3);
  background: transparent; border: 0;
  cursor: pointer;
  font-family: var(--font-sans);
  padding: 2px 6px;
  transition: color 100ms ease-out;
}
.filter-applied-clear-all:hover { color: var(--accent); }
</style>
