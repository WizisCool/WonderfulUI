import { describe, test, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createTestingPinia } from '@pinia/testing';
import { createMemoryHistory, createRouter } from 'vue-router';
import DetailView from '../src/views/DetailView.vue';
import type { MatchRecord, VideoItem } from '@wonderful-ui/parser';

function mkMatch(overrides: Partial<MatchRecord> = {}): MatchRecord {
  return {
    openID: 'test-openid',
    matches_id: 'match-001',
    matches_time: 1719000000000,
    map: { map_id: '/Game/Maps/Ascent/Ascent' },
    mode: 'competitive',
    agent: { agent_name: 'Cypher', agent_id: 'cypher-id' },
    career: { hero_name: '黑梦', map_name: '亚海悬城', game_mode: '标准' },
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

async function mountDetail(match: MatchRecord | null, roundsLoaded = false) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div />' } },
      { path: '/match/:id', name: 'detail', component: { template: '<div />' } },
    ],
  });
  await router.push('/');

  return mount(DetailView, {
    global: {
      plugins: [
        router,
        createTestingPinia({
          createSpy: vi.fn,
          stubActions: false,
          initialState: {
            detail: { selectedMatch: match, momentFilter: null, roundsLoaded },
            account: {
              accounts: [],
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
    expect(wrapper.text()).toContain('黑梦');
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
    const wrapper = await mountDetail(mkMatch(), false);
    expect(wrapper.find('.spin').exists()).toBe(true);
  });

  test('event button disabled when rounds loaded with no events', async () => {
    const wrapper = await mountDetail(mkMatch(), true);
    const btn = wrapper.find('.event-stat-cell');
    if (btn.exists()) {
      expect(btn.attributes('disabled')).toBeDefined();
    }
  });
});
