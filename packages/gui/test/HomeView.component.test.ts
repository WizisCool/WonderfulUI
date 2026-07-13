import { describe, test, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createTestingPinia } from '@pinia/testing';
import { createMemoryHistory, createRouter } from 'vue-router';
import HomeView from '../src/views/HomeView.vue';
import { matchOptionId } from '../src/utils/match-listbox.ts';
import type { MatchRecord, VideoItem } from '@wonderful-ui/parser';

function mkMatch(openid = 'test-1', overrides: Partial<MatchRecord> = {}): MatchRecord {
  return {
    openID: openid,
    matches_id: overrides.matches_id ?? `match-${Math.random().toString(36).slice(2, 10)}`,
    matches_time: overrides.matches_time ?? 1719000000000,
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
      { path: '/match/:id', name: 'detail', component: { template: '<div />' }, props: true },
    ],
  });
  await router.push('/');
  await router.isReady();

  const wrapper = mount(HomeView, {
    attachTo: document.body,
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
  return { wrapper, router };
}

describe('HomeView', () => {
  test('shows empty state with no matches', async () => {
    const { wrapper } = await mountHome([]);
    expect(wrapper.find('.empty').exists()).toBe(true);
    expect(wrapper.text()).toContain('还没有高光');
    wrapper.unmount();
  });

  test('renders virtual scroll spacer when matches exist', async () => {
    const { wrapper } = await mountHome([mkMatch()]);
    expect(wrapper.find('.vlist-spacer').exists()).toBe(true);
    wrapper.unmount();
  });

  test('renders match count text', async () => {
    const { wrapper } = await mountHome([mkMatch(), mkMatch()]);
    expect(wrapper.text()).toContain('2 条');
    wrapper.unmount();
  });

  test('shows single match count', async () => {
    const { wrapper } = await mountHome([mkMatch()], '__all__');
    expect(wrapper.text()).toContain('1 条');
    wrapper.unmount();
  });

  test('renders pane title', async () => {
    const { wrapper } = await mountHome([]);
    expect(wrapper.text()).toContain('对局列表');
    wrapper.unmount();
  });

  test('has filter toggle button', async () => {
    const { wrapper } = await mountHome([]);
    expect(wrapper.find('.scope-filter-toggle').exists()).toBe(true);
    wrapper.unmount();
  });
});

describe('HomeView listbox a11y', () => {
  test('listbox is focusable and options have stable ids; no focused paint on mount', async () => {
    const matches = [
      mkMatch('test-1', { matches_id: 'id-a', matches_time: 3000 }),
      mkMatch('test-1', { matches_id: 'id-b', matches_time: 2000 }),
    ];
    const { wrapper } = await mountHome(matches);
    const list = wrapper.find('.match-list');
    expect(list.attributes('role')).toBe('listbox');
    expect(list.attributes('tabindex')).toBe('0');
    // No keyboard focus yet → no aria-activedescendant, no .is-focused
    expect(list.attributes('aria-activedescendant')).toBeUndefined();
    expect(wrapper.find('.match-row.is-focused').exists()).toBe(false);
    const opt = wrapper.find(`#${matchOptionId('id-a')}`);
    expect(opt.exists()).toBe(true);
    expect(opt.attributes('role')).toBe('option');
    expect(opt.attributes('tabindex')).toBe('-1');
    wrapper.unmount();
  });

  test('ArrowDown after focus activates first row and paints is-focused only while focused', async () => {
    const matches = [
      mkMatch('test-1', { matches_id: 'id-a', matches_time: 3000 }),
      mkMatch('test-1', { matches_id: 'id-b', matches_time: 2000 }),
      mkMatch('test-1', { matches_id: 'id-c', matches_time: 1000 }),
    ];
    const { wrapper } = await mountHome(matches);
    const list = wrapper.find('.match-list');
    const listEl = list.element as HTMLElement;
    listEl.focus();
    await wrapper.vm.$nextTick();
    await list.trigger('keydown', { key: 'ArrowDown' });
    await wrapper.vm.$nextTick();

    expect(list.attributes('aria-activedescendant')).toBe(matchOptionId('id-a'));
    expect(wrapper.find(`#${matchOptionId('id-a')}`).classes()).toContain('is-focused');
    expect(wrapper.find(`#${matchOptionId('id-b')}`).classes()).not.toContain('is-focused');

    await list.trigger('keydown', { key: 'ArrowDown' });
    await wrapper.vm.$nextTick();
    expect(list.attributes('aria-activedescendant')).toBe(matchOptionId('id-b'));
    expect(wrapper.find(`#${matchOptionId('id-b')}`).classes()).toContain('is-focused');

    listEl.blur();
    await list.trigger('blur');
    await wrapper.vm.$nextTick();
    // Blur clears visual active paint and activedescendant; focusedId kept internally
    expect(list.attributes('aria-activedescendant')).toBeUndefined();
    expect(wrapper.find('.match-row.is-focused').exists()).toBe(false);
    wrapper.unmount();
  });

  test('Enter activates the active option (routes to detail)', async () => {
    const matches = [
      mkMatch('test-1', { matches_id: 'id-a', matches_time: 3000 }),
      mkMatch('test-1', { matches_id: 'id-b', matches_time: 2000 }),
    ];
    const { wrapper, router } = await mountHome(matches);
    const push = vi.spyOn(router, 'push');
    const list = wrapper.find('.match-list');
    (list.element as HTMLElement).focus();
    await list.trigger('keydown', { key: 'ArrowDown' });
    await list.trigger('keydown', { key: 'ArrowDown' });
    await list.trigger('keydown', { key: 'Enter' });
    expect(push).toHaveBeenCalledWith({ name: 'detail', params: { id: 'id-b' } });
    wrapper.unmount();
  });

  test('click selects without painting keyboard focus ring', async () => {
    const matches = [
      mkMatch('test-1', { matches_id: 'id-a', matches_time: 3000 }),
      mkMatch('test-1', { matches_id: 'id-b', matches_time: 2000 }),
    ];
    const { wrapper, router } = await mountHome(matches);
    const push = vi.spyOn(router, 'push');
    const list = wrapper.find('.match-list');
    const rowB = wrapper.find(`#${matchOptionId('id-b')}`);
    // Pointer path: modality off → selection only, no .is-focused pink ring.
    await list.trigger('pointerdown');
    await rowB.trigger('click');
    await wrapper.vm.$nextTick();
    expect(push).toHaveBeenCalledWith({ name: 'detail', params: { id: 'id-b' } });
    expect(document.activeElement).toBe(list.element);
    expect(list.attributes('aria-activedescendant')).toBe(matchOptionId('id-b'));
    expect(rowB.classes()).not.toContain('is-focused');
    wrapper.unmount();
  });

  test('options are not focus targets (no roving tabindex=0)', async () => {
    const { wrapper } = await mountHome([mkMatch('test-1', { matches_id: 'only' })]);
    const rows = wrapper.findAll('.match-row');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.attributes('tabindex')).toBe('-1');
    }
    wrapper.unmount();
  });
});
