<template>
  <main class="pane list" aria-label="高光列表">
    <div class="pane-head">
      <div class="pane-title-row">
        <span class="pane-title">对局列表</span>
        <button
          class="scope-filter-toggle"
          :class="{ 'is-open': filter.filterBarOpen }"
          type="button"
          :aria-label="filter.filterBarOpen ? '收起筛选' : '展开筛选'"
          :aria-pressed="String(filter.filterBarOpen)"
          data-tip="展开筛选"
          @click="filter.toggleFilterBar()"
        >
          <SlidersHorizontal :size="14" />
          <span v-if="filter.activeCount > 0" class="scope-filter-toggle-count">{{ filter.activeCount }}</span>
        </button>
      </div>
      <div class="pane-head-right">
        <span class="pane-sub">
          <template v-if="filter.activeCount > 0 || filter.filters.query.trim()">
            {{ filteredMatches.length }} / {{ accountMatches.length }} 条
          </template>
          <template v-else>{{ accountMatches.length }} 条 · 时间倒序</template>
        </span>
      </div>
    </div>
    <div class="match-list" role="listbox" ref="listRef" @scroll="onScroll">
      <div class="vlist-spacer" :style="{ height: totalHeight + 'px' }" />
      <MatchCard
        v-for="item in visibleMatches"
        :key="item.match.matches_id"
        :match="item.match"
        :style="{ position: 'absolute', top: '0', left: '0', right: '0', transform: 'translateY(' + item.y + 'px)' }"
        :is-selected="item.match.matches_id === detail.selectedMatch?.matches_id"
        :account-label="account.accountLabels.get(item.match.openID) ?? item.match.openID"
        @click="detail.selectMatch(item.match)"
        @dblclick="playFirst(item.match)"
      />
    </div>
    <div v-if="accountMatches.length === 0" class="empty">
      <div class="empty-title">这个账户还没录到高光</div>
      <div class="empty-sub">去打一局 VALORANT 吧</div>
    </div>
    <div v-else-if="filteredMatches.length === 0" class="empty">
      <div class="empty-title">没有匹配</div>
      <div class="empty-sub">
        <template v-if="filter.activeCount > 0">
          {{ accountMatches.length }} 条中无结果 · {{ filter.summary }}
        </template>
        <template v-else>搜索 "{{ filter.filters.query }}" 在 {{ accountMatches.length }} 条中没结果</template>
      </div>
      <button class="btn btn-primary" style="margin-top:12px" @click="filter.clearFilter('__all__')">清除全部筛选</button>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { SlidersHorizontal } from 'lucide-vue-next';
import { useAccountStore } from '../stores/account.ts';
import { useFilterStore } from '../stores/filter.ts';
import { useDetailStore } from '../stores/detail.ts';
import { usePlayerStore } from '../stores/player.ts';
import { useVirtualScroll } from '../composables/useVirtualScroll.ts';
import MatchCard from '../components/match/MatchCard.vue';
import type { MatchRecord } from '@wonderful-ui/parser';

const account = useAccountStore();
const filter = useFilterStore();
const detail = useDetailStore();
const player = usePlayerStore();

const listRef = ref<HTMLElement | null>(null);

const accountMatches = computed(() => {
  const all = account.matches;
  const openid = account.selectedAccountId;
  if (!openid || openid === '__all__') return [...all].sort((a, b) => b.matches_time - a.matches_time);
  return all.filter(m => m.openID === openid).sort((a, b) => b.matches_time - a.matches_time);
});

const filteredMatches = computed(() => filter.applyToMatches(account.matches, accountMatches.value));

const { totalHeight, visibleMatches, onScroll } = useVirtualScroll(filteredMatches, listRef);

function playFirst(m: MatchRecord) {
  const video = m.videos[0];
  if (!video) return;
  player.open(video, m);
}
</script>

<style scoped>
.scope-filter-toggle {
  font-size: 11px; color: var(--ink-3);
  min-width: 26px;
  height: 24px;
  padding: 0 6px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  background: var(--surface-2);
  font-family: var(--font-sans);
  cursor: pointer;
  transition: border-color 100ms ease-out, color 100ms ease-out, background 100ms ease-out;
  white-space: nowrap;
  flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center; gap: 4px;
}
.scope-filter-toggle:hover { color: var(--ink); border-color: var(--ink-4); }
.scope-filter-toggle.is-open {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-soft);
}
.scope-filter-toggle-count {
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
.scope-filter-toggle.is-open .scope-filter-toggle-count {
  color: var(--accent);
  background: var(--surface-2);
}
</style>
