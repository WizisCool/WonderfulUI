import { describe, test, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createTestingPinia } from '@pinia/testing';
import { createMemoryHistory, createRouter } from 'vue-router';
import DetailView from '../src/views/DetailView.vue';
import type { MatchRecord, VideoItem } from '@wonderful-ui/parser';
import { useAccountStore } from '../src/stores/account.ts';
import { useDetailStore } from '../src/stores/detail.ts';

function mkMatch(overrides: Partial<MatchRecord> = {}): MatchRecord {
  return {
    openID: 'test-openid',
    matches_id: 'match-001',
    matches_time: 1719000000000,
    map: { map_id: '/Game/Maps/Ascent/Ascent' },
    mode: 'competitive',
    agent: { agent_name: 'Cypher', agent_id: 'cypher-id' },
    career: { hero_name: '零', map_name: '亚海悬城', game_mode: '标准' },
    stats: { kills: 20, deaths: 10, assists: 5, score: 4500, has_won: true, rounds_won: 13, rounds_lost: 8, mode_name: '', game_level: '' },
    minRoundId: 0,
    gameStartTime: '2026-06-08 18:00:00',
    gameEndTime: '2026-06-08 18:35:00',
    videos: [
      { video_id: 'v1', video_name: '击杀集锦', video_type: '击杀集锦', video_duration: 30000, video_src: '/v1.mp4', video_isProcessing: false, video_resolution: '1920x1080', rounds: [] },
      { video_id: 'v2', video_name: '死亡集锦', video_type: '死亡集锦', video_duration: 25000, video_src: '/v2.mp4', video_isProcessing: false, video_resolution: '1920x1080', rounds: [] },
    ] as unknown as VideoItem[],
    ...overrides,
  } as MatchRecord;
}

interface RoundState {
  roundsLoaded?: boolean;
  roundsLoading?: boolean;
  roundsError?: string | null;
}

async function mountDetail(match: MatchRecord | null, roundState: RoundState = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div />' } },
      { path: '/match/:id', name: 'detail', component: { template: '<div />' } },
    ],
  });
  await router.push(match ? `/match/${match.matches_id}` : '/');
  await router.isReady();

  return mount(DetailView, {
    global: {
      plugins: [
        router,
        createTestingPinia({
          createSpy: vi.fn,
          // Component rendering tests should not execute the browser-debug
          // rounds IPC action; store/action behavior has dedicated tests.
          stubActions: true,
          initialState: {
            detail: {
              selectedMatch: match,
              momentFilter: null,
              roundsLoaded: roundState.roundsLoaded ?? false,
              roundsLoading: roundState.roundsLoading ?? false,
              roundsError: roundState.roundsError ?? null,
            },
            account: {
              accounts: match ? [{ openid: match.openID, path: '', matchCount: 1 }] : [],
              matches: match ? [match] : [],
              assetPathCache: new Map(),
            },
            player: { video: null, matchContext: null, seekMs: undefined, isOpen: false },
          },
        }),
      ],
    },
  });
}

describe('DetailView', () => {
  test('shows empty state when no match', async () => {
    const wrapper = await mountDetail(null);
    expect(wrapper.text()).toContain('没有选中');
  });

  test('renders agent name when match selected', async () => {
    const wrapper = await mountDetail(mkMatch());
    expect(wrapper.text()).toContain('零');
  });

  test('renders K/D/A stats', async () => {
    const wrapper = await mountDetail(mkMatch());
    expect(wrapper.text()).toContain('20');
    expect(wrapper.text()).toContain('10');
    expect(wrapper.text()).toContain('5');
  });

  test('renders win result class', async () => {
    const wrapper = await mountDetail(mkMatch({ stats: { kills: 1, deaths: 1, assists: 1, score: 100, has_won: true, rounds_won: 13, rounds_lost: 5, mode_name: '', game_level: '' } }));
    expect(wrapper.find('.result-win').exists()).toBe(true);
  });

  test('renders loss result class', async () => {
    const wrapper = await mountDetail(mkMatch({ stats: { kills: 1, deaths: 1, assists: 1, score: 100, has_won: false, rounds_won: 5, rounds_lost: 13, mode_name: '', game_level: '' } }));
    expect(wrapper.find('.result-loss').exists()).toBe(true);
  });

  test('renders map name', async () => {
    const wrapper = await mountDetail(mkMatch());
    expect(wrapper.text()).toContain('亚海悬城');
  });

  test('shows spinner when rounds not loaded', async () => {
    const wrapper = await mountDetail(mkMatch());
    expect(wrapper.find('.spin').exists()).toBe(true);
    expect(wrapper.find('.event-stat-cell').attributes('aria-label')).toBe('正在加载本局事件');
  });

  test('event button disabled when rounds loaded with no events', async () => {
    const wrapper = await mountDetail(mkMatch(), { roundsLoaded: true });
    const btn = wrapper.find('.event-stat-cell');
    expect(btn.attributes('disabled')).toBeDefined();
    expect(btn.attributes('aria-label')).toBe('这场高光没有事件数据');
  });

  test('shows a retry action after round loading fails', async () => {
    const wrapper = await mountDetail(mkMatch(), {
      roundsError: '事件数据加载失败，请重试',
    });
    const detail = useDetailStore();
    const btn = wrapper.find('.event-stat-cell');

    expect(btn.attributes('disabled')).toBeUndefined();
    expect(btn.attributes('aria-label')).toBe('事件数据加载失败，点击重试');
    expect(btn.text()).toContain('重试');
    expect(btn.find('.stat-icon svg').exists()).toBe(true);

    vi.mocked(detail.fetchRounds).mockClear();
    await btn.trigger('click');
    expect(detail.fetchRounds).toHaveBeenCalledOnce();
  });

  test('reselects the fresh match object when a library refresh keeps the same id', async () => {
    const original = mkMatch();
    await mountDetail(original, { roundsLoaded: true });
    const account = useAccountStore();
    const detail = useDetailStore();
    const refreshed = mkMatch({ career: { ...original.career, hero_name: '更新后的捷风' } });

    vi.mocked(detail.selectMatch).mockClear();
    account.matches = [refreshed];
    await Promise.resolve();

    expect(detail.selectMatch).toHaveBeenCalledWith(refreshed);
  });

  test('clears a selected match that disappears after a library refresh', async () => {
    const original = mkMatch();
    await mountDetail(original, { roundsLoaded: true });
    const account = useAccountStore();
    const detail = useDetailStore();

    vi.mocked(detail.selectMatch).mockClear();
    account.matches = [];
    await Promise.resolve();

    expect(detail.selectMatch).toHaveBeenCalledWith(null);
  });
});
