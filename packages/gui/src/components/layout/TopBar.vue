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
        @click="settings.setOpen(true)"
      >
        <Settings :size="16" />
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { RefreshCw, Settings } from 'lucide-vue-next';
import { useAccountStore } from '../../stores/account.ts';
import { useFilterStore } from '../../stores/filter.ts';
import { useSettingsStore } from '../../stores/settings.ts';

const account = useAccountStore();
const filter = useFilterStore();
const settings = useSettingsStore();

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
