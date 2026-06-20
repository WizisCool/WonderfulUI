import { computePosition, offset as flOffset, flip as flFlip, shift as flShift, arrow as flArrow, autoUpdate } from '@floating-ui/dom';
import type { Placement, Middleware, VirtualElement } from '@floating-ui/dom';

export type { Placement };

export interface FloatingOptions {
  placement?: Placement;
  gap?: number;
  alignment?: 'cursor' | 'center';
  cursorX?: number;
}

const FLOATING_GAP = 8;

export function positionFloating(
  reference: HTMLElement | VirtualElement,
  floating: HTMLElement,
  opts: FloatingOptions = {},
): void {
  const gap = opts.gap ?? FLOATING_GAP;
  const middleware: Middleware[] = [
    flOffset(gap),
    flFlip({ padding: gap, fallbackPlacements: ['bottom', 'top', 'right', 'left'] }),
    flShift({ padding: gap }),
  ];

  const arrowEl = floating.querySelector<HTMLElement>('.floating-arrow');
  if (arrowEl) {
    middleware.push(flArrow({ element: arrowEl, padding: 6 }));
  }

  computePosition(reference, floating, {
    placement: opts.placement ?? 'top',
    middleware,
  }).then(({ x, y, placement, middlewareData }) => {
    floating.style.left = `${Math.round(x)}px`;
    floating.style.top = `${Math.round(y)}px`;
    floating.dataset.placement = placement;

    if (arrowEl && middlewareData.arrow) {
      const { x: ax, y: ay } = middlewareData.arrow;
      const side = placement.split('-')[0]!;
      const staticSide = { top: 'bottom', right: 'left', bottom: 'top', left: 'right' }[side]!;
      arrowEl.style.left = ax != null ? `${Math.round(ax)}px` : '';
      arrowEl.style.top = ay != null ? `${Math.round(ay)}px` : '';
      arrowEl.style[staticSide as any] = '-4px';
      arrowEl.dataset.side = side;
    }
  });
}

export function autoUpdateFloating(
  reference: HTMLElement | VirtualElement,
  floating: HTMLElement,
  opts: FloatingOptions = {},
): () => void {
  return autoUpdate(reference, floating, () => {
    positionFloating(reference, floating, opts);
  });
}

export function createArrow(): HTMLElement {
  const arrow = document.createElement('div');
  arrow.className = 'floating-arrow';
  return arrow;
}

export function referenceAtX(el: HTMLElement, x: number): VirtualElement {
  const rect = el.getBoundingClientRect();
  const clampedX = Math.max(rect.left, Math.min(rect.right, x));
  return {
    getBoundingClientRect() {
      const r = el.getBoundingClientRect();
      const cx = Math.max(r.left, Math.min(r.right, clampedX));
      return DOMRect.fromRect({ x: cx, y: r.top, width: 0, height: r.height });
    },
  };
}
