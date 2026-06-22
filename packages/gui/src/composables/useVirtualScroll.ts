import { ref, computed, watch, onBeforeUnmount, type Ref } from 'vue';
import type { MatchRecord } from '@wonderful-ui/parser';

export const ROW_HEIGHT = 104;
export const ROW_BUFFER = 5;

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

  const visibleRange = computed(() => {
    const start = Math.max(0, Math.floor(scrollTop.value / ROW_HEIGHT) - ROW_BUFFER);
    const end = Math.min(
      matches.value.length,
      Math.ceil((scrollTop.value + containerHeight.value) / ROW_HEIGHT) + ROW_BUFFER,
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
    if (el) el.scrollTop = index * ROW_HEIGHT;
  }

  return {
    totalHeight, visibleRange, visibleMatches,
    onScroll, scrollToIndex,
  };
}
