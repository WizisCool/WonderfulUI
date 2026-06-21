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
      <FilterBar
        :filters="filters"
        :all-matches="allMatches"
        @update="(patch: any) => $emit('update', patch)"
      />
    </div>

    <div v-if="activeN > 0" class="filter-rail-footer">
      <button class="filter-rail-clear" type="button" @click="$emit('clearAll')">清除全部筛选</button>
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

const props = defineProps<{
  filters: FilterState;
  allMatches: MatchRecord[];
  scopeLabel: string;
}>();

defineEmits<{
  update: [patch: Partial<FilterState>];
  close: [];
  clearAll: [];
}>();

const activeN = computed(() => activeFilterCount(props.filters));
</script>

<style scoped></style>
