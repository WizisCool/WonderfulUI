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
  const roundsLoading = ref(false);
  const roundsError = ref<string | null>(null);
  let selectionVersion = 0;

  const hasVideo = computed(() => (selectedMatch.value?.videos.length ?? 0) > 0);

  async function fetchRounds(): Promise<boolean> {
    const m = selectedMatch.value;
    if (!m) return false;
    if (roundsLoaded.value) return true;
    if (roundsLoading.value) return false;
    if (m.videos.length === 0) {
      roundsLoaded.value = true;
      roundsError.value = null;
      return true;
    }
    const requestMatchId = m.matches_id;
    const requestSelectionVersion = selectionVersion;
    roundsLoading.value = true;
    roundsError.value = null;
    try {
      const full = await invoke<MatchRecord>('get_match_rounds', {
        openid: m.openID,
        matchId: m.matches_id,
      });
      // Discard late responses after the user selected another match.
      if (!shouldCommitMatchRounds(
        requestMatchId,
        selectedMatch.value?.matches_id,
        requestSelectionVersion,
        selectionVersion,
      )) {
        return false;
      }
      for (const liveV of m.videos) {
        const fullV = full.videos.find(v => v.video_id === liveV.video_id);
        if (fullV) liveV.rounds = fullV.rounds;
      }
      roundsLoaded.value = true;
      return true;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      clientLog('error', 'detail', `fetchRounds: ${message}`);
      if (shouldCommitMatchRounds(
        requestMatchId,
        selectedMatch.value?.matches_id,
        requestSelectionVersion,
        selectionVersion,
      )) {
        // Keep backend paths / database details in the local log. The visible
        // state only needs a recoverable, non-technical message.
        roundsError.value = '事件数据加载失败，请重试';
      }
      return false;
    } finally {
      if (requestSelectionVersion === selectionVersion) {
        roundsLoading.value = false;
      }
    }
  }

  function selectMatch(m: MatchRecord | null) {
    selectionVersion += 1;
    selectedMatch.value = m;
    momentFilter.value = null;
    roundsLoaded.value = !!m && m.videos.length === 0;
    roundsLoading.value = false;
    roundsError.value = null;
  }

  function setMomentFilter(type: string | null) {
    momentFilter.value = momentFilter.value === type ? null : type;
  }

  return {
    selectedMatch, momentFilter, roundsLoaded, roundsLoading, roundsError, hasVideo,
    fetchRounds, selectMatch, setMomentFilter,
  };
});
