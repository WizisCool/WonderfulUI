import { describe, expect, test } from 'bun:test';
import type { MatchRecord } from '@wonderful-ui/parser';
import { shouldLoadMatchRounds } from '../src/app.ts';

function match(overrides: Partial<MatchRecord> = {}): MatchRecord {
  return {
    matches_id: 'match',
    openID: 'openid',
    agent: { agent_id: '', agent_name: 'Cypher' },
    stats: { kills: 1, deaths: 1, assists: 0, score: 100, has_won: true, mode_name: '', rounds_won: 1, rounds_lost: 0, game_level: '' },
    videos: [{
      video_id: 'video',
      video_type: '击杀集锦',
      video_src: 'video.mp4',
      video_duration: 60_000,
    }],
    ...overrides,
  } as MatchRecord;
}

describe('shouldLoadMatchRounds', () => {
  test('asks for rounds after a library refresh replaces the selected match with a stripped copy', () => {
    expect(shouldLoadMatchRounds(match(), new Set())).toBe(true);
  });

  test('does not ask for rounds when there is no selected match, no video, or the match is already loaded', () => {
    expect(shouldLoadMatchRounds(null, new Set())).toBe(false);
    expect(shouldLoadMatchRounds(match({ videos: [] }), new Set())).toBe(false);
    expect(shouldLoadMatchRounds(match(), new Set(['match']))).toBe(false);
  });
});
