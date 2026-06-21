import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { VideoItem, MatchRecord } from '@wonderful-ui/parser';

export const usePlayerStore = defineStore('player', () => {
  const video = ref<VideoItem | null>(null);
  const matchContext = ref<MatchRecord | null>(null);
  const seekMs = ref<number | undefined>(undefined);
  const isOpen = ref(false);

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

  return { video, matchContext, seekMs, isOpen, open, close };
});
