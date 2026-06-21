import { describe, expect, test } from 'bun:test';
import {
  accountDisplayLabel,
  applyAccountOrder,
} from '../src/utils/account-preferences.ts';

describe('account preferences', () => {
  test('custom label overrides snapshot name and empty custom label falls back', () => {
    expect(accountDisplayLabel({
      openid: '1',
      path: '',
      matchCount: 1,
      customName: '  主账号  ',
      nick: 'Snapshot',
      tag: '1234',
    }, 1)).toBe('主账号');

    expect(accountDisplayLabel({
      openid: '2',
      path: '',
      matchCount: 1,
      customName: ' ',
      nick: 'Snapshot',
      tag: '1234',
    }, 1)).toBe('Snapshot#1234');
  });

  test('saved account order is applied and newly discovered accounts append', () => {
    const accounts = [
      { openid: 'a', path: '', matchCount: 1 },
      { openid: 'b', path: '', matchCount: 1 },
      { openid: 'c', path: '', matchCount: 1 },
    ];

    expect(applyAccountOrder(accounts, ['c', 'a']).map(a => a.openid)).toEqual(['c', 'a', 'b']);
  });
});
