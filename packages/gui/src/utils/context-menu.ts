/**
 * Pure helpers for fixed-position context menus (player right-click, future share popovers).
 */

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/**
 * Clamp a top-left menu origin so the menu stays inside a viewport rectangle.
 * `pad` keeps a small gap from the edges.
 */
export function clampMenuPosition(
  origin: Point,
  menu: Size,
  viewport: Size,
  pad = 8,
): Point {
  const maxX = Math.max(pad, viewport.width - menu.width - pad);
  const maxY = Math.max(pad, viewport.height - menu.height - pad);
  return {
    x: Math.min(Math.max(pad, origin.x), maxX),
    y: Math.min(Math.max(pad, origin.y), maxY),
  };
}

/** Prefer placing below-right of the cursor; flip if that would overflow. */
export function placeMenuNearCursor(
  cursor: Point,
  menu: Size,
  viewport: Size,
  pad = 8,
): Point {
  // Default: slightly offset so the cursor is not on the first item.
  let x = cursor.x + 2;
  let y = cursor.y + 2;
  if (x + menu.width + pad > viewport.width) {
    x = cursor.x - menu.width - 2;
  }
  if (y + menu.height + pad > viewport.height) {
    y = cursor.y - menu.height - 2;
  }
  return clampMenuPosition({ x, y }, menu, viewport, pad);
}
