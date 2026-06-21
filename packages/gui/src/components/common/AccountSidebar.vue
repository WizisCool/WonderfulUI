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
      <div v-for="a in allRow" :key="a.openid"
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
            <GripVertical :size="13" />
          </span>
          <input
            v-if="editingOpenid === a.openid"
            ref="renameInputRef"
            class="account-rename-input"
            type="text"
            :value="a.customName ?? ''"
            :placeholder="accountLabel(a)"
            aria-label="账户显示名"
            @blur="commitRename(a)"
            @keydown.enter="($event.target as HTMLInputElement).blur()"
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
          <Pencil :size="12" />
        </button>
        <span class="account-count">{{ countText(a) }}</span>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import { GripVertical, Pencil } from 'lucide-vue-next';
import Sortable from 'sortablejs';
import { useAccountStore, ALL_ACCOUNTS, type Account } from '../../stores/account.ts';
import { useFilterStore } from '../../stores/filter.ts';
import { accountDisplayLabel } from '../../utils/account-preferences.ts';

const account = useAccountStore();
const filterStore = useFilterStore();

const editingOpenid = ref<string | null>(null);
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

function unknownIndices(accounts: Account[]): Map<string, number> {
  const m = new Map<string, number>();
  let n = 0;
  for (const a of accounts) {
    if (a.openid === ALL_ACCOUNTS) continue;
    if (!a.nick && !a.customName?.trim()) { n++; m.set(a.openid, n); }
  }
  return m;
}

function accountLabel(a: Account): string {
  return accountDisplayLabel(a, unknownIndices(account.realAccounts).get(a.openid));
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
  nextTick(() => {
    const inp = document.querySelector(`[data-account-rename-input="${a.openid}"]`) as HTMLInputElement | null;
    inp?.focus();
    inp?.select();
  });
}

function commitRename(a: Account) {
  const inp = document.querySelector(`[data-account-rename-input="${a.openid}"]`) as HTMLInputElement | null;
  const val = inp?.value?.trim() ?? '';
  account.renameAccount(a.openid, val || null);
  editingOpenid.value = null;
}

const sortableListSelector = '.account-list';

onMounted(() => {
  nextTick(() => {
    const list = document.querySelector<HTMLElement>(`.pane.accounts ${sortableListSelector}`);
    if (!list) return;
    sortable = new Sortable(list, {
      draggable: '.account:not(.is-all)',
      handle: '.account-grip',
      animation: 150,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      ghostClass: 'account-sortable-ghost',
      chosenClass: 'account-sortable-chosen',
      dragClass: 'account-sortable-drag',
      fallbackClass: 'account-sortable-fallback',
      forceFallback: false,
      onStart: () => {
        document.querySelector('.pane.accounts')?.classList.add('is-account-sorting');
      },
      onEnd: () => {
        document.querySelector('.pane.accounts')?.classList.remove('is-account-sorting');
      },
      onUpdate: () => {
        const order = Array.from(list.querySelectorAll<HTMLElement>('.account[data-account-id]'))
          .map(el => el.dataset.accountId!)
          .filter(id => id !== ALL_ACCOUNTS);
        account.saveAccountOrder(order).catch(() => {});
      },
    });
  });
});

onUnmounted(() => {
  sortable?.destroy();
  sortable = null;
});
</script>

<style scoped></style>
