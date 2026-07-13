import { describe, test, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createTestingPinia } from '@pinia/testing';
import MatchCard from '../src/components/match/MatchCard.vue';
import type { MatchRecord } from '@wonderful-ui/parser';

function mkMatch(overrides: Partial<MatchRecord> = {}): MatchRecord {
  return {
    openID: 'test-openid',
    matches_id: 'match-001',
    matches_time: 1719000000000,
    map: { map_id: '/Game/Maps/Ascent/Ascent' },
    mode: 'competitive',
    agent: { agent_name: 'Cypher', agent_id: 'cypher-id' },
    career: { hero_name: '黑梦', map_name: '亚海悬城' },
    stats: { kills: 14, deaths: 12, assists: 5, score: 3200, has_won: true, rounds_won: 13, rounds_lost: 10, mode_name: '', game_level: '' },
    minRoundId: 0,
    gameStartTime: '2026-06-08 18:00:00',
    gameEndTime: '2026-06-08 18:35:00',
    videos: [],
    ...overrides,
  } as MatchRecord;
}

function mountCard(
  match: MatchRecord,
  accountLabel = 'test',
  isSelected = false,
  isFocused = false,
) {
  return mount(MatchCard, {
    props: { match, isSelected, isFocused, accountLabel },
    global: {
      plugins: [createTestingPinia({
        createSpy: vi.fn,
        stubActions: false,
        initialState: {
          account: {
            accounts: [],
            assetPathCache: new Map(),
            matchAchievements: new Map(),
          },
        },
      })],
    },
  });
}

describe('MatchCard', () => {
  test('renders agent name from career', () => {
    const wrapper = mountCard(mkMatch());
    expect(wrapper.text()).toContain('黑梦');
  });

  test('renders KDA text', () => {
    const wrapper = mountCard(mkMatch());
    expect(wrapper.text()).toContain('14/12/5');
  });

  test('renders win result and class', () => {
    const m = mkMatch({ stats: { kills: 10, deaths: 8, assists: 3, score: 2500, has_won: true, rounds_won: 13, rounds_lost: 5, mode_name: '', game_level: '' } });
    const wrapper = mountCard(m);
    expect(wrapper.text()).toContain('胜');
    expect(wrapper.find('.result-win').exists()).toBe(true);
  });

  test('renders loss result and class', () => {
    const m = mkMatch({ stats: { kills: 10, deaths: 8, assists: 3, score: 2500, has_won: false, rounds_won: 5, rounds_lost: 13, mode_name: '', game_level: '' } });
    const wrapper = mountCard(m);
    expect(wrapper.text()).toContain('败');
    expect(wrapper.find('.result-loss').exists()).toBe(true);
  });

  test('applies is-selected class when selected', () => {
    const wrapper = mountCard(mkMatch(), 'test', true);
    expect(wrapper.find('.is-selected').exists()).toBe(true);
  });

  test('no is-selected class when not selected', () => {
    const wrapper = mountCard(mkMatch(), 'test', false);
    expect(wrapper.find('.is-selected').exists()).toBe(false);
  });

  test('renders video count chip', () => {
    const m = mkMatch({ videos: [{ video_id: 'v1' } as any, { video_id: 'v2' } as any] });
    const wrapper = mountCard(m);
    expect(wrapper.text()).toContain('× 2');
  });

  test('emits click on match-row click', async () => {
    const wrapper = mountCard(mkMatch());
    await wrapper.find('.match-row').trigger('click');
    expect(wrapper.emitted('click')).toHaveLength(1);
  });

  test('emits dblclick on double click', async () => {
    const wrapper = mountCard(mkMatch());
    await wrapper.find('.match-row').trigger('dblclick');
    expect(wrapper.emitted('dblclick')).toHaveLength(1);
  });

  test('renders account label', () => {
    const wrapper = mountCard(mkMatch(), '我的大号');
    expect(wrapper.text()).toContain('我的大号');
  });

  test('renders MVP badge when achievement exists', () => {
    const m = mkMatch({ matches_id: 'mvp-match' });
    const wrapper = mount(MatchCard, {
      props: { match: m, isSelected: false, accountLabel: 'test' },
      global: {
        plugins: [createTestingPinia({
          createSpy: vi.fn,
          stubActions: false,
          initialState: {
            account: {
              accounts: [{ openid: 'test', path: '', matchCount: 1, achievements: [{ matchesId: 'mvp-match', achvType: 'mvp', typeStr: 'MVP' }] }],
              assetPathCache: new Map(),
            },
          },
        })],
      },
    });
    expect(wrapper.find('.cover-badge-mvp').exists()).toBe(true);
  });

  test('shows map fallback when no image available', () => {
    // Unknown map_id + empty career → no CDN/career URL → cover fallback glyph.
    const wrapper = mountCard(mkMatch({
      map: { map_id: '/Game/Maps/DoesNotExist/Nope' },
      career: { hero_name: '黑梦', map_name: '', map_image: '', hero_image: '' },
    }));
    expect(wrapper.find('.cover-bg-fallback').exists()).toBe(true);
  });

  test('has data-match-id attribute', () => {
    const wrapper = mountCard(mkMatch({ matches_id: 'abc-123' }));
    expect(wrapper.find('.match-row').attributes('data-match-id')).toBe('abc-123');
  });

  test('exposes stable option id for aria-activedescendant', () => {
    const wrapper = mountCard(mkMatch({ matches_id: 'abc-123' }));
    expect(wrapper.find('.match-row').attributes('id')).toBe('wui-match-opt-abc-123');
    expect(wrapper.find('.match-row').attributes('tabindex')).toBe('-1');
  });

  test('is-focused paints keyboard active class', () => {
    const wrapper = mountCard(mkMatch(), 'test', false, true);
    expect(wrapper.find('.match-row').classes()).toContain('is-focused');
  });
});
