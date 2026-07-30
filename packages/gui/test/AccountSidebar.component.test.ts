import { describe, expect, test, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createTestingPinia } from '@pinia/testing';
import AccountSidebar from '../src/components/common/AccountSidebar.vue';
import { useAccountStore } from '../src/stores/account.ts';
import { EMPTY_FILTERS } from '../src/utils/filters.ts';
import type { MatchRecord } from '@wonderful-ui/parser';

vi.mock('sortablejs', () => ({
  default: class SortableMock {
    destroy() {}
  },
}));

describe('AccountSidebar rename lifecycle', () => {
  test('shows zero instead of the unfiltered total when an active filter has no account hits', () => {
    const match = {
      matches_id: 'match-a',
      matches_time: new Date('2026-06-15').getTime(),
      map: { map_id: '/Game/Maps/Ascent/Ascent' },
      agent: { agent_id: 'agent-a', agent_name: 'Jett' },
      stats: {
        kills: 20, deaths: 10, assists: 5, score: 300,
        has_won: true, mode_name: '', rounds_won: 13, rounds_lost: 8,
        game_level: '150',
      },
      openID: 'account-a',
      mode: 'competitive',
      minRoundId: 0,
      gameStartTime: '2026-06-15T10:00:00Z',
      gameEndTime: '2026-06-15T10:35:00Z',
      videos: [],
      career: { hero_name: '捷风', map_name: '亚海悬城', game_mode: '竞技模式' },
    } satisfies MatchRecord;
    const wrapper = mount(AccountSidebar, {
      attachTo: document.body,
      global: {
        plugins: [
          createTestingPinia({
            createSpy: vi.fn,
            stubActions: false,
            initialState: {
              account: {
                accounts: [{ openid: 'account-a', path: '', matchCount: 1 }],
                matches: [match],
                selectedAccountId: '__all__',
                accountLabels: new Map([['account-a', '账户 A']]),
              },
              filter: { filters: { ...EMPTY_FILTERS, query: 'definitely-no-hit' } },
              update: { badge: false, update: null },
            },
          }),
        ],
      },
    });

    const rows = wrapper.findAll('.account[role="option"]');
    expect(rows.map(row => row.get('.account-count').text())).toEqual(['0 / 1', '0 / 1']);
    expect(rows[1]!.classes()).toContain('is-filter-empty');
    expect(rows[1]!.attributes('data-tip')).toContain('0 / 1 条命中');
    wrapper.unmount();
  });

  test('renders a recoverable generic row for an account parse failure', () => {
    const wrapper = mount(AccountSidebar, {
      attachTo: document.body,
      global: {
        plugins: [
          createTestingPinia({
            createSpy: vi.fn,
            stubActions: false,
            initialState: {
              account: {
                accounts: [{
                  openid: 'broken-openid',
                  path: 'D:\\WonderfulDb\\broken-openid',
                  matchCount: 0,
                  error: 'parse D:\\private\\broken-openid: invalid payload',
                }],
                matches: [],
                selectedAccountId: 'broken-openid',
                accountLabels: new Map([['broken-openid', '读取失败账户']]),
              },
              filter: { filters: {} },
              update: { badge: false, update: null },
            },
          }),
        ],
      },
    });

    const row = wrapper.get('.account.is-error');
    expect(row.text()).toContain('!');
    expect(row.attributes('data-tip')).toContain('全量扫描重试');
    expect(row.attributes('data-tip')).not.toContain('D:\\private');
    wrapper.unmount();
  });

  test('focuses and selects the v-for rename input without a template-ref array', async () => {
    const wrapper = mount(AccountSidebar, {
      attachTo: document.body,
      global: {
        plugins: [
          createTestingPinia({
            createSpy: vi.fn,
            stubActions: false,
            initialState: {
              account: {
                accounts: [{
                  openid: 'test-openid',
                  path: 'D:\\WonderfulDb\\test-openid',
                  matchCount: 1,
                  nick: '测试玩家',
                  tag: '0001',
                }],
                matches: [],
                selectedAccountId: '__all__',
                accountLabels: new Map([['test-openid', '测试玩家#0001']]),
              },
              filter: {
                filters: {
                  heroes: [], maps: [], modes: [], results: [], achievements: [], videoTypes: [],
                  dateRange: [null, null], query: '', kills: [null, null], deaths: [null, null],
                  assists: [null, null], kda: [null, null], score: [null, null],
                  roundsWon: [null, null], videoCount: [null, null],
                },
              },
              update: { badge: false, update: null },
            },
          }),
        ],
      },
    });

    await wrapper.get('button[data-action="rename-account"]').trigger('click');
    const input = wrapper.get('input[aria-label="账户显示名"]').element as HTMLInputElement;

    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
    wrapper.unmount();
  });

  test('supports roving keyboard focus and Enter selection', async () => {
    const wrapper = mount(AccountSidebar, {
      attachTo: document.body,
      global: {
        plugins: [
          createTestingPinia({
            createSpy: vi.fn,
            stubActions: false,
            initialState: {
              account: {
                accounts: [
                  { openid: 'account-a', path: '', matchCount: 1 },
                  { openid: 'account-b', path: '', matchCount: 1 },
                ],
                matches: [],
                selectedAccountId: 'account-a',
                accountLabels: new Map([
                  ['account-a', '账户 A'],
                  ['account-b', '账户 B'],
                ]),
              },
              filter: { filters: {} },
              update: { badge: false, update: null },
            },
          }),
        ],
      },
    });
    const rows = wrapper.findAll('.account[role="option"]');
    expect(rows.map(row => row.attributes('tabindex'))).toEqual(['0', '-1']);

    (rows[0]!.element as HTMLElement).focus();
    await rows[0]!.trigger('keydown', { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[1]!.element);
    await rows[1]!.trigger('keydown', { key: 'Enter' });

    expect(useAccountStore().selectedAccountId).toBe('account-b');
    await wrapper.vm.$nextTick();
    expect(rows[1]!.attributes('tabindex')).toBe('0');
    wrapper.unmount();
  });
});
