import { describe, test, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createTestingPinia } from '@pinia/testing';
import FilterBar from '../src/components/match/FilterBar.vue';
import type { MatchRecord } from '@wonderful-ui/parser';

function mkMatch(openid = 'test-1', hero = 'Cypher', mapId = 'Ascent', kills = 10): MatchRecord {
  return {
    openID: openid,
    matches_id: `match-${Math.random().toString(36).slice(2, 8)}`,
    matches_time: 1719000000000,
    map: { map_id: `/Game/Maps/${mapId}/${mapId}` },
    mode: 'competitive',
    agent: { agent_name: hero, agent_id: `${hero}-id` },
    career: { hero_name: '黑梦', map_name: '亚海悬城' },
    stats: { kills, deaths: 5, assists: 3, score: 2000, has_won: true, rounds_won: 13, rounds_lost: 5, mode_name: '', game_level: '' },
    minRoundId: 0,
    gameStartTime: '2026-06-08 18:00:00',
    gameEndTime: '2026-06-08 18:30:00',
    videos: [],
  } as MatchRecord;
}

function mountFilter(overrides: { matches?: MatchRecord[]; filters?: Record<string, unknown> } = {}) {
  const matches = overrides.matches ?? [mkMatch()];
  return mount(FilterBar, {
    global: {
      plugins: [createTestingPinia({
        createSpy: vi.fn,
        stubActions: false,
        initialState: {
          account: {
            accounts: [{ openid: 'test-1', path: '', matchCount: matches.length }],
            selectedAccountId: '__all__',
            matches,
            accountLabels: new Map(),
            assetPathCache: new Map(),
          },
          filter: {
            filters: {
              heroes: [], maps: [], modes: [], results: [], achievements: [], videoTypes: [],
              dateRange: [null, null], query: '',
              kills: [null, null], deaths: [null, null], assists: [null, null],
              kda: [null, null], score: [null, null], roundsWon: [null, null], videoCount: [null, null],
              ...overrides.filters,
            },
            filterBarOpen: false,
          },
        },
      })],
    },
  });
}

describe('FilterBar', () => {
  test('renders without crashing', () => {
    const wrapper = mountFilter();
    expect(wrapper.find('.filter-section').exists()).toBe(true);
  });

  test('renders hero and map sections', () => {
    const m1 = mkMatch('a', 'Cypher', 'Ascent');
    const m2 = { ...mkMatch('a', 'Omen', 'Bind'), agent: { agent_name: 'Omen', agent_id: 'o-id' }, career: { hero_name: '幽影', map_name: '源工重镇' } };
    const wrapper = mountFilter({ matches: [m1, m2 as MatchRecord] });
    expect(wrapper.text()).toContain('英雄');
    expect(wrapper.text()).toContain('地图');
  });

  test('active filter chip has is-active class', () => {
    const m = mkMatch('a', 'Cypher', 'Ascent');
    const wrapper = mountFilter({
      filters: { heroes: ['黑梦'] },
      matches: [m],
    });
    expect(wrapper.find('.filter-chip.is-active').exists()).toBe(true);
  });

  test('renders date section', () => {
    const wrapper = mountFilter();
    expect(wrapper.text()).toContain('日期');
  });

  test('renders performance filter when multiple matches provide range', () => {
    const matches = [mkMatch('a', 'Cypher', 'Ascent', 5), mkMatch('a', 'Omen', 'Bind', 20)];
    const wrapper = mountFilter({ matches });
    expect(wrapper.text()).toContain('表现筛选');
  });

  test('toggles performance filter expand', async () => {
    const matches = [mkMatch('a', 'Cypher', 'Ascent', 5), mkMatch('a', 'Omen', 'Bind', 20)];
    const wrapper = mountFilter({ matches });
    const body = wrapper.find('.filter-num-group-body');
    expect(body.classes()).toContain('is-collapsed');
    await wrapper.find('.filter-num-group-header').trigger('click');
    expect(body.classes()).not.toContain('is-collapsed');
  });
});
