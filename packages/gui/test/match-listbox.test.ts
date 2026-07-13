import { describe, test, expect } from 'bun:test';
import {
  matchOptionId,
  clampIndex,
  nextListboxIndex,
  listboxNavAlwaysScroll,
  scrollTopToRevealIndex,
  reconcileFocusedId,
  isListboxNavKey,
  isListboxActivateKey,
} from '../src/utils/match-listbox.ts';

describe('matchOptionId', () => {
  test('prefixes and sanitizes special characters', () => {
    expect(matchOptionId('abc-123')).toBe('wui-match-opt-abc-123');
    expect(matchOptionId('a/b:c d')).toBe('wui-match-opt-a_b_c_d');
  });

  test('empty becomes unknown', () => {
    expect(matchOptionId('')).toBe('wui-match-opt-unknown');
  });
});

describe('clampIndex', () => {
  test('clamps into range', () => {
    expect(clampIndex(-5, 10)).toBe(0);
    expect(clampIndex(99, 10)).toBe(9);
    expect(clampIndex(3, 10)).toBe(3);
  });

  test('empty list returns -1', () => {
    expect(clampIndex(0, 0)).toBe(-1);
  });
});

describe('nextListboxIndex', () => {
  test('ArrowDown from no focus lands on first', () => {
    expect(nextListboxIndex('ArrowDown', -1, 5, 3)).toBe(0);
  });

  test('ArrowUp from no focus lands on last', () => {
    expect(nextListboxIndex('ArrowUp', -1, 5, 3)).toBe(4);
  });

  test('ArrowDown/Up move by one and clamp', () => {
    expect(nextListboxIndex('ArrowDown', 0, 5, 3)).toBe(1);
    expect(nextListboxIndex('ArrowDown', 4, 5, 3)).toBe(4);
    expect(nextListboxIndex('ArrowUp', 0, 5, 3)).toBe(0);
    expect(nextListboxIndex('ArrowUp', 2, 5, 3)).toBe(1);
  });

  test('Home/End', () => {
    expect(nextListboxIndex('Home', 3, 8, 3)).toBe(0);
    expect(nextListboxIndex('End', 3, 8, 3)).toBe(7);
  });

  test('PageDown/PageUp from middle', () => {
    expect(nextListboxIndex('PageDown', 2, 20, 5)).toBe(7);
    expect(nextListboxIndex('PageUp', 7, 20, 5)).toBe(2);
  });

  test('PageDown from no focus starts at page size (from 0)', () => {
    expect(nextListboxIndex('PageDown', -1, 20, 5)).toBe(5);
  });

  test('empty list yields null', () => {
    expect(nextListboxIndex('ArrowDown', -1, 0, 3)).toBeNull();
  });
});

describe('listboxNavAlwaysScroll', () => {
  test('page and home/end force scroll policy', () => {
    expect(listboxNavAlwaysScroll('PageDown')).toBe(true);
    expect(listboxNavAlwaysScroll('Home')).toBe(true);
    expect(listboxNavAlwaysScroll('ArrowDown')).toBe(false);
  });
});

describe('scrollTopToRevealIndex', () => {
  const H = 104;
  test('scrolls up when row is above viewport', () => {
    expect(scrollTopToRevealIndex(0, H, 200, 400)).toBe(0);
  });

  test('scrolls down when row is below viewport', () => {
    // index 10 → top 1040, bottom 1144; view 0–400 → need scrollTop 744
    expect(scrollTopToRevealIndex(10, H, 0, 400)).toBe(10 * H + H - 400);
  });

  test('returns null when fully visible', () => {
    expect(scrollTopToRevealIndex(2, H, 100, 400)).toBeNull();
  });

  test('force with fully visible still null (minimal jump)', () => {
    expect(scrollTopToRevealIndex(2, H, 100, 400, true)).toBeNull();
  });
});

describe('reconcileFocusedId', () => {
  const ids = ['a', 'b', 'c'];

  test('keeps previous when still in list', () => {
    expect(reconcileFocusedId('b', 'a', ids)).toBe('b');
  });

  test('falls back to selection when previous gone', () => {
    expect(reconcileFocusedId('gone', 'c', ids)).toBe('c');
  });

  test('null when neither previous nor selection present', () => {
    expect(reconcileFocusedId('gone', 'x', ids)).toBeNull();
    expect(reconcileFocusedId(null, null, ids)).toBeNull();
  });

  test('empty list clears', () => {
    expect(reconcileFocusedId('a', 'a', [])).toBeNull();
  });
});

describe('key predicates', () => {
  test('nav and activate keys', () => {
    expect(isListboxNavKey('ArrowDown')).toBe(true);
    expect(isListboxNavKey('a')).toBe(false);
    expect(isListboxActivateKey('Enter')).toBe(true);
    expect(isListboxActivateKey(' ')).toBe(true);
    expect(isListboxActivateKey('Tab')).toBe(false);
  });
});
