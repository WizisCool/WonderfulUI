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
      tabindex="0"
      :aria-activedescendant="activeDescendantId"
      :aria-label="`高光对局列表,共 ${filteredMatches.length} 条`"
      @scroll="onListScroll"
      @keydown="onListKeydown"
      @pointerdown="onListPointerDown"
      @focus="listFocused = true"
      @blur="onListBlur"
      @contextmenu="onListContextMenu"
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
          :key="item.match.matches_id"
          :match="item.match"
          :style="{ position: 'absolute', top: '0', left: '0', right: '0', transform: 'translateY(' + item.y + 'px)' }"
          :is-selected="item.match.matches_id === detail.selectedMatch?.matches_id"
          :is-focused="showKeyboardActive && item.match.matches_id === focusedId"
          :account-label="account.accountLabels.get(item.match.openID) ?? item.match.openID"
          @click="onRowClick(item.match)"
          @dblclick="playFirst(item.match)"
          @contextmenu="onRowContextMenu($event, item.match)"
        />
        <div v-if="filteredMatches.length === 0" class="empty empty-inside-list">
          <div class="empty-title">没有匹配</div>
          <button class="btn btn-primary" style="margin-top:12px" @click="filter.clearFilter('__all__')">清除全部筛选</button>
        </div>
      </template>
    </div>

    <Teleport to="body">
      <div
        v-show="ctxMenu"
        ref="ctxMenuRef"
        class="match-context-menu"
        :class="{ 'is-closing': ctxMenuClosing }"
        role="menu"
        :style="ctxMenuStyle"
        @contextmenu.prevent
        @animationend="onCtxMenuAnimEnd"
      >
        <template v-if="ctxMenu?.kind === 'folder'">
          <button
            class="match-context-item"
            type="button"
            role="menuitem"
            :disabled="!ctxMenu.videoPath"
            @click="onCtxOpenFolder"
          >
            <WIcon icon="ph:folder-open" :size="14" />
            <span class="match-context-item-label">打开对局文件夹</span>
          </button>
        </template>
        <template v-else-if="ctxMenu?.kind === 'scan'">
          <button
            class="match-context-item"
            type="button"
            role="menuitem"
            :disabled="account.scraping"
            @click="onCtxScan"
          >
            <WIcon icon="ph:arrows-clockwise" :size="14" />
            <span class="match-context-item-label">{{ scanLabel }}资料库</span>
          </button>
        </template>
      </div>
    </Teleport>
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import WIcon from '../components/common/WIcon.vue';
import { useAccountStore } from '../stores/account.ts';
import { useFilterStore } from '../stores/filter.ts';
import { useDetailStore } from '../stores/detail.ts';
import { usePlayerStore } from '../stores/player.ts';
import { useUiStore } from '../stores/ui.ts';
import { useVirtualScroll, ROW_HEIGHT } from '../composables/useVirtualScroll.ts';
import MatchCard from '../components/match/MatchCard.vue';
import {
  isListboxActivateKey,
  isListboxNavKey,
  listboxNavAlwaysScroll,
  matchOptionId,
  nextListboxIndex,
  reconcileFocusedId,
  scrollTopToRevealIndex,
} from '../utils/match-listbox.ts';
import { firstMatchVideoPath } from '../utils/match-paths.ts';
import { placeMenuNearCursor } from '../utils/context-menu.ts';
import { invoke } from '../tauri-adapter.ts';
import type { MatchRecord } from '@wonderful-ui/parser';

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

const filteredMatches = computed(() => filter.applyToMatches(accountMatches.value));

// Spinner for the user-driven refresh path (the Refresh button calls
// account.scrapeLibrary, which sets scraping=true). The first-launch
// background scrape is shown by BootOverlay at the app level, not here:
// the match list is not mounted while booted is false, so a
// boot-time loading view would never be visible.
const isBootLoading = computed(() => account.scraping);

const { totalHeight, visibleMatches, onScroll } = useVirtualScroll(filteredMatches, listRef);

const scanLabel = computed(() => filter.refreshScanMode === 'full' ? '全量扫描' : '增量扫描');

// ─── ARIA listbox (aria-activedescendant, single pattern) ───────────────────
// Focus ALWAYS stays on `.match-list`. Options are never focused — virtual
// scroll can unmount them without stealing keyboard focus. See match-listbox.ts.
//
// Visual keyboard ring uses "modality" (like :focus-visible): pointer down
// clears it, arrow/home/end/page keys re-enable it. Mouse click only shows
// .is-selected (accent border) — never a second pink/ink ring.
const focusedId = ref<string | null>(null);
const listFocused = ref(false);
const keyboardModality = ref(false);

const showKeyboardActive = computed(
  () => listFocused.value && keyboardModality.value,
);

const activeDescendantId = computed(() => {
  // Only expose activedescendant while the listbox owns focus (APG).
  if (!listFocused.value || !focusedId.value) return undefined;
  if (!filteredMatches.value.some(m => m.matches_id === focusedId.value)) return undefined;
  return matchOptionId(focusedId.value);
});

// Keep focusedId valid when the underlying list changes. Never seed the first
// row on mount — that painted a permanent "selected" look on row 0.
watch(filteredMatches, (list) => {
  focusedId.value = reconcileFocusedId(
    focusedId.value,
    detail.selectedMatch?.matches_id,
    list.map(m => m.matches_id),
  );
}, { immediate: true });

function onListPointerDown() {
  // Mouse / pen / touch: selection chrome only, no keyboard active ring.
  keyboardModality.value = false;
}

function onListBlur() {
  listFocused.value = false;
  keyboardModality.value = false;
}

function clearMatchSelection(): boolean {
  if (!detail.selectedMatch) return false;
  detail.selectMatch(null);
  void router.push({ name: 'home' });
  return true;
}

/** Left-click: select; click again on selected → clear selection. */
function onRowClick(m: MatchRecord) {
  if (Date.now() < suppressClickUntil) return;
  focusedId.value = m.matches_id;
  // Pointer path already cleared keyboardModality via pointerdown.
  // Keep DOM focus on the listbox so the next Arrow key works without re-Tab.
  listRef.value?.focus({ preventScroll: true });
  if (detail.selectedMatch?.matches_id === m.matches_id) {
    clearMatchSelection();
    return;
  }
  void router.push({ name: 'detail', params: { id: m.matches_id } });
}

function pageSize(): number {
  const el = listRef.value;
  if (!el || el.clientHeight <= 0) return 5;
  return Math.max(1, Math.floor(el.clientHeight / ROW_HEIGHT) - 1);
}

function moveActiveToIndex(index: number, forceScroll = false) {
  const list = filteredMatches.value;
  if (list.length === 0) return;
  const clamped = Math.max(0, Math.min(list.length - 1, index));
  const target = list[clamped]!;
  focusedId.value = target.matches_id;
  keyboardModality.value = true;
  const el = listRef.value;
  if (!el) return;
  const nextTop = scrollTopToRevealIndex(
    clamped,
    ROW_HEIGHT,
    el.scrollTop,
    el.clientHeight,
    forceScroll,
  );
  if (nextTop !== null) el.scrollTop = nextTop;
}

function onListKeydown(e: KeyboardEvent) {
  if (ctxMenu.value) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeCtxMenu();
      return;
    }
  }

  if (e.key === 'Escape' && detail.selectedMatch) {
    e.preventDefault();
    e.stopPropagation();
    clearMatchSelection();
    return;
  }

  const list = filteredMatches.value;
  if (list.length === 0) return;

  if (isListboxActivateKey(e.key)) {
    const id = focusedId.value;
    if (!id) return;
    const m = list.find(row => row.matches_id === id);
    if (!m) return;
    e.preventDefault();
    // Enter/Space from keyboard keep keyboard modality (ring may match selection).
    keyboardModality.value = true;
    onRowClick(m);
    return;
  }

  if (!isListboxNavKey(e.key)) return;

  const currentIdx = list.findIndex(m => m.matches_id === focusedId.value);
  const nextIdx = nextListboxIndex(e.key, currentIdx, list.length, pageSize());
  if (nextIdx === null) return;
  e.preventDefault();
  moveActiveToIndex(nextIdx, listboxNavAlwaysScroll(e.key));
}

async function onScrape() {
  if (filter.refreshScanMode === 'full') ui.showScanOverlay();
  try {
    await account.scrapeLibrary(filter.refreshScanMode);
    ui.showToast('资料库已' + scanLabel.value, 'ok');
  } finally {
    if (filter.refreshScanMode === 'full') ui.hideScanOverlay();
  }
}

function playFirst(m: MatchRecord) {
  const video = m.videos[0];
  if (!video) return;
  player.open(video, m);
}

// ─── Context menu ───────────────────────────────────────────────────────────
// Right-click a match row → select it, then「打开对局文件夹」.
// Right-click blank →「扫描资料库」only.

type CtxMenuState =
  | { x: number; y: number; kind: 'folder'; videoPath: string | null }
  | { x: number; y: number; kind: 'scan' };

const ctxMenu = ref<CtxMenuState | null>(null);
const ctxMenuClosing = ref(false);
const ctxMenuRef = ref<HTMLElement | null>(null);
const ctxMenuStyle = ref<Record<string, string>>({ left: '0px', top: '0px' });
let ctxMenuCloseTimer: ReturnType<typeof setTimeout> | null = null;
let ctxMenuListenersBound = false;
/** After menu dismiss via outside click, ignore the following click (no select toggle). */
let suppressClickUntil = 0;
let killClickThrough: ((e: Event) => void) | null = null;

function openCtxMenu(state: CtxMenuState) {
  if (ctxMenuCloseTimer) {
    clearTimeout(ctxMenuCloseTimer);
    ctxMenuCloseTimer = null;
  }
  ctxMenuClosing.value = false;
  ctxMenu.value = state;
  bindCtxMenuListeners();
  nextTick(() => {
    const el = ctxMenuRef.value;
    if (!el || !ctxMenu.value) return;
    const pos = placeMenuNearCursor(
      { x: state.x, y: state.y },
      { width: el.offsetWidth || 180, height: el.offsetHeight || 40 },
      { width: window.innerWidth, height: window.innerHeight },
    );
    ctxMenuStyle.value = { left: `${pos.x}px`, top: `${pos.y}px` };
    const first = el.querySelector<HTMLButtonElement>('button.match-context-item:not(:disabled)');
    first?.focus();
  });
}

function closeCtxMenu(opts?: { armClickThrough?: boolean }) {
  if (!ctxMenu.value || ctxMenuClosing.value) return;
  ctxMenuClosing.value = true;
  unbindCtxMenuListeners();
  if (opts?.armClickThrough) {
    suppressClickUntil = Date.now() + 350;
    if (killClickThrough) {
      document.removeEventListener('click', killClickThrough, true);
      killClickThrough = null;
    }
    const killer = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      document.removeEventListener('click', killer, true);
      if (killClickThrough === killer) killClickThrough = null;
    };
    killClickThrough = killer;
    document.addEventListener('click', killer, true);
    window.setTimeout(() => {
      if (killClickThrough === killer) {
        document.removeEventListener('click', killer, true);
        killClickThrough = null;
      }
    }, 400);
  }
  if (ctxMenuCloseTimer) clearTimeout(ctxMenuCloseTimer);
  ctxMenuCloseTimer = setTimeout(() => {
    ctxMenu.value = null;
    ctxMenuClosing.value = false;
    ctxMenuCloseTimer = null;
  }, 200);
}

function onCtxMenuAnimEnd(e: AnimationEvent) {
  if (e.animationName !== 'match-ctxmenu-out') return;
  if (!ctxMenuClosing.value) return;
  if (ctxMenuCloseTimer) {
    clearTimeout(ctxMenuCloseTimer);
    ctxMenuCloseTimer = null;
  }
  ctxMenu.value = null;
  ctxMenuClosing.value = false;
}

function onCtxMenuOutside(e: MouseEvent) {
  if (e.button !== 0) return;
  const t = e.target as HTMLElement | null;
  if (t?.closest('.match-context-menu')) return;
  closeCtxMenu({ armClickThrough: true });
}

function onCtxMenuKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && ctxMenu.value) {
    e.preventDefault();
    e.stopPropagation();
    closeCtxMenu();
  }
}

function onCtxMenuScrollOrResize() {
  if (ctxMenu.value) closeCtxMenu();
}

function bindCtxMenuListeners() {
  if (ctxMenuListenersBound) return;
  ctxMenuListenersBound = true;
  document.addEventListener('mousedown', onCtxMenuOutside, true);
  document.addEventListener('keydown', onCtxMenuKeydown, true);
  window.addEventListener('resize', onCtxMenuScrollOrResize);
}

function unbindCtxMenuListeners() {
  if (!ctxMenuListenersBound) return;
  ctxMenuListenersBound = false;
  document.removeEventListener('mousedown', onCtxMenuOutside, true);
  document.removeEventListener('keydown', onCtxMenuKeydown, true);
  window.removeEventListener('resize', onCtxMenuScrollOrResize);
}

function onListScroll() {
  onScroll();
  if (ctxMenu.value) closeCtxMenu();
}

function onRowContextMenu(e: MouseEvent, m: MatchRecord) {
  e.preventDefault();
  e.stopPropagation();
  // Windows-like: right-click selects the row first, then show folder action.
  focusedId.value = m.matches_id;
  keyboardModality.value = false;
  listRef.value?.focus({ preventScroll: true });
  if (detail.selectedMatch?.matches_id !== m.matches_id) {
    void router.push({ name: 'detail', params: { id: m.matches_id } });
  }
  openCtxMenu({
    x: e.clientX,
    y: e.clientY,
    kind: 'folder',
    videoPath: firstMatchVideoPath(m),
  });
}

function onListContextMenu(e: MouseEvent) {
  const t = e.target as HTMLElement | null;
  if (t?.closest('.match-row')) return; // row handler owns it
  e.preventDefault();
  openCtxMenu({ x: e.clientX, y: e.clientY, kind: 'scan' });
}

function onCtxOpenFolder() {
  const path = ctxMenu.value?.kind === 'folder' ? ctxMenu.value.videoPath : null;
  closeCtxMenu();
  if (!path) {
    ui.showToast('该对局没有本地视频路径', 'error');
    return;
  }
  invoke('reveal_in_explorer', { path }).catch((err) => {
    ui.showToast(`打开资源管理器失败: ${err}`, 'error');
  });
}

function onCtxScan() {
  closeCtxMenu();
  void onScrape();
}

/** Esc clears selection when no higher modal/menu is open (bubble phase). */
function onDocEscClearSelection(e: KeyboardEvent) {
  if (e.key !== 'Escape') return;
  if (e.defaultPrevented) return;
  if (ctxMenu.value) return;
  // Higher layers use capture + stopPropagation; also guard by DOM presence.
  if (document.querySelector('.settings-modal-backdrop:not(.is-closing)')) return;
  if (document.querySelector('.update-modal-backdrop')) return;
  if (document.querySelector('.player-backdrop')) return;
  if (document.querySelector('.share-modal-backdrop')) return;
  if (document.querySelector('.event-list-modal-backdrop')) return;
  if (document.querySelector('.scan-progress-root')) return;
  if (!clearMatchSelection()) return;
  e.preventDefault();
}

onMounted(() => {
  document.addEventListener('keydown', onDocEscClearSelection);
});

onUnmounted(() => {
  document.removeEventListener('keydown', onDocEscClearSelection);
  unbindCtxMenuListeners();
  if (ctxMenuCloseTimer) clearTimeout(ctxMenuCloseTimer);
  if (killClickThrough) {
    document.removeEventListener('click', killClickThrough, true);
    killClickThrough = null;
  }
});
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

/* Listbox owns focus; option active state is painted on MatchCard.
   Suppress the container outline so it does not double with the row ring. */
.match-list:focus,
.match-list:focus-visible {
  outline: none;
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
</style>

<!-- Teleported menu is outside scoped root; unscoped block with unique class names -->
<style>
.match-context-menu {
  position: fixed;
  z-index: 2000;
  background: var(--surface-2);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  padding: 4px;
  min-width: 180px;
  transform-origin: top left;
  animation: match-ctxmenu-in 160ms cubic-bezier(0.16, 1, 0.3, 1) both;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}
.match-context-menu.is-closing {
  animation: match-ctxmenu-out 120ms cubic-bezier(0.7, 0, 0.84, 0) both;
  pointer-events: none;
}
@keyframes match-ctxmenu-in {
  from { opacity: 0; transform: scale(0.96); }
  to   { opacity: 1; transform: scale(1); }
}
@keyframes match-ctxmenu-out {
  from { opacity: 1; transform: scale(1); }
  to   { opacity: 0; transform: scale(0.97); }
}
.match-context-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 12px;
  text-align: left;
  font: inherit;
  font-size: 13px;
  font-family: var(--font-sans);
  color: var(--ink-2);
  background: transparent;
  border: 0;
  border-radius: 4px;
  cursor: pointer;
  transition: background 80ms ease-out, color 80ms ease-out;
}
.match-context-item-label {
  flex: 1;
  min-width: 0;
}
.match-context-item:hover:not(:disabled),
.match-context-item:focus-visible:not(:disabled) {
  background: var(--surface-3);
  color: var(--ink);
  outline: none;
}
.match-context-item:disabled {
  opacity: 0.45;
  cursor: default;
}
</style>
