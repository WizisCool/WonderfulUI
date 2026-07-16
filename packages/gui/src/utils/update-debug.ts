// DEV-only update UI simulator. Production / CI release builds: no-op.
// See docs/UPDATER.md and docs/superpowers/specs/2026-07-17-update-ui-dev-simulator-design.md

import type { UpdateErrorKind, useUpdateStore } from '../stores/update.ts';

export type UpdateStoreApi = ReturnType<typeof useUpdateStore>;

export interface WuiDebugUpdateApi {
  available(opts?: { version?: string; body?: string; silent?: boolean }): void;
  uptodate(): void;
  error(kind: UpdateErrorKind): void;
  downloading(opts?: { total?: number; downloaded?: number }): void;
  installing(): void;
  progress(downloaded: number, total: number): void;
  play(): void;
  reset(): void;
}

declare global {
  interface Window {
    __WUI_DEBUG_UPDATE__?: WuiDebugUpdateApi;
  }
}

/**
 * Mount optional console helpers. No-op when not DEV.
 * Boot path always mocks silent available in DEV (see App.vue).
 * Call once after Pinia is active (e.g. App onMounted).
 */
export function installUpdateDebug(getStore: () => UpdateStoreApi): void {
  if (!import.meta.env.DEV) return;
  if (typeof window === 'undefined') return;

  const api: WuiDebugUpdateApi = {
    available(opts) {
      getStore().debugAvailable(opts);
    },
    uptodate() {
      getStore().debugUptodate();
    },
    error(kind) {
      getStore().debugError(kind);
    },
    downloading(opts) {
      getStore().debugDownloading(opts);
    },
    installing() {
      getStore().debugInstalling();
    },
    progress(downloaded, total) {
      getStore().debugProgress(downloaded, total);
    },
    play() {
      const store = getStore();
      if (store.status === 'installing') {
        store.debugAvailable({ silent: false });
      } else if (store.status !== 'available' && store.errorKind !== 'download') {
        if (store.status !== 'downloading') {
          store.debugAvailable({ silent: false });
        }
      }
      void store.playFakeDownload();
    },
    reset() {
      getStore().debugReset();
    },
  };

  window.__WUI_DEBUG_UPDATE__ = api;
  console.info(
    '[WonderfulUI] DEV: mock update auto-opens modal. ' +
      'Optional: window.__WUI_DEBUG_UPDATE__ (play / error / reset)',
  );
}
