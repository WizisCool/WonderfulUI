import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { MatchRecord, RoundItem, VideoItem } from '@wonderful-ui/parser';

const adapter = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock('../src/tauri-adapter.ts', () => ({
  invoke: adapter.invoke,
}));

import { useDetailStore } from '../src/stores/detail.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function round(id: string): RoundItem {
  return {
    round_id: id,
    round_duration: 1000,
    round_sTime: 0,
    round_honors: [],
    round_clips: [],
  };
}

function match(id: string, withVideo = true): MatchRecord {
  const videos = withVideo
    ? [{
        video_id: `${id}-video`,
        video_name: '击杀集锦',
        video_type: '击杀集锦',
        video_duration: 30_000,
        video_src: `D:\\highlights\\${id}.mp4`,
        video_isProcessing: false,
        rounds: [],
      } as unknown as VideoItem]
    : [];
  return {
    openID: 'test-openid',
    matches_id: id,
    matches_time: 1_719_000_000_000,
    map: { map_id: '/Game/Maps/Ascent/Ascent' },
    mode: 'competitive',
    agent: { agent_name: 'Jett', agent_id: 'jett-id' },
    stats: {
      kills: 20,
      deaths: 10,
      assists: 5,
      score: 4500,
      has_won: true,
      rounds_won: 13,
      rounds_lost: 8,
      mode_name: '',
      game_level: '',
    },
    minRoundId: 0,
    gameStartTime: '2026-06-08 18:00:00',
    gameEndTime: '2026-06-08 18:35:00',
    videos,
  } as MatchRecord;
}

function fullMatch(source: MatchRecord, roundId: string): MatchRecord {
  return {
    ...source,
    videos: source.videos.map(video => ({
      ...video,
      rounds: [round(roundId)],
    })),
  };
}

describe('detail store round loading', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setActivePinia(createPinia());
    adapter.invoke.mockReset();
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  test('turns a rejected IPC call into a retryable state and can recover', async () => {
    const store = useDetailStore();
    const selected = match('m1');
    store.selectMatch(selected);
    adapter.invoke.mockRejectedValueOnce(new Error('database path is busy'));

    await expect(store.fetchRounds()).resolves.toBe(false);
    expect(store.roundsLoading).toBe(false);
    expect(store.roundsLoaded).toBe(false);
    expect(store.roundsError).toBe('事件数据加载失败，请重试');

    adapter.invoke.mockResolvedValueOnce(fullMatch(selected, 'retry-round'));
    await expect(store.fetchRounds()).resolves.toBe(true);
    expect(store.roundsError).toBeNull();
    expect(store.roundsLoaded).toBe(true);
    expect(selected.videos[0]?.rounds?.[0]?.round_id).toBe('retry-round');
  });

  test('does not let an old selection response clear or mutate the new selection', async () => {
    const store = useDetailStore();
    const first = match('m1');
    const second = match('m2');
    const firstReply = deferred<MatchRecord>();
    const secondReply = deferred<MatchRecord>();
    adapter.invoke
      .mockReturnValueOnce(firstReply.promise)
      .mockReturnValueOnce(secondReply.promise);

    store.selectMatch(first);
    const firstRequest = store.fetchRounds();
    store.selectMatch(second);
    const secondRequest = store.fetchRounds();

    firstReply.resolve(fullMatch(first, 'stale-round'));
    await expect(firstRequest).resolves.toBe(false);
    expect(first.videos[0]?.rounds).toEqual([]);
    expect(store.selectedMatch?.matches_id).toBe('m2');
    expect(store.roundsLoading).toBe(true);

    secondReply.resolve(fullMatch(second, 'current-round'));
    await expect(secondRequest).resolves.toBe(true);
    expect(store.roundsLoading).toBe(false);
    expect(second.videos[0]?.rounds?.[0]?.round_id).toBe('current-round');
  });

  test('rejects an old response when the same match id is reselected as a new object', async () => {
    const store = useDetailStore();
    const original = match('same-id');
    const replacement = match('same-id');
    const originalReply = deferred<MatchRecord>();
    const replacementReply = deferred<MatchRecord>();
    adapter.invoke
      .mockReturnValueOnce(originalReply.promise)
      .mockReturnValueOnce(replacementReply.promise);

    store.selectMatch(original);
    const originalRequest = store.fetchRounds();
    store.selectMatch(replacement);
    const replacementRequest = store.fetchRounds();

    originalReply.resolve(fullMatch(original, 'obsolete-round'));
    await expect(originalRequest).resolves.toBe(false);
    expect(original.videos[0]?.rounds).toEqual([]);
    expect(replacement.videos[0]?.rounds).toEqual([]);
    expect(store.roundsLoading).toBe(true);

    replacementReply.resolve(fullMatch(replacement, 'replacement-round'));
    await expect(replacementRequest).resolves.toBe(true);
    expect(replacement.videos[0]?.rounds?.[0]?.round_id).toBe('replacement-round');
  });

  test('suppresses duplicate in-flight IPC calls', async () => {
    const store = useDetailStore();
    const selected = match('m1');
    const reply = deferred<MatchRecord>();
    adapter.invoke.mockReturnValueOnce(reply.promise);
    store.selectMatch(selected);

    const firstRequest = store.fetchRounds();
    await expect(store.fetchRounds()).resolves.toBe(false);
    expect(adapter.invoke).toHaveBeenCalledOnce();

    reply.resolve(fullMatch(selected, 'only-round'));
    await expect(firstRequest).resolves.toBe(true);
  });

  test('marks a video-less match complete without IPC', async () => {
    const store = useDetailStore();
    store.selectMatch(match('empty', false));

    expect(store.roundsLoaded).toBe(true);
    await expect(store.fetchRounds()).resolves.toBe(true);
    expect(adapter.invoke).not.toHaveBeenCalled();
  });
});
