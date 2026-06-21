import { computePosition, offset, flip, shift, arrow, autoUpdate } from '@floating-ui/dom';
import type { ReferenceElement, FloatingElement, Placement, Middleware, VirtualElement } from '@floating-ui/dom';

export interface FloatingOptions {
  placement?: Placement;
  offset?: number;
  middleware?: Middleware[];
}

export function positionFloating(
  reference: ReferenceElement,
  floating: FloatingElement,
  opts: FloatingOptions = {},
): Promise<void> {
  const arrowEl = floating.querySelector<HTMLElement>('.floating-arrow');
  const middleware: Middleware[] = [
    offset(opts.offset ?? 8),
    flip(),
    shift({ padding: 8 }),
  ];
  if (arrowEl) {
    middleware.push(arrow({ element: arrowEl }));
  }
  middleware.push(...(opts.middleware ?? []));

  return computePosition(reference, floating, {
    placement: opts.placement ?? 'top',
    middleware,
  }).then(({ x, y, placement, middlewareData }) => {
    Object.assign(floating.style, { left: `${x}px`, top: `${y}px` });
    if (arrowEl) {
      const arrowData = middlewareData.arrow;
      const staticSide = { top: 'bottom', right: 'left', bottom: 'top', left: 'right' }[placement.split('-')[0]!];
      if (arrowData && staticSide) {
        Object.assign(arrowEl.style, {
          left: arrowData.x != null ? `${arrowData.x}px` : '',
          top: arrowData.y != null ? `${arrowData.y}px` : '',
          [staticSide]: '-4px',
        });
        arrowEl.setAttribute('data-side', staticSide);
      } else {
        arrowEl.removeAttribute('data-side');
      }
    }
  });
}

export function autoUpdateFloating(
  reference: ReferenceElement,
  floating: FloatingElement,
  opts: FloatingOptions = {},
): () => void {
  return autoUpdate(reference, floating, () => { void positionFloating(reference, floating, opts); });
}

export function createArrow(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'floating-arrow';
  return el;
}

export function referenceAtX(el: HTMLElement, x: number): VirtualElement {
  const rect = el.getBoundingClientRect();
  return {
    getBoundingClientRect() {
      return DOMRect.fromRect({
        x: Math.max(rect.left, Math.min(x, rect.right)),
        y: rect.top,
        width: 0,
        height: rect.height,
      });
    },
  };
}
