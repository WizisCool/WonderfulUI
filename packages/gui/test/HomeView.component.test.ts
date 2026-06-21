import { describe, test, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createTestingPinia } from '@pinia/testing';
import { createMemoryHistory, createRouter } from 'vue-router';
import HomeView from '../src/views/HomeView.vue';
import type { MatchRecord, VideoItem } from '@wonderful-ui/parser';

function mkMatch(openid = 'test-1', overrides: Partial<MatchRecord> = {}): MatchRecord {
  return {
    openID: openid,
    matches_id: `match-${Math.random().toString(36).slice(2, 10)}`,
    matches_time: 1719000000000,
    map: { map_id: '/Game/Maps/Ascent/Ascent' },
    mode: 'competitive',
    agent: { agent_name: 'Cypher', agent_id: 'cypher-id' },
    stats: { kills: 14, deaths: 12, assists: 5, score: 3200, has_won: true, rounds_won: 13, rounds_lost: 10, mode_name: '', game_level: '' },
    minRoundId: 0,
    gameStartTime: '2026-06-08 18:00:00',
    gameEndTime: '2026-06-08 18:35:00',
    videos: [{ video_id: 'v1', video_type: '击杀集锦', video_duration: 30000, video_src: '/v.mp4', video_isProcessing: false, rounds: [] }] as unknown as VideoItem[],
    ...overrides,
  } as MatchRecord;
}

async function mountHome(matches: MatchRecord[] = [], selectedAccountId = '__all__') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: HomeView },
      { path: '/match/:id', name: 'detail', component: HomeView, props: true },
    ],
  });
  await router.push('/');

  return mount(HomeView, {
    global: {
      plugins: [
        router,
        createTestingPinia({
          createSpy: vi.fn,
          stubActions: false,
          initialState: {
            account: {
              accounts: [{ openid: 'test-1', path: '', matchCount: matches.length }],
              selectedAccountId,
              matches,
              accountLabels: new Map([['test-1', '测试号']]),
              assetPathCache: new Map(),
              matchAchievements: new Map(),
            },
            filter: {
              filters: {
                heroes: [], maps: [], modes: [], results: [], achievements: [], videoTypes: [],
                dateRange: [null, null], query: '',
                kills: [null, null], deaths: [null, null], assists: [null, null],
                kda: [null, null], score: [null, null], roundsWon: [null, null], videoCount: [null, null],
              },
              filterBarOpen: false,
            },
            detail: { selectedMatch: null, momentFilter: null, roundsLoaded: false },
            player: { video: null, matchContext: null, seekMs: undefined, isOpen: false },
          },
        }),
      ],
    },
  });
}

describe('HomeView', () => {
  test('shows empty state with no matches', async () => {
    const wrapper = await mountHome([]);
    expect(wrapper.find('.empty').exists()).toBe(true);
    expect(wrapper.text()).toContain('这个账户还没录到高光');
  });

  test('renders virtual scroll spacer when matches exist', async () => {
    const wrapper = await mountHome([mkMatch()]);
    expect(wrapper.find('.vlist-spacer').exists()).toBe(true);
  });

  test('renders match count text', async () => {
    const wrapper = await mountHome([mkMatch(), mkMatch()]);
    expect(wrapper.text()).toContain('2 条');
  });

  test('shows single match count', async () => {
    const wrapper = await mountHome([mkMatch()], '__all__');
    expect(wrapper.text()).toContain('1 条');
  });

  test('renders pane title', async () => {
    const wrapper = await mountHome([]);
    expect(wrapper.text()).toContain('对局列表');
  });

  test('has filter toggle button', async () => {
    const wrapper = await mountHome([]);
    expect(wrapper.find('.scope-filter-toggle').exists()).toBe(true);
  });
});
