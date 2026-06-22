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
import { watch, onMounted, onUnmounted, ref, computed } from 'vue';
import { useAccountStore } from './stores/account.ts';
import { useUiStore } from './stores/ui.ts';
import { useTooltip } from './composables/useTooltip.ts';
import { listen } from './tauri-adapter.ts';

const filter = useFilterStore();
const account = useAccountStore();
const ui = useUiStore();
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
  account.bootScraping = true;
  let unlistenScrape: (() => void) | null = null;
  try {
    bootRef.value?.start({ mode: 'boot' });
    // 1) Probe the ACLOS WonderfulDb directory (read-only, cheap).
    await account.probeAclos();
    // 2) Load whatever the local SQLite library has, regardless of the
    // probe. The user may have a previous partial library; the
    // onboarding screen is what we render in front of it.
    await account.scanShell();
    await account.loadLibrary();
    await account.cacheAssets();
    if (account.realAccounts.length > 0) {
      account.selectAccount('__all__');
    }
    // scan_shell spawns a background scrape. We do not block on it —
    // BootOverlay's progress is enough for the boot screen — but we do
    // need to know when it is done so the match list stops showing the
    // loading view. Wait for the wui://scrape_summary event that the
    // scraper emits at the end of the sweep (it fires regardless of
    // whether anything was found), with a safety timeout in case the
    // scrape never reports back.
    unlistenScrape = await waitForBackgroundScrape();
    booted.value = true;
    bootRef.value?.complete();
  } catch (e) {
    console.error('Boot failed:', e);
    bootError.value = (e as Error)?.message ?? String(e);
    ui.showToast(`启动失败: ${bootError.value}`, 'error');
    // Even on error, reveal the app so the user can open Settings and
    // inspect what went wrong. The onboarding screen still appears if
    // the probe said ACLOS is missing.
    booted.value = true;
    bootRef.value?.complete();
  } finally {
    if (unlistenScrape) unlistenScrape();
    account.bootScraping = false;
  }
}

/**
 * Subscribe to the next `wui://scrape_summary` event from the background
 * scrape that `scan_shell` spawns on the Rust side, with a hard
 * fallback timeout so the user is never stranded on the loading view
 * if the scraper silently fails to report completion.
 */
async function waitForBackgroundScrape(): Promise<() => void> {
  const BOOT_SCRAPE_TIMEOUT_MS = 12_000;
  return new Promise<() => void>((resolve) => {
    let done = false;
    let unlisten: (() => void) | null = null;
    const finish = () => {
      if (done) return;
      done = true;
      if (unlisten) unlisten();
      resolve(() => { /* no-op for the caller; we already unlistened */ });
    };
    const timer = window.setTimeout(finish, BOOT_SCRAPE_TIMEOUT_MS);
    listen<unknown>('wui://scrape_summary', () => {
      window.clearTimeout(timer);
      finish();
    }).then((u) => {
      if (done) {
        // We already resolved via timeout; drop the listener.
        u();
      } else {
        unlisten = u;
      }
    }).catch(() => {
      // listen() failed: still let the timeout fire so we do not hang.
      window.clearTimeout(timer);
      finish();
    });
  });
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
