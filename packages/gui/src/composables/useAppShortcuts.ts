// Windows-like app shortcuts for the desktop shell.
// Ctrl+W closes topmost UI then the window; Ctrl+Q quits; Ctrl+, settings;
// Ctrl+F search; F5 / Ctrl+R refresh library (not webview reload).

import { onMounted, onUnmounted } from 'vue';
import { usePlayerStore } from '../stores/player.ts';
import { useSettingsStore } from '../stores/settings.ts';
import { useUpdateStore } from '../stores/update.ts';
import { useShareStore } from '../stores/share.ts';
import { useAccountStore } from '../stores/account.ts';
import { useFilterStore } from '../stores/filter.ts';
import { useUiStore } from '../stores/ui.ts';
import {
  clickLayerCloseButton,
  matchAppShortcut,
  nextCloseableLayer,
} from '../utils/app-shortcuts.ts';

function hasTauri(): boolean {
  return typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;
}

async function closeAppWindow(): Promise<void> {
  if (!hasTauri()) return;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().close();
  } catch {
    /* ignore missing window API in tests */
  }
}

function focusSearchInput(): void {
  const el = document.querySelector<HTMLInputElement>('input.search');
  if (!el) return;
  el.focus();
  el.select();
}

export function useAppShortcuts(): void {
  const player = usePlayerStore();
  const settings = useSettingsStore();
  const update = useUpdateStore();
  const share = useShareStore();
  const account = useAccountStore();
  const filter = useFilterStore();
  const ui = useUiStore();

  function isUpdateCloseable(): boolean {
    return (
      update.modalOpen &&
      (update.status === 'available' || update.status === 'error')
    );
  }

  function isShareOpen(): boolean {
    return share.status === 'starting' || share.status === 'running' || share.status === 'error';
  }

  function closeTopLayer(): boolean {
    // Update downloading/installing: refuse Ctrl+W so install is not abandoned silently
    if (update.modalOpen && !isUpdateCloseable()) {
      return true; // handled (no-op)
    }
    const layer = nextCloseableLayer({
      updateCloseable: isUpdateCloseable(),
      shareOpen: isShareOpen(),
      settingsOpen: settings.isOpen,
      playerOpen: player.isOpen,
    });
    if (!layer) return false;
    // Prefer the real close button so leave animations match a user click.
    if (clickLayerCloseButton(layer)) return true;
    // Fallbacks if the button is not mounted yet
    switch (layer) {
      case 'update':
        update.dismiss();
        break;
      case 'share':
        void share.stop();
        break;
      case 'settings':
        settings.setOpen(false);
        break;
      case 'player':
        player.requestClose();
        break;
    }
    return true;
  }

  async function refreshLibrary(): Promise<void> {
    if (account.scraping || ui.scanOverlayVisible) return;
    const mode = filter.refreshScanMode;
    if (mode === 'full') ui.showScanOverlay();
    try {
      await account.scrapeLibrary(mode);
      ui.showToast(mode === 'full' ? '资料库已全量扫描' : '资料库已增量扫描', 'ok');
    } catch (e) {
      ui.showToast(
        `扫描失败: ${e instanceof Error ? e.message : String(e)}`,
        'error',
      );
    } finally {
      if (mode === 'full') ui.hideScanOverlay();
    }
  }

  function onKeydown(e: KeyboardEvent): void {
    const action = matchAppShortcut(e);
    if (!action) return;

    // Never steal F12 / browser-only combos; matchAppShortcut already ignores them.
    e.preventDefault();
    e.stopPropagation();

    switch (action) {
      case 'close-layer-or-window': {
        if (closeTopLayer()) return;
        void closeAppWindow();
        return;
      }
      case 'quit-window':
        void closeAppWindow();
        return;
      case 'open-settings':
        settings.setOpen(true);
        return;
      case 'focus-search':
        focusSearchInput();
        return;
      case 'refresh-library':
        void refreshLibrary();
        return;
    }
  }

  onMounted(() => {
    document.addEventListener('keydown', onKeydown, true);
  });
  onUnmounted(() => {
    document.removeEventListener('keydown', onKeydown, true);
  });
}
