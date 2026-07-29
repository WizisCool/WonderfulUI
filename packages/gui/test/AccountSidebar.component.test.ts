import { describe, expect, test, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createTestingPinia } from '@pinia/testing';
import AccountSidebar from '../src/components/common/AccountSidebar.vue';
import { useAccountStore } from '../src/stores/account.ts';

vi.mock('sortablejs', () => ({
  default: class SortableMock {
    destroy() {}
  },
}));

describe('AccountSidebar rename lifecycle', () => {
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
