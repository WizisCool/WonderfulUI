<template>
  <Transition name="boot-fade">
    <div v-if="visible" class="scan-progress-root" :class="mode" role="status" aria-live="polite">
      <div class="scan-progress">
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
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { listen, type UnlistenFn } from '../../tauri-adapter.ts';
import { pulseRendererForMotion } from '../../utils/render-pulse.ts';
import { useUiStore } from '../../stores/ui.ts';

const brandLogoUrl = new URL('../../assets/logo.svg', import.meta.url).href;
const ui = useUiStore();

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
  disposed = false;
  completePromise = null;
  mode.value = opts.mode ?? 'boot';
  label.value = opts.initialLabel ?? '正在打开 WonderfulUI…';
  pct.value = opts.initialPct ?? 5;
  visible.value = true;
  requestAnimationFrame(() => {
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

watch(() => ui.scanOverlayVisible, (v) => {
  if (v) {
    start({ mode: 'overlay', initialLabel: ui.scanOverlayLabel, initialPct: ui.scanOverlayPct });
  } else {
    complete();
  }
});

watch(() => ui.scanOverlayLabel, (l) => { update(l); });
watch(() => ui.scanOverlayPct, (p) => { pct.value = p; });

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

.scan-progress-root {
  position: fixed;
  inset: 0;
  z-index: 1600;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg);
  pointer-events: auto;
}

.scan-progress {
  width: 100%;
}

.boot-panel {
  max-width: 540px;
  margin: auto;
  padding: 24px 32px;
  display: flex; flex-direction: column; align-items: center;
  gap: 16px;
  box-sizing: border-box;
  width: 100%;
}
.boot-brand {
  display: flex; align-items: center; gap: 10px;
  font-weight: var(--w-bold);
  font-size: 22px;
  letter-spacing: 0.01em;
}
.boot-brand .brand-logo {
  width: 32px;
  height: 32px;
  flex: 0 0 auto;
}
.boot-brand .brand-name-base,
.boot-brand .brand-name-accent {
  font-size: 22px;
  font-weight: var(--w-bold);
}
.boot-progress {
  width: 100%; height: 6px;
  background: var(--surface-2);
  border-radius: 999px;
  overflow: hidden;
  position: relative;
}
.boot-progress::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    transparent 0%,
    oklch(1 0 0 / 0.18) 50%,
    transparent 100%
  );
  animation: boot-shimmer 1.6s linear infinite;
  pointer-events: none;
}
.boot-progress-fill {
  height: 100%;
  width: 100%;
  background: var(--accent);
  border-radius: 999px;
  transform-origin: left center;
  transform: scaleX(0);
  transition: transform 500ms cubic-bezier(0.4, 0, 0.2, 1);
  will-change: transform;
  position: relative;
}
@keyframes boot-shimmer {
  from { transform: translateX(-100%); }
  to   { transform: translateX(100%); }
}
.boot-status {
  color: var(--ink-3);
  font-size: 13px;
  text-align: center;
  min-height: 18px;
}
.boot-openid {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--ink-2);
  overflow-x: auto;
  white-space: nowrap;
  scrollbar-width: thin;
  padding-bottom: 2px;
}
.boot-stepper {
  display: flex; gap: 8px; justify-content: center;
  padding: 12px 0 0;
  border-top: 1px solid var(--border-soft);
  margin-top: 4px;
}

</style>
