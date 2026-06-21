<template>
  <Transition name="boot-fade">
    <div v-if="visible" class="scan-progress-root" :class="mode" role="status" aria-live="polite">
      <!-- Overlay mode: fixed fullscreen panel -->
      <div v-if="mode === 'overlay'" class="scan-progress">
        <div class="boot-panel">
          <div class="boot-brand">
            <img class="brand-logo" :src="brandLogoUrl" alt="" aria-hidden="true" width="36" height="36" decoding="async" />
            <span class="brand-wordmark">
              <span class="brand-name brand-name-base">Wonderful</span>
              <span class="brand-name brand-name-accent">UI</span>
            </span>
          </div>
          <div class="boot-progress">
            <div class="boot-progress-fill" :style="{ transform: `scaleX(${pct / 100})` }" />
          </div>
          <div class="boot-status">{{ label }}</div>
        </div>
      </div>
      <!-- Boot mode: full app skeleton -->
      <div v-else class="app scan-progress">
        <header class="topbar">
          <div class="brand">
            <img class="brand-logo" :src="brandLogoUrl" alt="" aria-hidden="true" width="36" height="36" decoding="async" />
            <span class="brand-wordmark">
              <span class="brand-name brand-name-base">Wonderful</span>
              <span class="brand-name brand-name-accent">UI</span>
            </span>
          </div>
        </header>
        <div class="panes">
          <main class="pane list full" aria-label="启动中">
            <div class="boot-panel">
              <div class="boot-brand">
                <img class="brand-logo" :src="brandLogoUrl" alt="" aria-hidden="true" width="36" height="36" decoding="async" />
                <span class="brand-wordmark">
                  <span class="brand-name brand-name-base">Wonderful</span>
                  <span class="brand-name brand-name-accent">UI</span>
                </span>
              </div>
              <div class="boot-progress">
                <div class="boot-progress-fill" :style="{ transform: `scaleX(${pct / 100})` }" />
              </div>
              <div class="boot-status">{{ label }}</div>
            </div>
          </main>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { listen, type UnlistenFn } from '../../tauri-adapter.ts';
import { pulseRendererForMotion } from '../../render-pulse.ts';

const brandLogoUrl = new URL('../../assets/logo.svg', import.meta.url).href;

const visible = ref(false);
const mode = ref<'boot' | 'overlay'>('boot');
const label = ref('正在打开 WonderfulUI…');
const pct = ref(5);

let unlisteners: UnlistenFn[] = [];
let disposed = false;

const FADE_OUT_MS = 280;
const HOLD_MS = 220;
const FADE_SAFETY_MS = 320;

function start(opts: { mode?: 'boot' | 'overlay'; skipAssetPreWarm?: boolean; initialLabel?: string; initialPct?: number } = {}) {
  if (disposed) return;
  mode.value = opts.mode ?? 'boot';
  label.value = opts.initialLabel ?? '正在打开 WonderfulUI…';
  pct.value = opts.initialPct ?? 5;
  visible.value = true;
  requestAnimationFrame(() => {
    if (disposed) return;
    pulseRendererForMotion(320);
  });
}

function update(newLabel: string, newPct?: number) {
  if (disposed) return;
  label.value = newLabel;
  if (newPct !== undefined) pct.value = newPct;
}

let completePromise: Promise<void> | null = null;
function complete(): Promise<void> {
  if (disposed) return Promise.resolve();
  if (completePromise) return completePromise;
  completePromise = (async () => {
    if (pct.value < 100) {
      label.value = '准备就绪';
      pct.value = 100;
    }
    await new Promise<void>(r => window.setTimeout(r, HOLD_MS));
    if (disposed) return;
    pulseRendererForMotion(340);
    visible.value = false;
    await new Promise<void>(r => window.setTimeout(r, FADE_SAFETY_MS));
    dispose();
  })();
  return completePromise;
}

function dispose() {
  if (disposed) return;
  disposed = true;
  for (const u of unlisteners) u();
  unlisteners = [];
}

async function wireEvents(skipAssetPreWarm: boolean) {
  dispose();
  disposed = false;

  unlisteners.push(await listen<Record<string, unknown>>('wui://phase', (event) => {
    const d = event.payload;
    const phase = (d.phase as string) || '';
    if (phase === 'scanning') update('正在扫描账户…', 12);
    else if (phase === 'loading_view') update('正在加载对局…', 80);
    else if (phase === 'caching_assets') update('正在准备素材…', 88);
    else if (phase === 'error') update(`错误: ${d.sub ?? '启动失败'}`, pct.value);
    else if (phase === 'done') update('准备就绪', 100);
  }));

  unlisteners.push(await listen<Record<string, unknown>>('wui://scrape_summary', () => {
    if (pct.value < 80) update('正在加载对局…', 80);
  }));

  unlisteners.push(await listen<Record<string, unknown>>('wui://account_started', (event) => {
    const d = event.payload;
    const cur = (d.current as number) ?? 0;
    const tot = (d.total as number) ?? 0;
    if (tot > 0) {
      const nextPct = Math.max(pct.value, Math.min(78, 12 + Math.round(cur / tot * 65)));
      update(`正在扫描账户…  ${cur} / ${tot}`, nextPct);
    }
  }));

  unlisteners.push(await listen<Record<string, unknown>>('wui://account_loaded', (event) => {
    const d = event.payload;
    const cur = (d.current as number) ?? 0;
    const tot = (d.total as number) ?? 0;
    if (tot > 0) {
      const nextPct = Math.max(pct.value, Math.min(78, 12 + Math.round(cur / tot * 65)));
      update(`正在扫描账户…  ${cur} / ${tot}`, nextPct);
    }
  }));

  if (!skipAssetPreWarm) {
    unlisteners.push(await listen<Record<string, unknown>>('wui://cache_asset_progress', (event) => {
      const d = event.payload;
      const idx = (d.index as number) ?? 0;
      const tot = (d.total as number) ?? 0;
      if (tot > 0) {
        const nextPct = Math.max(pct.value, 88 + Math.round(idx / tot * 11));
        update(`正在准备素材…  ${idx} / ${tot}`, nextPct);
      }
    }));
  }
}

onMounted(() => {
  wireEvents(false);
});

onUnmounted(() => {
  dispose();
});

defineExpose({ start, update, complete, dispose });
</script>

<style scoped>
.boot-fade-enter-active {
  transition: opacity 280ms cubic-bezier(0.4, 0, 0.2, 1);
}
.boot-fade-leave-active {
  transition: opacity 280ms cubic-bezier(0.4, 0, 0.2, 1);
}
.boot-fade-enter-from,
.boot-fade-leave-to {
  opacity: 0;
}

.scan-progress-root.overlay {
  position: fixed;
  inset: 0;
  z-index: 1600;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg);
  pointer-events: auto;
}

.scan-progress-root.overlay .scan-progress {
  opacity: 1;
}
</style>
