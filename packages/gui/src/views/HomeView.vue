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
          <WIcon icon="ph:sliders-horizontal" :size="14" />
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
        <button
          class="pane-head-action"
          :class="{ 'is-loading': account.scraping }"
          :aria-label="account.scraping ? '正在扫描资料库' : scanLabel + '资料库'"
          :data-tip="account.scraping ? '正在扫描资料库' : scanLabel + '资料库'"
          type="button"
          :disabled="account.scraping"
          @click="onScrape"
        >
          <WIcon icon="ph:arrows-clockwise" :size="14" />
        </button>
      </div>
    </div>
    <div
      class="match-list"
      :class="{ 'is-empty': accountMatches.length === 0, 'is-loading': isBootLoading }"
      role="listbox"
      ref="listRef"
      :aria-activedescendant="focusedId ?? undefined"
      :aria-label="`高光对局列表,共 ${filteredMatches.length} 条`"
      @scroll="onScroll"
      @keydown="onListKeydown"
    >
      <template v-if="isBootLoading">
        <div class="empty empty-loading">
          <div class="empty-spinner" aria-hidden="true"><WIcon icon="ph:circle-notch" :size="20" class="spin" /></div>
          <div class="empty-title">正在加载对局</div>
        </div>
      </template>
      <template v-else-if="accountMatches.length === 0">
        <div class="empty">
          <div class="empty-title">还没有高光</div>
        </div>
      </template>
      <template v-else>
        <div class="vlist-spacer" :style="{ height: totalHeight + 'px' }" />
        <MatchCard
          v-for="item in visibleMatches"
          :ref="(el) => registerCardRef(item.match.matches_id, el)"
          :key="item.match.matches_id"
          :match="item.match"
          :style="{ position: 'absolute', top: '0', left: '0', right: '0', transform: 'translateY(' + item.y + 'px)' }"
          :is-selected="item.match.matches_id === detail.selectedMatch?.matches_id"
          :is-focused="item.match.matches_id === focusedId"
          :account-label="account.accountLabels.get(item.match.openID) ?? item.match.openID"
          @click="onRowActivate(item.match)"
          @dblclick="playFirst(item.match)"
        />
        <div v-if="filteredMatches.length === 0" class="empty empty-inside-list">
          <div class="empty-title">没有匹配</div>
          <button class="btn btn-primary" style="margin-top:12px" @click="filter.clearFilter('__all__')">清除全部筛选</button>
        </div>
      </template>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import WIcon from '../components/common/WIcon.vue';
import { useAccountStore } from '../stores/account.ts';
import { useFilterStore } from '../stores/filter.ts';
import { useDetailStore } from '../stores/detail.ts';
import { usePlayerStore } from '../stores/player.ts';
import { useUiStore } from '../stores/ui.ts';
import { useVirtualScroll, ROW_HEIGHT } from '../composables/useVirtualScroll.ts';
import MatchCard from '../components/match/MatchCard.vue';
import type { MatchRecord } from '@wonderful-ui/parser';

type MatchCardInstance = InstanceType<typeof MatchCard> & { rootEl: HTMLElement | null };

const router = useRouter();
const account = useAccountStore();
const filter = useFilterStore();
const detail = useDetailStore();
const player = usePlayerStore();
const ui = useUiStore();

const listRef = ref<HTMLElement | null>(null);

const accountMatches = computed(() => {
  const all = account.matches;
  const openid = account.selectedAccountId;
  if (!openid || openid === '__all__') return [...all].sort((a, b) => b.matches_time - a.matches_time);
  return all.filter(m => m.openID === openid).sort((a, b) => b.matches_time - a.matches_time);
});

const filteredMatches = computed(() => filter.applyToMatches(account.matches, accountMatches.value));

// Spinner for the user-driven refresh path (the Refresh button calls
// account.scrapeLibrary, which sets scraping=true). The first-launch
// background scrape is shown by BootOverlay at the app level, not here:
// the match list is not mounted while booted is false, so a
// boot-time loading view would never be visible.
const isBootLoading = computed(() => account.scraping);

const { totalHeight, visibleMatches, onScroll, scrollToIndex } = useVirtualScroll(filteredMatches, listRef);

const scanLabel = computed(() => filter.refreshScanMode === 'full' ? '全量扫描' : '增量扫描');

// Keyboard listbox navigation
// focusedId follows the currently-focused option; it uses aria-activedescendant
// (the listbox itself stays unfocused) so virtual-scroll range changes do not
// yank focus out of the listbox.
const focusedId = ref<string | null>(null);
const cardRefs = new Map<string, MatchCardInstance>();

function registerCardRef(id: string, el: Element | null) {
  if (el) {
    cardRefs.set(id, el as unknown as MatchCardInstance);
  } else {
    cardRefs.delete(id);
  }
}

// Keep focusedId valid when the underlying list changes
// focusedId drives aria-activedescendant + which row gets tabindex=0.
// Keep it null until the user actually interacts: seeding it to the first
// row on mount was painting a red outline (= same color as .is-selected)
// on a row the user had never touched, which read as "first row is
// permanently selected".
watch(filteredMatches, (list) => {
  if (list.length === 0) {
    focusedId.value = null;
    return;
  }
  if (focusedId.value && list.some(m => m.matches_id === focusedId.value)) {
    return; // current focus is still in the list
  }
  // Re-anchor only when there is a real selection (user clicked a row
  // earlier). Otherwise stay null until the user actually navigates.
  const sel = detail.selectedMatch?.matches_id;
  focusedId.value = sel && list.some(m => m.matches_id === sel) ? sel : null;
}, { immediate: true });

function onRowActivate(m: MatchRecord) {
  router.push({ name: 'detail', params: { id: m.matches_id } });
}

function focusIndex(index: number, opts: { scroll?: 'auto' | 'always' } = {}) {
  const list = filteredMatches.value;
  if (list.length === 0) return;
  const clamped = Math.max(0, Math.min(list.length - 1, index));
  const target = list[clamped]!;
  focusedId.value = target.matches_id;
  const shouldScroll = opts.scroll === 'always' || shouldScrollIntoView(clamped);
  if (shouldScroll) {
    scrollToIndex(visibleRowIndexFor(clamped));
  }
  // After Vue has rendered the new visible range, move focus to the row.
  nextTick(() => {
    const el = cardRefs.get(target.matches_id)?.rootEl;
    if (el && document.activeElement !== el) el.focus({ preventScroll: true });
  });
}

function visibleRowIndexFor(filteredIndex: number): number {
  // filteredMatches and the virtual scroll share the same ordering, so the
  // filtered index equals the scroll index. (Filtered list length === scroll
  // length because useVirtualScroll is fed filteredMatches directly.)
  return filteredIndex;
}

function shouldScrollIntoView(filteredIndex: number): boolean {
  const el = listRef.value;
  if (!el) return false;
  const top = filteredIndex * ROW_HEIGHT;
  const bottom = top + ROW_HEIGHT;
  const viewTop = el.scrollTop;
  const viewBottom = viewTop + el.clientHeight;
  if (top < viewTop) return true;
  if (bottom > viewBottom) return true;
  return false;
}

function onListKeydown(e: KeyboardEvent) {
  const list = filteredMatches.value;
  if (list.length === 0) return;
  const currentIdx = list.findIndex(m => m.matches_id === focusedId.value);
  // When no row is focused yet, ArrowDown lands on the first row and
  // ArrowUp lands on the last (so the user always gets a meaningful move
  // from the initial Tab into the listbox). Home/End behave normally.
  const noFocus = currentIdx < 0;
  const safeIdx = noFocus ? -1 : currentIdx;

  let nextIdx: number | null = null;
  switch (e.key) {
    case 'ArrowDown': nextIdx = noFocus ? 0 : safeIdx + 1; break;
    case 'ArrowUp':   nextIdx = noFocus ? list.length - 1 : safeIdx - 1; break;
    case 'Home':      nextIdx = 0; break;
    case 'End':       nextIdx = list.length - 1; break;
    case 'PageDown': {
      const el = listRef.value;
      const page = el ? Math.max(1, Math.floor(el.clientHeight / ROW_HEIGHT) - 1) : 5;
      nextIdx = safeIdx + page;
      break;
    }
    case 'PageUp': {
      const el = listRef.value;
      const page = el ? Math.max(1, Math.floor(el.clientHeight / ROW_HEIGHT) - 1) : 5;
      nextIdx = safeIdx - page;
      break;
    }
    case 'Enter':
    case ' ': {
      // MatchCard's own keydown already handled click emission; nothing more
      // to do here.
      return;
    }
    default:
      return;
  }
  e.preventDefault();
  if (nextIdx === null) return;
  // Always clamp and scroll on Page/Home/End so the user lands inside the view
  // even when the focused row is currently visible.
  focusIndex(nextIdx, { scroll: e.key === 'PageDown' || e.key === 'PageUp' || e.key === 'Home' || e.key === 'End' ? 'always' : 'auto' });
}

// Make the listbox itself focusable so it can receive keydown
onMounted(() => {
  if (listRef.value) {
    listRef.value.tabIndex = 0;
  }
});

async function onScrape() {
  if (filter.refreshScanMode === 'full') ui.showScanOverlay();
  try {
    await account.scrapeLibrary(filter.refreshScanMode);
    (window as unknown as Record<string, unknown>).__wuiToast?.('资料库已' + scanLabel.value, 'ok');
  } finally {
    if (filter.refreshScanMode === 'full') ui.hideScanOverlay();
  }
}

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
.pane-head-action {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 26px;
  height: 24px;
  padding: 0 6px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  background: var(--surface-2);
  color: var(--ink-3);
  cursor: pointer;
  flex-shrink: 0;
  transition: border-color 100ms ease-out, color 100ms ease-out, background 100ms ease-out;
}
.pane-head-action:hover {
  color: var(--ink);
  border-color: var(--ink-4);
}
.pane-head-action:disabled {
  opacity: 0.68;
  cursor: default;
}
.pane-head-action.is-loading svg {
  animation: spin 900ms linear infinite;
  transform-origin: center;
  transform-box: fill-box;
}

@media (prefers-reduced-motion: reduce) {
  .pane-head-action.is-loading svg {
    animation-duration: 1600ms;
  }
}

/* Empty state lives inside .match-list (was previously a sibling of it,
   which placed it visually below the scroller's spacer). When the list
   is empty, switch the scroller to a centred flex column so the title
   sits at the visual centre of the pane instead of stuck under the
   (zero-height) spacer. */
.match-list.is-empty,
.match-list.is-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.empty-inside-list {
  /* The global .empty has flex: 1 + 32px padding, which is right for a
     pane-sibling empty but wrong inside a listbox. Reset the padding
     and let the parent .match-list.is-empty centre us instead. */
  flex: 0 0 auto;
  padding: 0;
  position: absolute;
  inset: 0;
}
.empty-loading {
  gap: 10px;
}
.empty-spinner :deep(svg) {
  color: var(--ink-3);
  animation: empty-spin 0.9s linear infinite;
}
@keyframes empty-spin {
  to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
  .empty-spinner :deep(svg) {
    animation-duration: 1600ms;
  }
}
</style>
