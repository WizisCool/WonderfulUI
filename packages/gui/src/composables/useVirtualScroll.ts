import { ref, computed, watch, onBeforeUnmount, type Ref } from 'vue';
import type { MatchRecord } from '@wonderful-ui/parser';

export const ROW_HEIGHT = 104;
export const ROW_BUFFER = 5;

export function clampVirtualScrollTop(
  value: number,
  itemCount: number,
  viewportHeight: number,
): number {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  const safeCount = Number.isFinite(itemCount) ? Math.max(0, Math.floor(itemCount)) : 0;
  const safeViewport = Number.isFinite(viewportHeight) ? Math.max(0, viewportHeight) : 0;
  const maxScrollTop = Math.max(0, safeCount * ROW_HEIGHT - safeViewport);
  return Math.min(safeValue, maxScrollTop);
}

export function useVirtualScroll(
  matches: Ref<MatchRecord[]>,
  containerRef: Ref<HTMLElement | null>,
) {
  const scrollTop = ref(0);
  // Reactive container height. ResizeObserver on the scroller (and the
  // window) bumps this ref so the visible range recomputes on layout
  // changes (window resize, pane drag, etc.) — not only on scroll.
  const containerHeight = ref(600);

  let resizeObserver: ResizeObserver | null = null;
  let observedEl: HTMLElement | null = null;

  function attachObserver(el: HTMLElement) {
    if (observedEl === el) return;
    detachObserver();
    if (typeof ResizeObserver === 'undefined') {
      containerHeight.value = el.clientHeight || 600;
      return;
    }
    resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        // Use contentBoxSize when available (sub-pixel), fall back to
        // clientHeight. Either is fine for ROW_HEIGHT slicing.
        const h = entry.contentRect.height || el.clientHeight;
        if (h > 0) containerHeight.value = h;
      }
    });
    resizeObserver.observe(el);
    observedEl = el;
    containerHeight.value = el.clientHeight || 600;
  }

  function detachObserver() {
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    observedEl = null;
  }

  // Reattach when the ref resolves or swaps elements.
  watch(containerRef, (el, prev) => {
    if (el) attachObserver(el);
    else if (prev) detachObserver();
  }, { immediate: true });

  onBeforeUnmount(detachObserver);

  const totalHeight = computed(() => matches.value.length * ROW_HEIGHT);

  // A filter/account switch can replace a long list with a short one while
  // the reactive scrollTop still points near the old bottom. Clamp both the
  // model and DOM immediately so the next visible slice cannot be empty just
  // because the browser's native scroll correction has not fired yet.
  watch([() => matches.value.length, containerHeight], ([length, height]) => {
    const next = clampVirtualScrollTop(scrollTop.value, length, height);
    if (next !== scrollTop.value) scrollTop.value = next;
    const el = containerRef.value;
    if (el && el.scrollTop !== next) el.scrollTop = next;
  }, { flush: 'sync' });

  const visibleRange = computed(() => {
    const effectiveTop = clampVirtualScrollTop(
      scrollTop.value,
      matches.value.length,
      containerHeight.value,
    );
    const start = Math.max(0, Math.floor(effectiveTop / ROW_HEIGHT) - ROW_BUFFER);
    const end = Math.min(
      matches.value.length,
      Math.ceil((effectiveTop + containerHeight.value) / ROW_HEIGHT) + ROW_BUFFER,
    );
    return { start, end };
  });

  const visibleMatches = computed(() => {
    const { start, end } = visibleRange.value;
    return matches.value.slice(start, end).map((m, i) => ({
      match: m,
      index: start + i,
      y: (start + i) * ROW_HEIGHT,
    }));
  });

  function onScroll() {
    const el = containerRef.value;
    if (!el) return;
    scrollTop.value = el.scrollTop;
  }

  function scrollToIndex(index: number) {
    const el = containerRef.value;
    if (!el) return;
    const next = clampVirtualScrollTop(
      index * ROW_HEIGHT,
      matches.value.length,
      containerHeight.value,
    );
    scrollTop.value = next;
    el.scrollTop = next;
  }

  return {
    totalHeight, visibleRange, visibleMatches,
    onScroll, scrollToIndex,
  };
}
