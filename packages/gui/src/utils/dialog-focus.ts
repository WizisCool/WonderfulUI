import { nextTick, onUnmounted, watch, type Ref } from 'vue';
import { ownsTopModalLayer, type ModalLayer } from './modal-layer.ts';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function dialogFocusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter(element => element.getAttribute('aria-hidden') !== 'true');
}

/**
 * WAI-ARIA modal Tab loop. Default browser navigation remains intact between
 * interior controls; only empty/outside focus and the two boundaries are
 * intercepted.
 */
export function trapDialogTab(event: KeyboardEvent, root: HTMLElement | null): boolean {
  if (event.key !== 'Tab' || !root) return false;
  const focusables = dialogFocusables(root);
  if (focusables.length === 0) {
    event.preventDefault();
    root.focus({ preventScroll: true });
    return true;
  }

  const first = focusables[0]!;
  const last = focusables[focusables.length - 1]!;
  const active = document.activeElement;
  if (!active || !root.contains(active)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus({ preventScroll: true });
    return true;
  }
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus({ preventScroll: true });
    return true;
  }
  if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus({ preventScroll: true });
    return true;
  }
  return false;
}

export function useDialogFocus(
  root: Ref<HTMLElement | null>,
  isOpen: () => boolean,
  layer: ModalLayer,
): { onDialogTab: (event: KeyboardEvent) => void } {
  let restoreTarget: HTMLElement | null = null;
  let openCycle = 0;

  async function moveFocusInside(cycle: number): Promise<void> {
    await nextTick();
    if (cycle !== openCycle || !isOpen() || !ownsTopModalLayer(layer)) return;
    root.value?.focus({ preventScroll: true });
  }

  async function restoreFocus(cycle: number): Promise<void> {
    await nextTick();
    if (cycle !== openCycle) return;
    const target = restoreTarget;
    restoreTarget = null;
    if (target && document.contains(target)) target.focus({ preventScroll: true });
  }

  watch(
    isOpen,
    open => {
      openCycle += 1;
      const cycle = openCycle;
      if (open) {
        restoreTarget = document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
        void moveFocusInside(cycle);
      } else {
        void restoreFocus(cycle);
      }
    },
    { immediate: true },
  );

  onUnmounted(() => {
    openCycle += 1;
    const target = restoreTarget;
    restoreTarget = null;
    if (target && document.contains(target)) target.focus({ preventScroll: true });
  });

  function onDialogTab(event: KeyboardEvent): void {
    if (!isOpen() || !ownsTopModalLayer(layer)) return;
    trapDialogTab(event, root.value);
  }

  return { onDialogTab };
}
