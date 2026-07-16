/**
 * Single active context menu: opening one must close every other.
 * Components listen and tear down their menus; openers call broadcast first.
 */

export const CLOSE_CONTEXT_MENUS_EVENT = 'wui:close-context-menus';

export type ContextMenuSource = 'match-list' | 'detail-video' | 'player' | string;

export function broadcastCloseContextMenus(except?: ContextMenuSource): void {
  if (typeof document === 'undefined') return;
  document.dispatchEvent(
    new CustomEvent(CLOSE_CONTEXT_MENUS_EVENT, { detail: { except } }),
  );
}

export function onCloseContextMenus(
  handler: (except?: ContextMenuSource) => void,
): () => void {
  if (typeof document === 'undefined') return () => {};
  const fn = (e: Event) => {
    const detail = (e as CustomEvent<{ except?: ContextMenuSource }>).detail;
    handler(detail?.except);
  };
  document.addEventListener(CLOSE_CONTEXT_MENUS_EVENT, fn);
  return () => document.removeEventListener(CLOSE_CONTEXT_MENUS_EVENT, fn);
}
