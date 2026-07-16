import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { invoke } from '../tauri-adapter.ts';
import type { MatchRecord } from '@wonderful-ui/parser';
import { clientLog } from '../utils/client-log.ts';
import { shouldCommitMatchRounds } from '../utils/match-rounds-fetch.ts';

export const useDetailStore = defineStore('detail', () => {
  const selectedMatch = ref<MatchRecord | null>(null);
  const momentFilter = ref<string | null>(null);
  const roundsLoaded = ref(false);

  const hasVideo = computed(() => (selectedMatch.value?.videos.length ?? 0) > 0);

  async function fetchRounds(): Promise<void> {
    const m = selectedMatch.value;
    if (!m || roundsLoaded.value) return;
    const requestMatchId = m.matches_id;
    try {
      const full = await invoke<MatchRecord>('get_match_rounds', {
        openid: m.openID,
        matchId: m.matches_id,
      });
      // Discard late responses after the user selected another match.
      if (!shouldCommitMatchRounds(requestMatchId, selectedMatch.value?.matches_id)) {
        return;
      }
      for (const liveV of m.videos) {
        const fullV = full.videos.find(v => v.video_id === liveV.video_id);
        if (fullV) liveV.rounds = fullV.rounds;
      }
      if (shouldCommitMatchRounds(requestMatchId, selectedMatch.value?.matches_id)) {
        roundsLoaded.value = true;
      }
    } catch (e) {
      clientLog('error', 'detail', `fetchRounds: ${e instanceof Error ? e.message : String(e)}`);
      if (shouldCommitMatchRounds(requestMatchId, selectedMatch.value?.matches_id)) {
        throw e;
      }
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
