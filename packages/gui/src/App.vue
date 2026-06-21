<template>
  <Teleport to="body">
    <BootOverlay ref="bootRef" />
  </Teleport>
  <div v-if="booted" class="app" :class="{ 'is-filter-open': filter.filterBarOpen }">
    <TopBar />
    <div class="panes">
      <AccountSidebar />
      <FilterRail v-if="filter.filterBarOpen" @close="filter.setFilterBarOpen(false)" />
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
import { watch, onMounted, onUnmounted, ref } from 'vue';
import { useAccountStore } from './stores/account.ts';
import { useTooltip } from './composables/useTooltip.ts';

const filter = useFilterStore();
const account = useAccountStore();
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

const tooltip = useTooltip();

function tipTarget(e: MouseEvent): HTMLElement | null {
  return (e.target as HTMLElement).closest('[data-tip]') as HTMLElement | null;
}

function onDocMouseOver(e: MouseEvent) {
  const el = tipTarget(e);
  if (!el?.dataset.tip) return;
  const related = e.relatedTarget as HTMLElement | null;
  if (related && el.contains(related)) return;
  tooltip.schedule(el, el.dataset.tip, e.clientX);
}

function onDocMouseMove(e: MouseEvent) {
  if (!tooltip.visible.value) return;
  const el = tipTarget(e);
  if (el) tooltip.reposition(e.clientX);
}

function onDocMouseOut(e: MouseEvent) {
  const el = tipTarget(e);
  if (!el) return;
  const related = e.relatedTarget as HTMLElement | null;
  if (related && el.contains(related)) return;
  tooltip.hide();
}

onMounted(() => {
  document.addEventListener('mouseover', onDocMouseOver, { passive: true });
  document.addEventListener('mousemove', onDocMouseMove, { passive: true });
  document.addEventListener('mouseout', onDocMouseOut, { passive: true });
});

onUnmounted(() => {
  document.removeEventListener('mouseover', onDocMouseOver);
  document.removeEventListener('mousemove', onDocMouseMove);
  document.removeEventListener('mouseout', onDocMouseOut);
});
</script>

<style scoped>
</style>
