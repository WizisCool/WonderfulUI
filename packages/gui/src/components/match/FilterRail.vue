<template>
  <aside class="pane filter-rail" aria-label="筛选">
    <div class="pane-head">
      <div class="filter-title-stack">
        <span class="pane-title">筛选</span>
        <span class="filter-scope">{{ scopeLabel }}中生效</span>
      </div>
      <div class="pane-head-right">
        <span v-if="activeN > 0" class="pane-sub">{{ activeN }} 个</span>
        <button class="filter-rail-close" type="button" aria-label="关闭筛选" @click="$emit('close')">
          <X :size="14" />
        </button>
      </div>
    </div>

    <div class="filter-rail-body">
      <FilterBar />
    </div>

    <div v-if="activeN > 0" class="filter-rail-footer">
      <button class="filter-rail-clear" type="button" @click="filterStore.clearFilter('__all__')">清除全部筛选</button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { X } from 'lucide-vue-next';
import FilterBar from './FilterBar.vue';
import type { FilterState } from '../../utils/filters.ts';
import { activeFilterCount } from '../../utils/filters.ts';
import type { MatchRecord } from '@wonderful-ui/parser';
import { useFilterStore } from '../../stores/filter.ts';
import { useAccountStore } from '../../stores/account.ts';

const filterStore = useFilterStore();
const account = useAccountStore();

const emit = defineEmits<{
  close: [];
}>();

const scopeLabel = computed(() => {
  const labels = account.accountLabels;
  const id = account.selectedAccountId;
  if (!id || id === '__all__') return '全部账号';
  return labels.get(id) ?? id;
});

const activeN = computed(() => activeFilterCount(filterStore.filters));

const accountMatches = computed(() => {
  const all = account.matches;
  const openid = account.selectedAccountId;
  if (!openid || openid === '__all__') return [...all].sort((a, b) => b.matches_time - a.matches_time);
  return all.filter(m => m.openID === openid).sort((a, b) => b.matches_time - a.matches_time);
});
</script>

<style scoped>
.filter-rail {
  display: flex; flex-direction: column;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  background: var(--surface);
}
.filter-rail-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px var(--pad);
  border-bottom: 1px solid var(--border-soft);
  flex-shrink: 0;
}
.filter-rail-body {
  flex: 1;
  overflow-y: auto;
  padding: 6px var(--pad) var(--pad);
  display: flex; flex-direction: column; gap: 6px;
}
.filter-rail-body .filter-section {
  opacity: 1;
  transform: none;
}
.filter-rail-close {
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px;
  background: transparent;
  border: 0;
  border-radius: 4px;
  color: var(--ink-3);
  cursor: pointer;
  transition: background 100ms ease-out, color 100ms ease-out;
}
.filter-rail-close:hover {
  background: var(--surface-2);
  color: var(--ink);
}
.filter-rail-footer {
  border-top: 1px solid var(--border-soft);
  padding: 8px var(--pad);
  flex-shrink: 0;
  display: flex;
  justify-content: center;
}
.filter-rail-clear {
  font-size: 11px; color: var(--ink-3);
  background: transparent; border: 0;
  cursor: pointer;
  font-family: var(--font-sans);
  padding: 4px 10px;
  border-radius: var(--radius);
  transition: color 100ms ease-out, background 100ms ease-out;
}
.filter-rail-clear:hover {
  color: var(--accent);
  background: var(--accent-soft);
}

.app.is-filter-open .filter-rail {
  animation: filter-rail-in 240ms cubic-bezier(0.16, 1, 0.3, 1) both;
}
@keyframes filter-rail-in {
  from { opacity: 0; transform: translateX(-12px); }
  to   { opacity: 1; transform: translateX(0); }
}
</style>
