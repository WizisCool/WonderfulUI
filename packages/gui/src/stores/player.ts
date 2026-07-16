import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { VideoItem, MatchRecord } from '@wonderful-ui/parser';

export const usePlayerStore = defineStore('player', () => {
  const video = ref<VideoItem | null>(null);
  const matchContext = ref<MatchRecord | null>(null);
  const seekMs = ref<number | undefined>(undefined);
  const isOpen = ref(false);
  /**
   * Bumped by shell shortcuts (Ctrl+W) so PlayerHost can run doClose()
   * (close animation) instead of hard-clearing isOpen.
   */
  const closeRequestSeq = ref(0);

  function open(v: VideoItem, m?: MatchRecord, seek?: number) {
    video.value = v;
    matchContext.value = m ?? null;
    seekMs.value = seek;
    isOpen.value = true;
  }

  function close() {
    isOpen.value = false;
    video.value = null;
    matchContext.value = null;
    seekMs.value = undefined;
  }

  /** Prefer over close() from outside the player — preserves exit animation. */
  function requestClose() {
    if (!isOpen.value) return;
    closeRequestSeq.value += 1;
  }

  return { video, matchContext, seekMs, isOpen, closeRequestSeq, open, close, requestClose };
});
