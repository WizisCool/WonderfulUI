<template>
  <Teleport to="body">
    <BootOverlay ref="bootRef" />
  </Teleport>
  <div v-if="booted" class="app" :class="{ 'is-filter-open': filter.filterBarOpen }">
    <OnboardingView v-if="showOnboarding" @retry="retryBoot" />
    <template v-else>
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
      <UpdateModal />
    </template>
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
import OnboardingView from './components/common/OnboardingView.vue';
import UpdateModal from './components/update/UpdateModal.vue';
import { watch, onMounted, onUnmounted, ref, computed } from 'vue';
import { listen } from './tauri-adapter.ts';
import { useAccountStore } from './stores/account.ts';
import { useUiStore } from './stores/ui.ts';
import { useUpdateStore } from './stores/update.ts';
import { useTooltip } from './composables/useTooltip.ts';

const filter = useFilterStore();
const account = useAccountStore();
const ui = useUiStore();
const update = useUpdateStore();
const bootRef = ref<InstanceType<typeof BootOverlay> | null>(null);
const booted = ref(false);
const bootError = ref<string | null>(null);

// First-run / onboarding gate. ACLOS WonderfulDb must exist AND contain at
// least one account file. If either is false, we render OnboardingView
// instead of the 3-pane shell — the existing panes would otherwise show
// four cold "empty" states stacked next to each other.
//
// Debug override: the developer-only `wui:debug.simulateFirstRun`
// localStorage key (and the equivalent `?simulate-first-run=1` URL flag
// for the browser debug runtime) force the onboarding view regardless
// of the real ACLOS state. This lets us re-exercise the onboarding flow
// without uninstalling ACLOS or moving the WonderfulDb directory.
// There is no UI toggle for this; it is a developer aid only.
const simulateFirstRun = ref<boolean>((() => {
  try {
    if (typeof window !== 'undefined') {
      const url = new URLSearchParams(window.location.search);
      if (url.get('simulate-first-run') === '1') return true;
      if (url.get('simulate-first-run') === '0') return false;
    }
    return localStorage.getItem('wui:debug.simulateFirstRun') === '1';
  } catch {
    return false;
  }
})());

const showOnboarding = computed(() => {
  if (simulateFirstRun.value) return true;
  const s = account.aclosStatus;
  if (!s) return false; // still probing
  return !s.dirExists || !s.hasAccounts;
});

async function runBoot() {
  bootError.value = null;
  try {
    bootRef.value?.start({ mode: 'boot' });
    // 1) Probe the ACLOS WonderfulDb directory (read-only, cheap).
    await account.probeAclos();

    // 2) Subscribe to scrape_summary *before* scanShell so we don't
    // miss the event when the background scrape finishes. scanShell
    // spawns a background thread in Rust that writes to SQLite and
    // emits wui://scrape_summary when done. On the first launch the
    // local library is empty, so we must keep the BootOverlay visible
    // until the scrape settles — otherwise the user sees a flash of
    // the empty "还没有高光" state while scraping is still running.
    let resolveScrape: () => void;
    const scrapeComplete = new Promise<void>(r => { resolveScrape = r; });
    const safetyTimer = setTimeout(() => resolveScrape(), 30_000);
    const unlisten = await listen<Record<string, unknown>>('wui://scrape_summary', () => {
      clearTimeout(safetyTimer);
      resolveScrape();
    });

    account.scraping = true;
    try {
      await account.scanShell();
      await account.loadLibrary();

      // Wait for the background scrape to finish.
      await scrapeComplete;
    } finally {
      unlisten();
      account.scraping = false;
    }

    // 3) Reload library now that scrape has settled so the view has
    // fresh accounts + matches.
    await account.loadLibrary();
    await account.cacheAssets();
    if (account.realAccounts.length > 0) {
      account.selectAccount('__all__');
    }
    booted.value = true;
    bootRef.value?.complete();
    // 启动静默更新检查。必须在 runBoot 显露 UI 之后调用，不与后台抓取竞争
    // （CLAUDE.md / docs/UPDATER.md「启动检查时机」）。失败静默，只亮侧栏红点
    // 不开弹窗；fire-and-forget，不阻塞 UI 显露后的稳定状态。
    update.checkForUpdate(true).catch(() => {});
  } catch (e) {
    console.error('Boot failed:', e);
    bootError.value = (e as Error)?.message ?? String(e);
    ui.showToast(`启动失败: ${bootError.value}`, 'error');
    // Even on error, reveal the app so the user can open Settings and
    // inspect what went wrong. The onboarding screen still appears if
    // the probe said ACLOS is missing.
    account.scraping = false;
    booted.value = true;
    bootRef.value?.complete();
  }
}

async function retryBoot() {
  await runBoot();
}

onMounted(() => {
  void runBoot();
});

// When the user picks a different directory later (settings modal), the
// store will refresh aclosStatus. Re-render automatically: the
// computed re-evaluates and the onboarding view swaps in or out.
watch(() => account.aclosStatus, () => { /* trigger showOnboarding */ });

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
