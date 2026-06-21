<template>
  <Teleport to="body">
    <BootOverlay ref="bootRef" />
  </Teleport>
  <div v-if="booted" class="app" :class="{ 'is-filter-open': filter.filterBarOpen }">
    <TopBar />
    <div class="panes">
      <AccountSidebar />
      <FilterRail v-if="filter.filterBarOpen" />
      <RouterView />
      <DetailView />
    </div>
    <Teleport to="#player-host">
      <PlayerHost />
    </Teleport>
    <ToastHost />
    <SettingsView />
  </div>
</template>

<script setup lang="ts">
import { RouterView } from 'vue-router';
import { useFilterStore } from './stores/filter.ts';
import TopBar from './components/layout/TopBar.vue';
import BootOverlay from './components/common/BootOverlay.vue';
import PlayerHost from './components/player/PlayerHost.vue';
import AccountSidebar from './components/common/AccountSidebar.vue';
import FilterRail from './components/match/FilterRail.vue';
import ToastHost from './components/common/ToastHost.vue';
import DetailView from './views/DetailView.vue';
import SettingsView from './views/SettingsView.vue';
import { watch, onMounted, ref } from 'vue';
import { useAccountStore } from './stores/account.ts';
import { useSettingsStore } from './stores/settings.ts';

const filter = useFilterStore();
const account = useAccountStore();
const settings = useSettingsStore();
const bootRef = ref<InstanceType<typeof BootOverlay> | null>(null);
const booted = ref(false);

onMounted(async () => {
  try {
    bootRef.value?.start({ mode: 'boot' });
    await account.scanShell();
    await account.loadLibrary();
    await account.cacheAssets();
    booted.value = true;
    bootRef.value?.complete();
    if (account.realAccounts.length > 0) {
      account.selectAccount('__all__');
    }
  } catch (e) {
    console.error('Boot failed:', e);
    booted.value = true;
    bootRef.value?.complete();
  }
});
</script>

<style scoped>
</style>
