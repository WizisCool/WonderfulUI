<template>
  <div class="app" :class="{ 'is-filter-open': filter.filterBarOpen }">
    <TopBar />
    <div class="panes">
      <AccountSidebar />
      <FilterRail v-if="filter.filterBarOpen" />
      <RouterView />
      <DetailView />
    </div>
    <ToastHost />
    <SettingsView />
  </div>
</template>

<script setup lang="ts">
import { RouterView } from 'vue-router';
import { useFilterStore } from './stores/filter.ts';
import TopBar from './components/layout/TopBar.vue';
import AccountSidebar from './components/common/AccountSidebar.vue';
import FilterRail from './components/match/FilterRail.vue';
import ToastHost from './components/common/ToastHost.vue';
import DetailView from './views/DetailView.vue';
import SettingsView from './views/SettingsView.vue';
import { watch, onMounted } from 'vue';
import { useAccountStore } from './stores/account.ts';
import { useSettingsStore } from './stores/settings.ts';

const filter = useFilterStore();
const account = useAccountStore();
const settings = useSettingsStore();

onMounted(async () => {
  try {
    await account.scanShell();
    await account.loadLibrary();
    await account.cacheAssets();
    if (account.realAccounts.length > 0) {
      account.selectAccount('__all__');
    }
  } catch (e) {
    console.error('Boot failed:', e);
  }
});
</script>

<style scoped>
</style>
