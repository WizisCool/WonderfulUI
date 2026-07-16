import { describe, test, expect } from 'bun:test';
import {
  clickLayerCloseButton,
  matchAppShortcut,
  nextCloseableLayer,
} from '../src/utils/app-shortcuts.ts';

function key(
  partial: Partial<{
    key: string;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
  }>,
) {
  return {
    key: 'a',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...partial,
  };
}

describe('matchAppShortcut', () => {
  test('Ctrl+W closes layer or window', () => {
    expect(matchAppShortcut(key({ key: 'w', ctrlKey: true }))).toBe('close-layer-or-window');
    expect(matchAppShortcut(key({ key: 'W', ctrlKey: true }))).toBe('close-layer-or-window');
  });

  test('Ctrl+Q quits window', () => {
    expect(matchAppShortcut(key({ key: 'q', ctrlKey: true }))).toBe('quit-window');
  });

  test('Ctrl+, opens settings', () => {
    expect(matchAppShortcut(key({ key: ',', ctrlKey: true }))).toBe('open-settings');
  });

  test('Ctrl+F focuses search', () => {
    expect(matchAppShortcut(key({ key: 'f', ctrlKey: true }))).toBe('focus-search');
  });

  test('F5 and Ctrl+R refresh library', () => {
    expect(matchAppShortcut(key({ key: 'F5' }))).toBe('refresh-library');
    expect(matchAppShortcut(key({ key: 'r', ctrlKey: true }))).toBe('refresh-library');
  });

  test('Ctrl+Shift+R is not intercepted (devtools hard reload)', () => {
    expect(matchAppShortcut(key({ key: 'r', ctrlKey: true, shiftKey: true }))).toBeNull();
  });

  test('plain keys and Alt combos are ignored', () => {
    expect(matchAppShortcut(key({ key: 'w' }))).toBeNull();
    expect(matchAppShortcut(key({ key: 'F12' }))).toBeNull();
    expect(matchAppShortcut(key({ key: 'F4', altKey: true }))).toBeNull();
  });
});

describe('nextCloseableLayer', () => {
  test('prefers higher z-order layers', () => {
    expect(
      nextCloseableLayer({
        updateCloseable: true,
        shareOpen: true,
        settingsOpen: true,
        playerOpen: true,
      }),
    ).toBe('update');
    expect(
      nextCloseableLayer({
        updateCloseable: false,
        shareOpen: true,
        settingsOpen: true,
        playerOpen: true,
      }),
    ).toBe('share');
    expect(
      nextCloseableLayer({
        updateCloseable: false,
        shareOpen: false,
        settingsOpen: true,
        playerOpen: true,
      }),
    ).toBe('settings');
    expect(
      nextCloseableLayer({
        updateCloseable: false,
        shareOpen: false,
        settingsOpen: false,
        playerOpen: true,
      }),
    ).toBe('player');
    expect(
      nextCloseableLayer({
        updateCloseable: false,
        shareOpen: false,
        settingsOpen: false,
        playerOpen: false,
      }),
    ).toBeNull();
  });
});

describe('clickLayerCloseButton', () => {
  test('clicks the matching close control', () => {
    let clicked = 0;
    const btn = {
      disabled: false,
      click() {
        clicked += 1;
      },
    };
    const root = {
      querySelector() {
        return btn;
      },
    } as unknown as ParentNode;
    expect(clickLayerCloseButton('player', root)).toBe(true);
    expect(clicked).toBe(1);
  });

  test('returns false when missing', () => {
    const root = {
      querySelector() {
        return null;
      },
    } as unknown as ParentNode;
    expect(clickLayerCloseButton('settings', root)).toBe(false);
  });
});
