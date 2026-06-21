import { ref, computed, watch, type Ref } from 'vue';
import type { MatchRecord } from '@wonderful-ui/parser';

export const ROW_HEIGHT = 104;
export const ROW_BUFFER = 5;

export function useVirtualScroll(
  matches: Ref<MatchRecord[]>,
  containerRef: Ref<HTMLElement | null>,
) {
  const scrollTop = ref(0);

  const totalHeight = computed(() => matches.value.length * ROW_HEIGHT);

  const containerHeight = computed(() => containerRef.value?.clientHeight ?? 600);

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
