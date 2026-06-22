import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import {
  FilterState, EMPTY_FILTERS, activeFilterCount, activeFilterSummary,
  loadFilters, saveFilters, loadOpen, saveOpen,
  normalizeVisibleFilters,
  CATEGORY_KEYS, RANGE_KEYS,
} from '../utils/filters.ts';
import { applyFilters, pruneUnavailableCategories } from '../utils/filter-engine.ts';
import type { MatchRecord } from '@wonderful-ui/parser';
import { ALL_ACCOUNTS } from './account.ts';

export type ScrapeMode = 'incremental' | 'full';

const REFRESH_SCAN_MODE_KEY = 'wui:library.refreshScanMode';

export const useFilterStore = defineStore('filter', () => {
  const filters = ref<FilterState>(normalizeVisibleFilters(loadFilters()));
  const filterBarOpen = ref(loadOpen());
  const refreshScanMode = ref<ScrapeMode>(
    localStorage.getItem(REFRESH_SCAN_MODE_KEY) === 'full' ? 'full' : 'incremental'
  );
  const scrollToKey = ref<string | null>(null);

  const activeCount = computed(() => activeFilterCount(filters.value));
  const summary = computed(() => activeFilterSummary(filters.value));

  function setFilters(patch: Partial<FilterState>) {
    Object.assign(filters.value, patch);
    filters.value = normalizeVisibleFilters(filters.value);
    saveFilters(filters.value);
  }

  function clearFilter(key: string, value?: string) {
    if (key === '__all__') {
      setFilters({ ...EMPTY_FILTERS, query: filters.value.query });
      return;
    }
    if (key === 'query') {
      setFilters({ ...filters.value, query: '' });
      return;
    }
    const catSet = new Set<string>(CATEGORY_KEYS);
    if (catSet.has(key)) {
      const arr = [...filters.value[key as keyof FilterState] as string[]];
      if (value !== undefined) {
        const s = new Set(arr);
        s.delete(value);
        setFilters({ [key]: [...s] });
      }
      return;
    }
    if ((RANGE_KEYS as readonly string[]).includes(key)) {
      setFilters({ [key]: [null, null] });
      return;
    }
  }

  function pruneForScope(matches: MatchRecord[]) {
    const next = normalizeVisibleFilters(pruneUnavailableCategories(matches, filters.value));
    if (next !== filters.value) {
      filters.value = next;
      saveFilters(filters.value);
    }
  }

  function toggleFilterBar() {
    filterBarOpen.value = !filterBarOpen.value;
    saveOpen(filterBarOpen.value);
  }

  function setFilterBarOpen(open: boolean) {
    filterBarOpen.value = open;
    saveOpen(open);
  }

  function setScanMode(mode: ScrapeMode) {
    refreshScanMode.value = mode;
    localStorage.setItem(REFRESH_SCAN_MODE_KEY, mode);
  }

  function focusSection(key: string) {
    scrollToKey.value = key;
  }

  function clearScrollTarget() {
    scrollToKey.value = null;
  }

  function applyToMatches(allMatches: MatchRecord[], accountMatches: MatchRecord[]) {
    return applyFilters(accountMatches, filters.value);
  }

  // Per-account filtered counts for sidebar numbers.
  // Previously called applyFilters once for ALL_ACCOUNTS and once per real
  // account (O((N+1) * M), with each applyFilters rebuilding a full TanStack
  // table). Now: one applyFilters pass, then group by openID in a single
  // linear walk. The map omits accounts with zero matches after filtering;
  // AccountSidebar's consumer falls back to a.matchCount in that case.
  function filteredAccountCounts(matches: MatchRecord[], realAccounts: Array<{ openid: string; error?: string }>) {
    const counts = new Map<string, number>();
    const filtered = applyFilters(matches, filters.value);
    counts.set(ALL_ACCOUNTS, filtered.length);
    for (const m of filtered) {
      counts.set(m.openID, (counts.get(m.openID) ?? 0) + 1);
    }
    // Errored accounts always show 0, regardless of any residual matches.
    for (const a of realAccounts) {
      if (a.error) counts.set(a.openid, 0);
    }
    return counts;
  }

  return {
    filters, filterBarOpen, refreshScanMode, scrollToKey,
    activeCount, summary,
    setFilters, clearFilter, pruneForScope,
    toggleFilterBar, setFilterBarOpen, setScanMode,
    focusSection, clearScrollTarget,
    applyToMatches, filteredAccountCounts,
  };
});
