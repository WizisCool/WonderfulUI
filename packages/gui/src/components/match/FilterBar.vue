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
            <X :size="10" />
          </button>
        </div>
      </template>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, reactive } from 'vue';
import { X } from 'lucide-vue-next';
import DateRangePicker from './DateRangePicker.vue';
import {
  CATEGORY_KEYS, ADVANCED_RANGE_KEYS,
  type FilterState, type RangeKey,
} from '../../utils/filters.ts';
import { facetValueCounts, rangeBounds } from '../../utils/filter-engine.ts';
import type { MatchRecord } from '@wonderful-ui/parser';

const props = defineProps<{
  filters: FilterState;
  allMatches: MatchRecord[];
}>();

const emit = defineEmits<{
  update: [patch: Partial<FilterState>];
}>();

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
      const counts = facetValueCounts(props.allMatches, props.filters, 'videoTypes');
      if (props.filters.videoTypes.length === 0 && counts.size <= 1) return null;
    }
    const counts = facetValueCounts(props.allMatches, props.filters, key as any);
    const entries = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (entries.length === 0) return null;
    const selectedSet = new Set(props.filters[key]);
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
  const set = new Set(props.filters[key as keyof FilterState] as string[]);
  if (set.has(value)) set.delete(value);
  else set.add(value);
  emit('update', { [key]: [...set] } as any);
}

// Date
const dateModel = computed(() => props.filters.dateRange);

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
  const latest = latestMatchTime(props.allMatches);
  const day = 24 * 60 * 60 * 1000;
  const presets = [
    { label: '全部', range: [null, null] as [number | null, number | null] },
    { label: '近 7 天', range: [startOfDay(latest - 6 * day), latest] as [number | null, number | null] },
    { label: '近 30 天', range: [startOfDay(latest - 29 * day), latest] as [number | null, number | null] },
    { label: '本月', range: [startOfMonth(latest), latest] as [number | null, number | null] },
  ];
  return presets.map(p => ({
    ...p,
    active: (p.range[0] !== null || p.range[1] !== null) && sameRange(props.filters.dateRange, p.range),
  }));
});

function onDatePreset(preset: { range: [number | null, number | null] }) {
  emit('update', { dateRange: preset.range });
}

function onDateChange(range: [number | null, number | null]) {
  emit('update', { dateRange: range });
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
    const bounds = rangeBounds(props.allMatches, key as RangeKey);
    if (bounds[0] >= bounds[1]) return null;
    const [lo, hi] = props.filters[key];
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
  const bounds = rangeBounds(props.allMatches, key as RangeKey);
  const clampedLo = lo !== null ? Math.max(bounds[0], Math.min(lo, bounds[1])) : null;
  const clampedHi = hi !== null ? Math.max(bounds[0], Math.min(hi, bounds[1])) : null;
  const finalLo = clampedLo !== null && clampedLo <= bounds[0] ? null : clampedLo;
  const finalHi = clampedHi !== null && clampedHi >= bounds[1] ? null : clampedHi;
  emit('update', { [key]: [finalLo, finalHi] } as any);
}

function onNumInput(key: string, which: string, rawValue: string) {
  const kind = NUMERIC_KIND[key] ?? 'int';
  // Only update immediately for float; int/seconds/bytes update on blur
  if (kind === 'float') {
    const [lo, hi] = props.filters[key];
    const v = parseInputValue(kind, rawValue);
    if (which === 'lo') emitRange(key, v, hi);
    else emitRange(key, lo, v);
  }
  // For int, also update immediately
  if (kind === 'int') {
    const [lo, hi] = props.filters[key];
    const v = parseInputValue(kind, rawValue);
    if (which === 'lo') emitRange(key, v, hi);
    else emitRange(key, lo, v);
  }
}

function onNumBlur(key: string, which: string, rawValue: string) {
  const kind = NUMERIC_KIND[key] ?? 'int';
  const [lo, hi] = props.filters[key];
  const v = parseInputValue(kind, rawValue);
  if (which === 'lo') emitRange(key, v, hi);
  else emitRange(key, lo, v);
}

function onNumClear(key: string) {
  emit('update', { [key]: [null, null] } as any);
}
</script>

<style scoped></style>
