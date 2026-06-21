import { describe, expect, test } from 'bun:test';
import type { MatchRecord, VideoItem } from '@wonderful-ui/parser';
import { eventMarkersForVideo, normalizeMatchEvents } from '../src/utils/match-events.ts';

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

function video(video_id: string, video_type: string, event_sTime: number, ext: Record<string, unknown>, clipTime = 0): VideoItem {
  return {
    video_id,
    video_type,
    video_src: `${video_id}.mp4`,
    video_duration: 140_000,
    rounds: [{
      round_id: '',
      round_duration: 140_000,
      round_sTime: 70_000,
      round_clips: [{
        clip_id: '',
        clip_duration: 140_000,
        clip_sTime: clipTime,
        clip_events: [{
          event_id: `${video_id}-event`,
          event_sTime,
          event_type: 'kill',
          event_ext: ext,
        }],
      }],
      round_honors: [],
    }],
  } as unknown as VideoItem;
}

function match(videos: VideoItem[]): MatchRecord {
  return {
    matches_id: 'match',
    agent: { agent_id: '', agent_name: 'Cypher' },
    stats: { kills: 1, deaths: 0, assists: 0, score: 100, has_won: true, mode_name: '', rounds_won: 1, rounds_lost: 0, game_level: '' },
    gameStartTime: '2026-06-08 20:00:00.000',
    gameEndTime: '2026-06-08 20:40:00.000',
    videos,
  } as MatchRecord;
}

describe('normalizeMatchEvents', () => {
  test('montage events use event_sTime directly instead of adding round_sTime again', () => {
    const v = video('montage', '击杀集锦', 130_000, shot());

    const events = normalizeMatchEvents(match([v]));

    expect(events).toHaveLength(1);
    expect(events[0]!.timeMs).toBe(130_000);
    expect(events[0]!.seekMs).toBe(130_000);
  });

  test('moment events use clip_sTime plus event_sTime', () => {
    const v = video('moment', '三杀时刻', 6_000, shot(), 11_000);

    const events = normalizeMatchEvents(match([v]));

    expect(events).toHaveLength(1);
    expect(events[0]!.timeMs).toBe(17_000);
  });

  test('does not expose non-shot or incomplete shot-like events', () => {
    const nonShot = video('non-shot', '击杀集锦', 10_000, shot({ EventName: 'Damage' }));
    const noVictim = video('no-victim', '击杀集锦', 11_000, shot({ KilledPlayerName: undefined }));
    const noFlag = video('no-flag', '击杀集锦', 12_000, shot({ KillerIsMe: undefined }));

    expect(normalizeMatchEvents(match([nonShot, noVictim, noFlag]))).toHaveLength(0);
  });

  test('drops same-agent events outside the match time window', () => {
    const oldEvent = video('old', '击杀集锦', 10_000, shot({
      EventTime: '2026-06-08 19:00:00.000',
      KilledPlayerName: 'old enemy',
    }));
    const realEvent = video('real', '击杀集锦', 11_000, shot({
      EventTime: '2026-06-08 20:10:00.000',
      KilledPlayerName: 'real enemy',
    }));

    const events = normalizeMatchEvents(match([oldEvent, realEvent]));

    expect(events).toHaveLength(1);
    expect(events[0]!.rawEvent.event_id).toBe('real-event');
  });

  test('progress-bar markers use the same resolved event time as the visible event list', () => {
    const montage = video('montage', '击杀集锦', 130_000, shot({ KilledPlayerName: 'enemy-a' }));
    const moment = video('moment', '三杀时刻', 6_000, shot({
      EventTime: '2026-06-08 20:11:00.000',
      KilledPlayerName: 'enemy-b',
    }), 11_000);
    const m = match([montage, moment]);

    expect(eventMarkersForVideo(montage, m)).toEqual([expect.objectContaining({
      timeMs: 130_000,
      type: 'kill',
      isHeadshot: true,
    })]);
    expect(eventMarkersForVideo(moment, m)).toEqual([expect.objectContaining({
      timeMs: 17_000,
      type: 'kill',
      isHeadshot: true,
    })]);
  });

  test('progress-bar markers stay on moment videos even when the event is deduped to montage for the list', () => {
    const sharedEvent = {
      EventTime: '2026-06-08 20:12:00.000',
      KilledPlayerName: 'same-enemy',
    };
    const montage = video('montage', '击杀集锦', 130_000, shot(sharedEvent));
    const moment = video('moment', '三杀时刻', 6_000, shot(sharedEvent), 11_000);
    const m = match([montage, moment]);

    expect(normalizeMatchEvents(m)).toEqual([expect.objectContaining({
      video: montage,
      timeMs: 130_000,
    })]);
    expect(eventMarkersForVideo(moment, m)).toEqual([expect.objectContaining({
      timeMs: 17_000,
      type: 'kill',
      isHeadshot: true,
    })]);
  });

  test('progress-bar markers dedupe the same accepted kill inside one video', () => {
    const duplicateExt = shot({
      EventTime: '2026-06-08 20:13:00.000',
      KilledPlayerName: 'same-enemy',
    });
    const moment = video('moment', '三杀时刻', 6_000, duplicateExt, 11_000);
    moment.rounds![0]!.round_clips[0]!.clip_events.push({
      event_id: 'moment-event-duplicate',
      event_sTime: 6_150,
      event_type: 'kill',
      event_ext: duplicateExt,
    });
    const m = match([moment]);

    expect(eventMarkersForVideo(moment, m)).toEqual([expect.objectContaining({
      timeMs: 17_000,
      type: 'kill',
      playerName: 'same-enemy',
    })]);
  });
});
