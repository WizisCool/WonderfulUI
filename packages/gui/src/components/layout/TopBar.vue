<template>
  <header class="topbar">
    <div class="brand">
      <img class="brand-logo" :src="brandLogoUrl" alt="" aria-hidden="true" width="36" height="36" decoding="async" />
      <span class="brand-wordmark" aria-label="WonderfulUI">
        <span class="brand-name brand-name-base">Wonderful</span>
        <span class="brand-name brand-name-accent">UI</span>
      </span>
    </div>
    <div class="topbar-center">
      <input
        class="search"
        type="text"
        placeholder="搜索 英雄 / 地图 / 模式 / 短码"
        :value="filter.filters.query"
        aria-label="搜索高光"
        @input="onQueryInput"
        @keydown.escape="onQueryEscape"
      />
    </div>
    <div class="topbar-right">
      <button
        class="iconbtn scrape-btn"
        :class="{ 'is-loading': account.scraping }"
        :aria-label="account.scraping ? '正在扫描资料库' : scanLabel + '资料库'"
        :data-tip="account.scraping ? '正在扫描资料库' : scanLabel + '资料库'"
        type="button"
        :disabled="account.scraping"
        @click="onScrape"
      >
        <RefreshCw :size="16" />
      </button>
      <button
        class="iconbtn settings-btn"
        :class="{ 'is-active': settings.isOpen }"
        aria-label="设置"
        data-tip="设置"
        type="button"
        @click="router.push({ name: 'settings' })"
      >
        <Settings :size="16" />
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { RefreshCw, Settings } from 'lucide-vue-next';
import { useAccountStore } from '../../stores/account.ts';
import { useFilterStore } from '../../stores/filter.ts';
import { useSettingsStore } from '../../stores/settings.ts';

const account = useAccountStore();
const filter = useFilterStore();
const settings = useSettingsStore();

const router = useRouter();

const brandLogoUrl = new URL('../../assets/logo.svg', import.meta.url).href;

const scanLabel = computed(() => filter.refreshScanMode === 'full' ? '全量扫描' : '增量扫描');

function onQueryInput(e: Event) {
  filter.setFilters({ query: (e.target as HTMLInputElement).value });
}

function onQueryEscape(e: Event) {
  filter.setFilters({ query: '' });
  (e.target as HTMLInputElement).value = '';
}

async function onScrape() {
  await account.scrapeLibrary(filter.refreshScanMode);
  (window as unknown as Record<string, unknown>).__wuiToast?.('资料库已' + scanLabel.value, 'ok');
}
</script>

<style scoped>
.topbar {
  display: grid;
  grid-template-columns: var(--pane-l) 1fr var(--pane-r);
  align-items: center;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  padding: 0 var(--pad);
  min-width: 0;
}
.topbar > * { min-width: 0; }
.topbar-center { padding: 0 24px; }
.search {
  width: 100%;
  max-width: 480px;
  background: var(--bg);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  padding: 6px 10px;
  color: var(--ink);
  font: inherit;
  font-size: 13px;
  transition: border-color 80ms ease-out;
}
.search::placeholder { color: var(--ink-3); }
.search:focus { border-color: var(--accent); outline: none; }
.topbar-right { display: flex; justify-content: flex-end; gap: 6px; }
.scrape-btn.is-loading svg {
  animation: spin 900ms linear infinite;
  transform-origin: center;
  transform-box: fill-box;
}

@media (prefers-reduced-motion: reduce) {
  .scrape-btn.is-loading svg {
    animation-duration: 1600ms;
  }
}
</style>
