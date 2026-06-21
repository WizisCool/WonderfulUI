import { describe, expect, test } from 'bun:test';
import type { MatchRecord, VideoItem } from '@wonderful-ui/parser';
import { normalizeMatchEvents as flattenMatchEvents } from '../src/utils/match-events.ts';

function strictMatch(videos: VideoItem[], agentName = 'Cypher'): MatchRecord {
  return {
    matches_id: 'match',
    agent: { agent_id: '', agent_name: agentName },
    stats: { kills: 10, deaths: 8, assists: 2, score: 200, has_won: true, mode_name: '', rounds_won: 13, rounds_lost: 9, game_level: '' },
    gameStartTime: '2026-06-08 20:00:00.000',
    gameEndTime: '2026-06-08 20:40:00.000',
    videos,
  } as MatchRecord;
}

function shotExt(type: 'kill' | 'death', overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base = type === 'kill'
    ? { KillerPlayerName: 'me', KilledPlayerName: 'enemy', KillerIsMe: 1, KilledIsMe: 0 }
    : { KillerPlayerName: 'enemy', KilledPlayerName: 'me', KillerIsMe: 0, KilledIsMe: 1 };
  return {
    EventName: 'Shot',
    EventTime: '2026-06-08 20:10:00.000',
    AgentName: 'Cypher',
    GetShotRolePart: 1,
    AssistNum: 0,
    WeaponSkinName: 'AssaultRifle_AK_Standard_PrimaryAsset.Default__AssaultRifle_AK_Standard_PrimaryAsset_C',
    ...base,
    ...overrides,
  };
}

function event(
  event_id: string,
  type: 'kill' | 'death',
  event_sTime: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    event_id,
    event_sTime,
    event_type: type,
    event_ext: shotExt(type, overrides),
  };
}

function video(
  video_id: string,
  video_type: string,
  events: { event_id: string; event_sTime: number; event_type: string; event_ext: Record<string, unknown> }[],
  options: { duration?: number; clipTime?: number } = {},
): VideoItem {
  const clipTime = options.clipTime ?? 0;
  return {
    video_id,
    video_type,
    video_duration: options.duration ?? 80_000,
    rounds: [{
      round_id: '',
      round_duration: options.duration ?? 80_000,
      round_sTime: 0,
      round_clips: [{
        clip_id: '',
        clip_duration: options.duration ?? 80_000,
        clip_sTime: clipTime,
        clip_events: events,
      }],
      round_honors: [],
    }],
  } as unknown as VideoItem;
}

describe('flattenMatchEvents', () => {
  test('keeps only complete shot kill/death events and accepts numeric strings in event_ext', () => {
    const kill = event('e1', 'kill', 2500, { GetShotRolePart: '1', AssistNum: '2' });
    const plant = { ...event('e2', 'kill', 3000), event_type: 'plant' };
    const match = strictMatch([video('v1', '击杀集锦', [kill, plant])]);

    const events = flattenMatchEvents(match);

    expect(events).toHaveLength(1);
    expect(events[0]!.timeMs).toBe(2500);
    expect(events[0]!.seekMs).toBe(2500);
    expect(events[0]!.playbackSeekMs).toBe(500);
    expect(events[0]!.isHeadshot).toBe(true);
    expect(events[0]!.assistNum).toBe(2);
  });

  test('deduped kill events prefer the kill montage over a moment duplicate', () => {
    const moment = video('short', '三杀时刻', [
      event('short-event', 'kill', 2000, { KilledPlayerName: 'enemy' }),
    ], { duration: 20_000, clipTime: 11_000 });
    const montage = video('kill-montage', '击杀集锦', [
      event('montage-event', 'kill', 13_000, { KilledPlayerName: 'enemy' }),
    ]);

    const events = flattenMatchEvents(strictMatch([moment, montage]));

    expect(events).toHaveLength(1);
    expect(events[0]!.video.video_id).toBe('kill-montage');
    expect(events[0]!.timeMs).toBe(13_000);
  });

  test('death events are accepted only from the death montage', () => {
    const wrongVideo = video('kill-video', '击杀集锦', [
      event('wrong-video', 'death', 10_000),
    ]);
    const deathVideo = video('death-video', '死亡集锦', [
      event('right-video', 'death', 12_000),
    ]);

    const events = flattenMatchEvents(strictMatch([wrongVideo, deathVideo]));

    expect(events).toHaveLength(1);
    expect(events[0]!.video.video_id).toBe('death-video');
    expect(events[0]!.rawEvent.event_id).toBe('right-video');
  });

  test('moment events use clip_sTime plus event_sTime for playback', () => {
    const highlight = video('highlight-only', '三杀时刻', [
      event('highlight-event', 'kill', 1800),
    ], { duration: 20_000, clipTime: 11_000 });

    const events = flattenMatchEvents(strictMatch([highlight]));

    expect(events).toHaveLength(1);
    expect(events[0]!.timeMs).toBe(12_800);
    expect(events[0]!.seekMs).toBe(12_800);
    expect(events[0]!.playbackSeekMs).toBe(10_800);
  });

  test('merges across-video kills when player names differ by tag or casing', () => {
    const v1 = video('v1', '击杀集锦', [
      event('tagged', 'kill', 20_000, { KilledPlayerName: 'enemy#1234' }),
    ]);
    const v2 = video('v2', '三杀时刻', [
      event('plain', 'kill', 6000, { KilledPlayerName: 'Enemy' }),
    ]);

    const events = flattenMatchEvents(strictMatch([v1, v2]));

    expect(events).toHaveLength(1);
    expect(events[0]!.video.video_id).toBe('v1');
  });

  test('merges across-video events whose EventTime differs only by milliseconds', () => {
    const v1 = video('v1', '击杀集锦', [
      event('first', 'kill', 20_000, { KilledPlayerName: 'enemy', EventTime: '2026-06-08 20:01:14.523' }),
    ]);
    const v2 = video('v2', '三杀时刻', [
      event('drifting', 'kill', 6000, { KilledPlayerName: 'enemy', EventTime: '2026-06-08 20:01:14.899' }),
    ]);

    expect(flattenMatchEvents(strictMatch([v1, v2]))).toHaveLength(1);
  });

  test('quarantines events without EventTime instead of exposing them', () => {
    const v1 = video('v1', '击杀集锦', [
      event('no-time', 'kill', 20_000, { EventTime: undefined }),
    ]);

    expect(flattenMatchEvents(strictMatch([v1]))).toHaveLength(0);
  });

  test('requires explicit local-player flags for kill and death events', () => {
    const v1 = video('v1', '击杀集锦', [
      event('mine', 'kill', 10_000, { KilledPlayerName: 'a', KillerIsMe: 1, KilledIsMe: 0 }),
      event('not-mine', 'kill', 11_000, { KilledPlayerName: 'b', KillerIsMe: 0, KilledIsMe: 0 }),
      event('no-flag', 'kill', 12_000, { KilledPlayerName: 'c', KillerIsMe: undefined, KilledIsMe: 0 }),
    ]);
    const deathVideo = video('death', '死亡集锦', [
      event('mine-death', 'death', 13_000, { KillerIsMe: 0, KilledIsMe: 1 }),
      event('not-mine-death', 'death', 14_000, { KillerIsMe: 0, KilledIsMe: 0 }),
    ]);

    const events = flattenMatchEvents(strictMatch([v1, deathVideo]));

    expect(events.map(e => e.rawEvent.event_id)).toEqual(['mine', 'mine-death']);
  });

  test('rejects cross-match agent mismatches and quarantines missing agent context', () => {
    const mismatch = video('mismatch', '击杀集锦', [
      event('cross-match', 'kill', 10_000, { AgentName: 'Jett' }),
    ]);
    const missingEventAgent = video('missing-event-agent', '击杀集锦', [
      event('no-agent', 'kill', 11_000, { AgentName: undefined }),
    ]);
    const missingMatchAgent = strictMatch([video('missing-match-agent', '击杀集锦', [
      event('empty-match-agent', 'kill', 12_000),
    ])], '');

    expect(flattenMatchEvents(strictMatch([mismatch, missingEventAgent]))).toHaveLength(0);
    expect(flattenMatchEvents(missingMatchAgent)).toHaveLength(0);
  });
});
