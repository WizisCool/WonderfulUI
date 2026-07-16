import { describe, expect, test } from 'bun:test';
import { clampMenuPosition, placeMenuNearCursor, placeSubmenu } from '../src/utils/context-menu.ts';

describe('clampMenuPosition', () => {
  test('keeps origin inside viewport', () => {
    expect(clampMenuPosition({ x: 900, y: 700 }, { width: 200, height: 120 }, { width: 1000, height: 800 }))
      .toEqual({ x: 792, y: 672 });
  });

  test('clamps negative origins to pad', () => {
    expect(clampMenuPosition({ x: -20, y: -10 }, { width: 100, height: 80 }, { width: 400, height: 300 }, 8))
      .toEqual({ x: 8, y: 8 });
  });
});

describe('placeMenuNearCursor', () => {
  test('flips left when overflowing right edge', () => {
    const p = placeMenuNearCursor(
      { x: 950, y: 100 },
      { width: 180, height: 100 },
      { width: 1000, height: 800 },
    );
    expect(p.x + 180).toBeLessThanOrEqual(1000 - 8);
    expect(p.x).toBeLessThan(950);
  });

  test('flips up when overflowing bottom edge', () => {
    const p = placeMenuNearCursor(
      { x: 100, y: 750 },
      { width: 180, height: 100 },
      { width: 1000, height: 800 },
    );
    expect(p.y + 100).toBeLessThanOrEqual(800 - 8);
    expect(p.y).toBeLessThan(750);
  });
});

describe('placeSubmenu', () => {
  test('opens to the right of the parent by default', () => {
    const p = placeSubmenu(
      { x: 100, y: 200, width: 180, height: 32 },
      { width: 160, height: 80 },
      { width: 1000, height: 800 },
    );
    expect(p.x).toBe(100 + 180 + 2);
    expect(p.y).toBe(200);
  });

  test('flips left when overflowing right edge', () => {
    const p = placeSubmenu(
      { x: 850, y: 100, width: 180, height: 32 },
      { width: 160, height: 80 },
      { width: 1000, height: 800 },
    );
    expect(p.x + 160).toBeLessThanOrEqual(1000 - 8);
    expect(p.x).toBeLessThan(850);
  });
});
