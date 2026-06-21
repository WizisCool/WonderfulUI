import type { MatchRecord } from '@wonderful-ui/parser';
import Fuse from 'fuse.js';
import {
  createTable,
  getCoreRowModel,
  getFilteredRowModel,
  type ColumnDef,
  type ColumnFiltersState,
  type FilterFn,
} from '@tanstack/table-core';
import {
  CATEGORY_GETTERS,
  CATEGORY_KEYS,
  RANGE_GETTERS,
  RANGE_KEYS,
  type CategoryKey,
  type FilterState,
  type RangeKey,
} from './filters';

const categoryFilter: FilterFn<MatchRecord> = (row, columnId, selected: string[]) => {
  if (!selected.length) return true;
  const values = row.getValue<string[]>(columnId);
  const selectedSet = new Set(selected);
  return values.some(v => selectedSet.has(v));
};

const rangeFilter: FilterFn<MatchRecord> = (row, columnId, range: [number | null, number | null]) => {
  const [lo, hi] = range;
  if (lo === null && hi === null) return true;
  const value = row.getValue<number>(columnId);
  if (lo !== null && value < lo) return false;
  if (hi !== null && value > hi) return false;
  return true;
};

const columns: ColumnDef<MatchRecord, unknown>[] = [
  ...CATEGORY_KEYS.map(key => ({
    id: key,
    accessorFn: (m: MatchRecord) => CATEGORY_GETTERS[key](m),
    filterFn: categoryFilter,
  })),
  ...RANGE_KEYS.map(key => ({
    id: key,
    accessorFn: (m: MatchRecord) => RANGE_GETTERS[key](m),
    filterFn: rangeFilter,
  })),
];

let fuseCache: Fuse<MatchRecord> | null = null;
let fuseMatches: MatchRecord[] | null = null;

function getFuse(matches: MatchRecord[]): Fuse<MatchRecord> {
  if (fuseMatches === matches && fuseCache) return fuseCache;
  fuseCache = new Fuse(matches, {
    keys: [
      { name: 'cnHero', getFn: (m: MatchRecord) => (m.career?.hero_name as string) || m.agent.agent_name },
      { name: 'enHero', getFn: (m: MatchRecord) => m.agent.agent_name },
      { name: 'cnMap', getFn: (m: MatchRecord) => (m.career?.map_name as string) || '' },
      { name: 'cnMode', getFn: (m: MatchRecord) => (m.career?.game_mode as string) || '' },
      { name: 'id', weight: 3, getFn: (m: MatchRecord) => m.matches_id },
      { name: 'videoName', getFn: (m: MatchRecord) => m.videos.map(v => v.video_name).join(' ') },
      { name: 'mapId', weight: 0.5, getFn: (m: MatchRecord) => m.map.map_id },
      { name: 'mode', weight: 0.5, getFn: (m: MatchRecord) => m.mode },
    ],
    threshold: 0.35,
    ignoreLocation: true,
    minMatchCharLength: 1,
  });
  fuseMatches = matches;
  return fuseCache;
}

function matchesForQuery(matches: MatchRecord[], query: string): MatchRecord[] {
  const q = query.trim();
  if (!q) return matches;
  const ids = new Set(getFuse(matches).search(q).map(r => r.item.matches_id));
  return matches.filter(m => ids.has(m.matches_id));
}

function columnFiltersFromState(filters: FilterState): ColumnFiltersState {
  const columnFilters: ColumnFiltersState = [];
  for (const key of CATEGORY_KEYS) {
    if (filters[key].length) columnFilters.push({ id: key, value: filters[key] });
  }
  for (const key of RANGE_KEYS) {
    const [lo, hi] = filters[key];
    if (lo !== null || hi !== null) columnFilters.push({ id: key, value: filters[key] });
  }
  return columnFilters;
}

function tableRows(matches: MatchRecord[], filters: FilterState): MatchRecord[] {
  const table = createTable<MatchRecord>({
    data: matchesForQuery(matches, filters.query),
    columns,
    state: { columnFilters: columnFiltersFromState(filters) },
    onStateChange: () => {},
    renderFallbackValue: null,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });
  return table.getFilteredRowModel().rows.map(row => row.original);
}

export function applyFilters(matches: MatchRecord[], filters: FilterState): MatchRecord[] {
  return tableRows(matches, filters);
}

function valueCounts(matches: MatchRecord[], key: CategoryKey): Map<string, number> {
  const counts = new Map<string, number>();
  const getter = CATEGORY_GETTERS[key];
  for (const m of matches) {
    const display = getter(m)[0]!;
    if (!display) continue;
    if (/^\d+$/.test(display)) continue;
    counts.set(display, (counts.get(display) ?? 0) + 1);
  }
  return counts;
}

// Facets ignore free-text search so typing a temporary query does not
// make persisted category selections disappear.
export function facetValueCounts(matches: MatchRecord[], filters: FilterState, key: CategoryKey): Map<string, number> {
  return valueCounts(tableRows(matches, { ...filters, query: '', [key]: [] }), key);
}

export function rangeBounds(matches: MatchRecord[], key: RangeKey): [number, number] {
  const getter = RANGE_GETTERS[key];
  let min = Infinity;
  let max = -Infinity;
  for (const m of matches) {
    const value = getter(m);
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (!Number.isFinite(min)) return [0, 0];
  return [min, max];
}

export function pruneUnavailableCategories(matches: MatchRecord[], filters: FilterState): FilterState {
  let next = filters;
  for (const key of CATEGORY_KEYS) {
    const selected = next[key];
    if (selected.length === 0) continue;
    const available = facetValueCounts(matches, next, key);
    const kept = selected.filter(v => available.has(v));
    if (kept.length !== selected.length) next = { ...next, [key]: kept };
  }
  return next;
}
