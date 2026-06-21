<template>
  <aside class="pane accounts" aria-label="账户列表">
    <div class="pane-head">
      <span class="pane-title">账户</span>
      <span class="pane-sub">{{ realCount }} 个</span>
    </div>
    <div v-if="realCount === 0" class="empty">
      <div class="empty-title">没有找到账户</div>
      <div class="empty-sub">
        默认目录 <code>%APPDATA%\ACLOS\WonderfulDb</code> 下没有任何数据。
      </div>
    </div>
    <div v-else class="account-list" role="listbox">
      <div
        v-if="allRow.some(a => a.openid === ALL_ACCOUNTS)"
        class="account is-all"
        :class="rowClass(allRow.find(a => a.openid === ALL_ACCOUNTS)!)"
        role="option"
        aria-selected="false"
        tabindex="0"
        :data-account-id="ALL_ACCOUNTS"
        :data-tip="rowTip(allRow.find(a => a.openid === ALL_ACCOUNTS)!)"
        @click="onSelect(ALL_ACCOUNTS)"
      >
        <span class="account-main">
          <span class="account-name">全部</span>
        </span>
        <span class="account-count">{{ countText(allRow.find(a => a.openid === ALL_ACCOUNTS)!) }}</span>
      </div>
      <div class="account-sortable-list" role="presentation">
        <div v-for="a in allRow.filter(x => x.openid !== ALL_ACCOUNTS)" :key="a.openid"
        class="account"
        :class="rowClass(a)"
        role="option"
        :aria-selected="String(a.openid === account.selectedAccountId)"
        tabindex="0"
        :data-account-id="a.openid"
        :data-tip="rowTip(a)"
        @click="onSelect(a.openid)"
      >
        <span class="account-main">
          <span v-if="a.openid !== ALL_ACCOUNTS" class="account-grip" aria-hidden="true">
            <WIcon icon="ph:dots-six-vertical" :size="13" />
          </span>
          <input
            v-if="editingOpenid === a.openid"
            ref="renameInputRef"
            class="account-rename-input"
            type="text"
            v-model="renameValue"
            placeholder="昵称#编号"
            aria-label="账户显示名"
            @blur="commitRename(a)"
            @keydown.enter="($event.target as HTMLInputElement).blur()"
            @keydown.escape.stop="cancelRename()"
          />
          <span v-else class="account-name">{{ a.openid === ALL_ACCOUNTS ? '全部' : accountLabel(a) }}</span>
        </span>
        <button
          v-if="a.openid !== ALL_ACCOUNTS"
          class="account-edit-btn"
          type="button"
          aria-label="重命名账户"
          :data-action="'rename-account'"
          :data-account-id="a.openid"
          @click.stop="startRename(a)"
        >
          <WIcon icon="ph:pencil-simple" :size="12" />
        </button>
        <span class="account-count">{{ countText(a) }}</span>
      </div>
      </div>
    </div>
    <div class="pane-foot">
      <button
        class="pane-foot-item"
        type="button"
        aria-label="设置"
        :data-tip="'设置'"
        @click="settings.setOpen(true)"
      >
        <WIcon icon="ph:gear" :size="14" />
        <span>设置</span>
      </button>
      <span class="pane-foot-version">v{{ APP_VERSION }}</span>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import WIcon from './WIcon.vue';
import Sortable from 'sortablejs';
import { useAccountStore, ALL_ACCOUNTS, type Account } from '../../stores/account.ts';
import { useFilterStore } from '../../stores/filter.ts';
import { useSettingsStore } from '../../stores/settings.ts';
import { APP_VERSION } from '../../utils/version.ts';

const account = useAccountStore();
const filterStore = useFilterStore();
const settings = useSettingsStore();

const editingOpenid = ref<string | null>(null);
const renameValue = ref('');
const renameInputRef = ref<HTMLInputElement | null>(null);
let sortable: Sortable | null = null;

const realCount = computed(() =>
  account.realAccounts.length
);

const filteredCounts = computed(() =>
  filterStore.filteredAccountCounts(account.matches, account.realAccounts)
);

const hasActiveFilters = computed(() => filterStore.activeCount > 0);

const allRow = computed(() => account.accountsForRender);

function accountLabel(a: Account): string {
  return account.accountLabels.get(a.openid) ?? a.openid;
}

function countText(a: Account): string {
  if (a.openid === ALL_ACCOUNTS) {
    const fc = filteredCounts.value.get(ALL_ACCOUNTS) ?? account.matches.length;
    return hasActiveFilters.value ? `${fc} / ${account.matches.length}` : `${account.matches.length}`;
  }
  if (a.error) return '!';
  const fc = filteredCounts.value.get(a.openid) ?? a.matchCount;
  return hasActiveFilters.value ? `${fc} / ${a.matchCount}` : `${a.matchCount}`;
}

function rowTip(a: Account): string {
  if (a.openid === ALL_ACCOUNTS) {
    const fc = filteredCounts.value.get(ALL_ACCOUNTS) ?? account.matches.length;
    return hasActiveFilters.value ? `所有账户的高光\n${fc} / ${account.matches.length} 条命中` : `所有账户的高光\n${account.matches.length} 条高光`;
  }
  if (a.error) return a.error;
  const label = accountLabel(a);
  const cnt = countText(a);
  return hasActiveFilters.value
    ? `${label}\n${cnt} 条命中\nopenid · ${a.openid}`
    : `${label}\n${cnt} 条高光\nopenid · ${a.openid}`;
}

function rowClass(a: Account): Record<string, boolean> {
  const fc = filteredCounts.value.get(a.openid);
  return {
    'is-selected': a.openid === account.selectedAccountId,
    'is-error': !!a.error,
    'is-all': a.openid === ALL_ACCOUNTS,
    'is-editing': editingOpenid.value === a.openid,
    'is-filter-empty': hasActiveFilters.value && (fc ?? 0) === 0 && a.openid !== account.selectedAccountId,
  };
}

function onSelect(openid: string) {
  if (editingOpenid.value) return;
  account.selectAccount(openid);
}

function startRename(a: Account) {
  editingOpenid.value = a.openid;
  renameValue.value = a.customName ?? '';
  nextTick(() => {
    renameInputRef.value?.focus();
    renameInputRef.value?.select();
  });
}

function cancelRename() {
  editingOpenid.value = null;
}

async function commitRename(a: Account) {
  const val = renameValue.value.trim();
  try {
    await account.renameAccount(a.openid, val || null);
  } catch {
    return;
  }
  editingOpenid.value = null;
}

function initSortable() {
  const list = document.querySelector<HTMLElement>(`.pane.accounts ${sortableListSelector}`);
  if (!list) return;
  sortable = new Sortable(list, {
    draggable: '.account:not(.is-all):not(.is-editing)',
    handle: '.account-grip',
    animation: 150,
    easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
    direction: 'vertical',
    ghostClass: 'account-sortable-ghost',
    chosenClass: 'account-sortable-chosen',
    dragClass: 'account-sortable-drag',
    fallbackClass: 'account-sortable-fallback',
    forceFallback: true,
    fallbackOnBody: true,
    onStart: () => {
      document.querySelector('.pane.accounts')?.classList.add('is-account-sorting');
    },
    onEnd: () => {
      document.querySelector('.pane.accounts')?.classList.remove('is-account-sorting');
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>(`.pane.accounts ${sortableListSelector}`);
        if (!el) return;
        const order = Array.from(el.querySelectorAll<HTMLElement>('.account[data-account-id]'))
          .map(el => el.dataset.accountId!)
          .filter(id => id !== ALL_ACCOUNTS);
        if (order.length > 0) {
          sortable?.destroy();
          sortable = null;
          account.saveAccountOrder(order).then(() => {
            nextTick(() => initSortable());
          }).catch(() => { nextTick(() => initSortable()); });
        }
      });
    },
  });
}

const sortableListSelector = '.account-sortable-list';

onMounted(() => {
  nextTick(() => initSortable());
});

onUnmounted(() => {
  sortable?.destroy();
  sortable = null;
});
</script>

<style scoped>
.account-list {
  list-style: none; padding: 6px 0; margin: 0;
  overflow-y: auto; flex: 1;
  min-height: 0;
}
.account-sortable-list {
  min-height: 0;
}
.account {
  display: flex; align-items: center; justify-content: space-between;
  gap: 6px;
  padding: 8px var(--pad);
  border-left: 2px solid transparent;
  cursor: pointer;
  transition: background 80ms ease-out, border-color 80ms ease-out, opacity 80ms ease-out;
}
.account:hover { background: var(--surface-2); }
.account.is-selected {
  background: var(--surface-2);
  border-left-color: var(--accent);
}
.account-main {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  flex: 1;
}
.account-grip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin-left: -9px;
  margin-right: 1px;
  color: var(--ink-4);
  cursor: grab;
  flex: 0 0 auto;
  touch-action: none;
  user-select: none;
}
.account-sortable-chosen .account-grip,
.account-sortable-drag .account-grip,
.account:active .account-grip { cursor: grabbing; }
.account-name { font-family: var(--font-sans); font-size: 13px; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.account-edit-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  color: var(--ink-3);
  opacity: 0;
  flex: 0 0 auto;
  transition: opacity 80ms ease-out, background 80ms ease-out, color 80ms ease-out;
}
.account:hover .account-edit-btn,
.account.is-editing .account-edit-btn,
.account-edit-btn:focus-visible {
  opacity: 1;
}
.account-edit-btn:hover {
  background: var(--surface-3);
  color: var(--ink);
}
.account-rename-input {
  width: 100%;
  min-width: 0;
  height: 24px;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--ink);
  font-family: var(--font-sans);
  font-size: 13px;
}
.account-rename-input:focus {
  border-color: var(--accent);
  outline: none;
}
.account-sortable-chosen {
  position: relative;
  z-index: 1;
  background: var(--surface-2);
  border-left-color: var(--accent);
}
.account-sortable-ghost {
  opacity: 0.36;
  background: var(--surface-3);
  border-left-color: var(--accent);
}
.account-sortable-ghost .account-main,
.account-sortable-ghost .account-count,
.account-sortable-ghost .account-edit-btn {
  opacity: 0.42;
}
.account-sortable-drag {
  box-sizing: border-box;
  background: var(--surface-3);
  border-left-color: var(--accent);
  opacity: 0.98;
  cursor: grabbing;
}
.account-sortable-fallback {
  box-sizing: border-box;
  background: var(--surface-3);
  border-left-color: var(--accent);
  opacity: 0.98;
  cursor: grabbing;
  pointer-events: none;
}
.accounts.is-account-sorting .account {
  transition:
    background 80ms ease-out,
    border-color 80ms ease-out,
    opacity 80ms ease-out,
    transform 150ms cubic-bezier(0.16, 1, 0.3, 1);
}
.account-count {
  color: var(--ink-3);
  font-size: 12px;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  margin-left: 8px;
}
.account.is-error .account-name { color: var(--ink-3); text-decoration: line-through; }
.account.is-error .account-count { color: var(--warn); }
.account.is-filter-empty:not(.is-selected) .account-name {
  color: var(--ink-3);
}
.account.is-filter-empty:not(.is-selected) .account-count {
  color: var(--ink-4);
}
.account.is-all {
  border-bottom: 1px solid var(--border-soft);
  margin-bottom: 2px;
  cursor: pointer;
}
.account.is-all .account-name { font-weight: var(--w-semibold); }
.account.is-all .account-main { gap: 0; }

.pane-foot {
  display: flex; align-items: center; justify-content: space-between;
  height: 40px;
  padding: 0 var(--pad);
  border-top: 1px solid var(--border-soft);
  background: var(--surface);
  flex-shrink: 0;
}
.pane-foot-item {
  display: inline-flex; align-items: center; gap: 5px;
  color: var(--ink-3);
  font-family: var(--font-sans);
  font-size: 12px;
  border-radius: var(--radius);
  padding: 4px 7px;
  transition: color 80ms ease-out, background 80ms ease-out;
}
.pane-foot-item:hover {
  color: var(--ink);
  background: var(--surface-2);
}
.pane-foot-version {
  color: var(--ink-4);
  font-family: var(--font-sans);
  font-size: 12px;
  user-select: text;
}
</style>
