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
  </header>
</template>

<script setup lang="ts">
import { useFilterStore } from '../../stores/filter.ts';

const filter = useFilterStore();

const brandLogoUrl = new URL('../../assets/logo.svg', import.meta.url).href;

function onQueryInput(e: Event) {
  filter.setFilters({ query: (e.target as HTMLInputElement).value });
}

function onQueryEscape(e: Event) {
  filter.setFilters({ query: '' });
  (e.target as HTMLInputElement).value = '';
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
</style>
