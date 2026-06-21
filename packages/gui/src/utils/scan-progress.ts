import { pulseRendererForMotion } from './render-pulse.ts';
import { listen, type UnlistenFn } from '../tauri-adapter.ts';

const BRAND_LOGO_URL = new URL('../assets/logo.svg', import.meta.url).href;
const BRAND_NAME_BASE = 'Wonderful';
const BRAND_NAME_ACCENT = 'UI';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, children: (Node | string)[] = []): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('data-') || k === 'role' || k === 'tabindex' || k.startsWith('aria-') || k === 'title' || k === 'placeholder' || k === 'type') {
      node.setAttribute(k, v);
    } else {
      (node as unknown as Record<string, unknown>)[k] = v;
    }
  }
  for (const c of children) node.append(c);
  return node;
}

function brandLockup(): HTMLElement {
  return el('div', { class: 'brand' }, [
    el('img', {
      class: 'brand-logo',
      src: BRAND_LOGO_URL,
      alt: '',
      'aria-hidden': 'true',
      width: '36',
      height: '36',
      decoding: 'async',
    }),
    el('span', { class: 'brand-wordmark' }, [
      el('span', { class: 'brand-name brand-name-base' }, [BRAND_NAME_BASE]),
      el('span', { class: 'brand-name brand-name-accent' }, [BRAND_NAME_ACCENT]),
    ]),
  ]);
}

export interface ScanProgressOptions {
  /** Skip the 88→99% asset pre-warm phase (don't subscribe to
   *  `wui://cache_asset_progress`). Useful for in-app full scans
   *  where the asset cache is already warm from startup. */
  skipAssetPreWarm?: boolean;
  initialLabel?: string;
  initialPct?: number;
  /** `'boot'` renders a full app skeleton (topbar + centered panel),
   *  used at startup. `'overlay'` renders a fixed fullscreen panel
   *  over an existing app, used by in-app full scans. Default `'overlay'`. */
  mode?: 'boot' | 'overlay';
}

export interface ScanProgressHandle {
  /** Update the status label, and optionally the percentage. When
   *  `pct` is omitted the current percentage is kept. */
  update(label: string, pct?: number): void;
  /** Current 0..100 progress value. Used by the boot phase to wait
   *  until the scrape advances past the scanning stage. */
  getPct(): number;
  /** Force the progress to 100% / "准备就绪", hold briefly, then fade
   *  out and dispose. Resolves after the overlay is removed. Safe to
   *  call multiple times — subsequent calls await the same fade. */
  complete(): Promise<void>;
  /** Tear down listeners and remove the DOM immediately. No-op after
   *  `complete()` finishes. */
  dispose(): void;
}

const FADE_OUT_MS = 280;
const HOLD_MS = 220;
const FADE_SAFETY_MS = 320;

export async function mountScanProgress(parent: HTMLElement, opts: ScanProgressOptions = {}): Promise<ScanProgressHandle> {
  const mode = opts.mode ?? 'overlay';
  const initialLabel = opts.initialLabel ?? '正在打开 WonderfulUI…';
  const initialPct = opts.initialPct ?? 5;
  const skipAssetPreWarm = opts.skipAssetPreWarm ?? false;

  const statusNode = el('div', { class: 'boot-status' }, [initialLabel]);
  const fillNode = el('div', { class: 'boot-progress-fill', style: `transform:scaleX(${initialPct / 100})` });
  const panel = el('div', { class: 'boot-panel' }, [
    el('div', { class: 'boot-brand' }, [brandLockup()]),
    el('div', { class: 'boot-progress' }, [fillNode]),
    statusNode,
  ]);

  // Both modes share the `.scan-progress` class so the fade-in /
  // fade-out transitions apply uniformly. Boot mode also carries
  // `.app` for the grid layout; overlay mode omits it and gets
  // `position: fixed; inset: 0` from the `:not(.app)` rule in CSS.
  const root = mode === 'boot'
    ? el('div', { class: 'app scan-progress', role: 'status', 'aria-live': 'polite' }, [
        el('header', { class: 'topbar' }, [brandLockup()]),
        el('div', { class: 'panes' }, [
          el('main', { class: 'pane list full', 'aria-label': '启动中' }, [panel]),
        ]),
      ])
    : el('div', { class: 'scan-progress', role: 'status', 'aria-live': 'polite' }, [panel]);

  if (mode === 'boot') {
    parent.replaceChildren(root);
  } else {
    parent.append(root);
  }

  let disposed = false;

  // Schedule the fade-in on the next frame so the initial `opacity: 0`
  // is painted first, then the transition can animate to `opacity: 1`.
  // Without this, browsers can collapse the change and the element
  // appears instantly with no transition.
  requestAnimationFrame(() => {
    if (disposed) return;
    pulseRendererForMotion(320);
    root.classList.add('is-mounted');
  });
  let currentPct = initialPct;
  const unlisteners: UnlistenFn[] = [];

  function applyUpdate(label: string, pct: number) {
    if (disposed) return;
    if (statusNode.textContent !== label) statusNode.textContent = label;
    fillNode.style.transform = `scaleX(${pct / 100})`;
    currentPct = pct;
  }

  function update(label: string, pct?: number) {
    applyUpdate(label, pct ?? currentPct);
  }

  function getPct(): number {
    return currentPct;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const u of unlisteners) u();
    if (root.isConnected) root.remove();
  }

  let completePromise: Promise<void> | null = null;
  function complete(): Promise<void> {
    if (disposed) return Promise.resolve();
    if (completePromise) return completePromise;
    completePromise = (async () => {
      if (currentPct < 100) {
        applyUpdate('准备就绪', 100);
      }
      await new Promise<void>(r => window.setTimeout(r, HOLD_MS));
      if (disposed) return;
      pulseRendererForMotion(340);
      root.classList.add('is-closing');
      await new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          root.removeEventListener('transitionend', finish);
          resolve();
        };
        root.addEventListener('transitionend', finish);
        window.setTimeout(finish, FADE_SAFETY_MS);
      });
      dispose();
    })();
    return completePromise;
  }

  unlisteners.push(await listen<Record<string, unknown>>('wui://phase', (event) => {
    const d = event.payload;
    const phase = (d.phase as string) || '';
    if (phase === 'scanning') applyUpdate('正在扫描账户\u2026', 12);
    else if (phase === 'loading_view') applyUpdate('正在加载对局\u2026', 80);
    else if (phase === 'caching_assets') applyUpdate('正在准备素材\u2026', 88);
    else if (phase === 'error') applyUpdate(`错误: ${d.sub ?? '启动失败'}`, currentPct);
    else if (phase === 'done') applyUpdate('准备就绪', 100);
  }));

  unlisteners.push(await listen<Record<string, unknown>>('wui://scrape_summary', () => {
    if (currentPct < 80) applyUpdate('正在加载对局\u2026', 80);
  }));

  unlisteners.push(await listen<Record<string, unknown>>('wui://account_started', (event) => {
    const d = event.payload;
    const cur = (d.current as number) ?? 0;
    const tot = (d.total as number) ?? 0;
    if (tot > 0) {
      const nextPct = Math.max(currentPct, Math.min(78, 12 + Math.round(cur / tot * 65)));
      applyUpdate(`正在扫描账户\u2026  ${cur} / ${tot}`, nextPct);
    }
  }));

  unlisteners.push(await listen<Record<string, unknown>>('wui://account_loaded', (event) => {
    const d = event.payload;
    const cur = (d.current as number) ?? 0;
    const tot = (d.total as number) ?? 0;
    if (tot > 0) {
      const nextPct = Math.max(currentPct, Math.min(78, 12 + Math.round(cur / tot * 65)));
      applyUpdate(`正在扫描账户\u2026  ${cur} / ${tot}`, nextPct);
    }
  }));

  if (!skipAssetPreWarm) {
    unlisteners.push(await listen<Record<string, unknown>>('wui://cache_asset_progress', (event) => {
      const d = event.payload;
      const idx = (d.index as number) ?? 0;
      const tot = (d.total as number) ?? 0;
      if (tot > 0) {
        const nextPct = Math.max(currentPct, 88 + Math.round(idx / tot * 11));
        applyUpdate(`正在准备素材\u2026  ${idx} / ${tot}`, nextPct);
      }
    }));
  }

  return { update, getPct, complete, dispose };
}
