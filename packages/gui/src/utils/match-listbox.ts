/**
 * Pure helpers for the match-list listbox (ARIA APG aria-activedescendant).
 *
 * Contract:
 * - Focus stays on the listbox container.
 * - Options are never focused (no roving tabindex / no el.focus() on rows).
 * - `focusedId` is the active option (keyboard cursor), independent of selection.
 * - `aria-activedescendant` must point at a real option `id` (see matchOptionId).
 * - Visual `.is-focused` only while the listbox itself is focused.
 */

/** Stable, CSS/HTML-safe DOM id for a match option. */
export function matchOptionId(matchesId: string): string {
  // matches_id can include characters invalid in HTML ids; keep it readable.
  const safe = matchesId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `wui-match-opt-${safe || 'unknown'}`;
}

export function clampIndex(index: number, length: number): number {
  if (length <= 0) return -1;
  return Math.max(0, Math.min(length - 1, index));
}

export type ListboxNavKey =
  | 'ArrowDown'
  | 'ArrowUp'
  | 'Home'
  | 'End'
  | 'PageDown'
  | 'PageUp';

export function isListboxNavKey(key: string): key is ListboxNavKey {
  return (
    key === 'ArrowDown'
    || key === 'ArrowUp'
    || key === 'Home'
    || key === 'End'
    || key === 'PageDown'
    || key === 'PageUp'
  );
}

export function isListboxActivateKey(key: string): boolean {
  return key === 'Enter' || key === ' ';
}

/**
 * Next active index for keyboard navigation.
 * `currentIdx` is -1 when nothing is active yet.
 * Relative keys from -1: ArrowDown → 0, ArrowUp → last, Page* from -1 act as from 0 edge.
 */
export function nextListboxIndex(
  key: ListboxNavKey,
  currentIdx: number,
  length: number,
  pageSize: number,
): number | null {
  if (length <= 0) return null;
  const page = Math.max(1, pageSize);
  const noFocus = currentIdx < 0;

  switch (key) {
    case 'ArrowDown':
      return clampIndex(noFocus ? 0 : currentIdx + 1, length);
    case 'ArrowUp':
      return clampIndex(noFocus ? length - 1 : currentIdx - 1, length);
    case 'Home':
      return 0;
    case 'End':
      return length - 1;
    case 'PageDown':
      return clampIndex((noFocus ? 0 : currentIdx) + page, length);
    case 'PageUp':
      return clampIndex((noFocus ? 0 : currentIdx) - page, length);
    default:
      return null;
  }
}

/** Whether a nav key should force scroll even if the row is already partially visible. */
export function listboxNavAlwaysScroll(key: ListboxNavKey): boolean {
  return key === 'PageDown' || key === 'PageUp' || key === 'Home' || key === 'End';
}

/**
 * Compute scrollTop so row `index` is fully inside the viewport.
 * Returns null when no change is needed.
 */
export function scrollTopToRevealIndex(
  index: number,
  rowHeight: number,
  scrollTop: number,
  clientHeight: number,
  force = false,
): number | null {
  if (index < 0 || rowHeight <= 0 || clientHeight <= 0) return null;
  const top = index * rowHeight;
  const bottom = top + rowHeight;
  const viewTop = scrollTop;
  const viewBottom = scrollTop + clientHeight;

  if (force) {
    // Prefer minimal jump that still fully reveals the row.
    if (top < viewTop) return top;
    if (bottom > viewBottom) return Math.max(0, bottom - clientHeight);
    // Already fully visible — still jump to top on Home-style force only when
    // caller wants always; for force+fully-visible keep position.
    return null;
  }
  if (top < viewTop) return top;
  if (bottom > viewBottom) return Math.max(0, bottom - clientHeight);
  return null;
}

/**
 * Resolve which focusedId to keep when the filtered list changes.
 * Prefer the previous active id if still present; else the selected match if present; else null.
 * Never invent a "first row" default — that painted a permanent focus outline.
 */
export function reconcileFocusedId(
  prevFocusedId: string | null,
  selectedId: string | null | undefined,
  listIds: readonly string[],
): string | null {
  if (listIds.length === 0) return null;
  if (prevFocusedId && listIds.includes(prevFocusedId)) return prevFocusedId;
  if (selectedId && listIds.includes(selectedId)) return selectedId;
  return null;
}
