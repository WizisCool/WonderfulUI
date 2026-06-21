import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { invoke } from '../tauri-adapter.ts';
import type { MatchRecord, VideoItem } from '@wonderful-ui/parser';

export const useDetailStore = defineStore('detail', () => {
  const selectedMatch = ref<MatchRecord | null>(null);
  const momentFilter = ref<string | null>(null);
  const roundsLoaded = ref(false);

  const hasVideo = computed(() => (selectedMatch.value?.videos.length ?? 0) > 0);

  async function fetchRounds(): Promise<void> {
    const m = selectedMatch.value;
    if (!m || roundsLoaded.value) return;
    try {
      const full = await invoke<MatchRecord>('get_match_rounds', {
        openid: m.openID,
        matchId: m.matches_id,
      });
      for (const liveV of m.videos) {
        const fullV = full.videos.find(v => v.video_id === liveV.video_id);
        if (fullV) liveV.rounds = fullV.rounds;
      }
      roundsLoaded.value = true;
    } catch (e) {
      console.error('[detail::fetchRounds] ERROR:', e);
      throw e;
    }
  }

  function selectMatch(m: MatchRecord | null) {
    selectedMatch.value = m;
    momentFilter.value = null;
    roundsLoaded.value = false;
  }

  function setMomentFilter(type: string | null) {
    momentFilter.value = momentFilter.value === type ? null : type;
  }

  return {
    selectedMatch, momentFilter, roundsLoaded, hasVideo,
    fetchRounds, selectMatch, setMomentFilter,
  };
});
