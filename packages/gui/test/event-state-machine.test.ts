import { describe, expect, test } from 'bun:test';
import type { MatchRecord, RoundClip, RoundItem, VideoItem } from '@wonderful-ui/parser';
import { normalizeMatchEvents } from '../src/utils/match-events.ts';
import { resolveClipEventState } from '../src/utils/event-state-machine.ts';

function clip(event: Record<string, unknown>, clip_sTime = 0): RoundClip {
  return {
    clip_id: '',
    clip_duration: 0,
    clip_sTime,
    clip_events: [{
      event_id: String(event.event_id ?? 'event'),
      event_sTime: Number(event.event_sTime ?? 6000),
      event_type: String(event.event_type ?? 'kill'),
      event_ext: event.event_ext as Record<string, unknown>,
    }],
  };
}

function video(video_type: string, clipItem: RoundClip, duration = 60_000): VideoItem {
  return {
    video_id: `${video_type}-video`,
    video_type,
    video_duration: duration,
    rounds: [{
      round_id: '',
      round_duration: duration,
      round_sTime: 0,
      round_clips: [clipItem],
      round_honors: [],
    }],
  } as unknown as VideoItem;
}

function match(videos: VideoItem[]): MatchRecord {
  return {
    matches_id: 'match',
    agent: { agent_id: '', agent_name: 'Cypher' },
    stats: { kills: 1, deaths: 1, assists: 0, score: 100, has_won: true, mode_name: '', rounds_won: 1, rounds_lost: 0, game_level: '' },
    gameStartTime: '2026-06-08 20:00:00.000',
    gameEndTime: '2026-06-08 20:40:00.000',
    videos,
  } as MatchRecord;
}

function shot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    EventName: 'Shot',
    EventTime: '2026-06-08 20:10:00.000',
    AgentName: 'Cypher',
    KillerPlayerName: 'me',
    KilledPlayerName: 'enemy',
    KillerIsMe: 1,
    KilledIsMe: 0,
    GetShotRolePart: 1,
    WeaponSkinName: 'AssaultRifle_AK_Standard_PrimaryAsset.Default__AssaultRifle_AK_Standard_PrimaryAsset_C',
    ...overrides,
  };
}

describe('resolveClipEventState', () => {
  test('uses event_sTime as the video timestamp for montage events', () => {
    const c = clip({ event_sTime: 130_000, event_ext: shot() });
    const v = video('击杀集锦', c, 140_000);
    const state = resolveClipEventState(match([v]), v, v.rounds![0]!, c, c.clip_events[0]!, 0);

    expect(state.kind).toBe('montage');
    if (state.kind !== 'montage') throw new Error('expected montage event');
    expect(state.timeMs).toBe(130_000);
    expect(state.seekMs).toBe(130_000);
  });

  test('uses clip_sTime plus event_sTime for multi-clip moment events', () => {
    const c = clip({ event_sTime: 6_000, event_ext: shot() }, 11_000);
    const v = video('三杀时刻', c, 30_000);
    const state = resolveClipEventState(match([v]), v, v.rounds![0]!, c, c.clip_events[0]!, 0);

    expect(state.kind).toBe('moment');
    if (state.kind !== 'moment') throw new Error('expected moment event');
    expect(state.timeMs).toBe(17_000);
    expect(state.seekMs).toBe(17_000);
  });

  test('quarantines incomplete shot-like events instead of exposing them to UI', () => {
    const c = clip({
      event_sTime: 6_000,
      event_ext: shot({ EventTime: undefined }),
    });
    const v = video('击杀集锦', c);
    const state = resolveClipEventState(match([v]), v, v.rounds![0]!, c, c.clip_events[0]!, 0);

    expect(state.kind).toBe('quarantined');
    expect(normalizeMatchEvents(match([v]))).toHaveLength(0);
  });

  test('rejects death events in kill montages and kill events in death montages', () => {
    const deathInKill = clip({
      event_type: 'death',
      event_ext: shot({ KillerPlayerName: 'enemy', KilledPlayerName: 'me', KillerIsMe: 0, KilledIsMe: 1 }),
    });
    const v = video('击杀集锦', deathInKill);
    const state = resolveClipEventState(match([v]), v, v.rounds![0]!, deathInKill, deathInKill.clip_events[0]!, 0);

    expect(state.kind).toBe('rejected');
    if (state.kind !== 'rejected') throw new Error('expected rejected event');
    expect(state.reason).toBe('video-type-event-type-mismatch');
  });

  test('keeps unknown shot parts visible but never marks them as headshots', () => {
    const c = clip({ event_sTime: 6_000, event_ext: shot({ GetShotRolePart: 5 }) });
    const v = video('击杀集锦', c);
    const events = normalizeMatchEvents(match([v]));

    expect(events).toHaveLength(1);
    expect(events[0]!.isHeadshot).toBe(false);
  });

  test('moment events with negative clip_sTime fall back to event_sTime when still in video', () => {
    const c = clip({ event_sTime: 6_000, event_ext: shot() }, -1);
    const v = video('三杀时刻', c, 30_000);
    const state = resolveClipEventState(match([v]), v, v.rounds![0]!, c, c.clip_events[0]!, 0);

    expect(state.kind).toBe('moment');
    if (state.kind !== 'moment') throw new Error('expected moment event');
    expect(state.timeMs).toBe(6_000);
  });
});
