/**
 * Windows-like desktop app shortcuts (pure match + layer order).
 * Wired from App.vue; does not touch DOM/window itself.
 */

export type AppShortcutAction =
  | 'close-layer-or-window'
  | 'quit-window'
  | 'open-settings'
  | 'focus-search'
  | 'refresh-library';

export type CloseableLayer = 'update' | 'share' | 'settings' | 'player';

export interface ShortcutKeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** Match a keydown to a desktop shortcut. Returns null if not handled by us. */
export function matchAppShortcut(e: ShortcutKeyEvent): AppShortcutAction | null {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const mod = e.ctrlKey || e.metaKey;

  // Leave Alt+… alone (system / menu). Alt+F4 is handled by the OS.
  if (e.altKey && !mod) return null;

  if (mod && !e.altKey && !e.shiftKey && key === 'w') return 'close-layer-or-window';
  if (mod && !e.altKey && !e.shiftKey && key === 'q') return 'quit-window';
  if (mod && !e.altKey && !e.shiftKey && key === ',') return 'open-settings';
  if (mod && !e.altKey && !e.shiftKey && key === 'f') return 'focus-search';
  // Ctrl+R / F5 → library refresh. Ctrl+Shift+R left free for devtools hard reload.
  if (mod && !e.altKey && !e.shiftKey && key === 'r') return 'refresh-library';
  if (key === 'F5') return 'refresh-library';
  return null;
}

/**
 * Topmost closeable layer first (z-order: update → share → settings → player).
 * Returns null when nothing UI-level is open → caller may close the window.
 */
export function nextCloseableLayer(flags: {
  updateCloseable: boolean;
  shareOpen: boolean;
  settingsOpen: boolean;
  playerOpen: boolean;
}): CloseableLayer | null {
  if (flags.updateCloseable) return 'update';
  if (flags.shareOpen) return 'share';
  if (flags.settingsOpen) return 'settings';
  if (flags.playerOpen) return 'player';
  return null;
}

/** CSS selectors for the same close controls the user clicks (animation-preserving). */
export const CLOSE_BUTTON_SELECTOR: Record<CloseableLayer, string> = {
  update: 'button.update-modal-close',
  share: 'button.share-modal-close',
  settings: 'button.settings-close',
  player: 'button.player-close-top',
};

/** Click the layer's close button if present. Returns false if not found / disabled. */
export function clickLayerCloseButton(
  layer: CloseableLayer,
  root: ParentNode = document,
): boolean {
  const el = root.querySelector<HTMLButtonElement>(CLOSE_BUTTON_SELECTOR[layer]);
  if (!el || el.disabled) return false;
  el.click();
  return true;
}
