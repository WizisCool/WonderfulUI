import { describe, expect, test } from 'bun:test';
import { accountChartSlices, type AccountStat } from '../src/utils/library-stats.ts';

function account(input: Partial<AccountStat> & Pick<AccountStat, 'openid' | 'label'>): AccountStat {
  return {
    matchCount: 0,
    videoCount: 0,
    sourceBytes: 0,
    sourcePath: '',
    parseError: null,
    ...input,
  };
}

describe('library stats chart slices', () => {
  test('keeps duplicate account labels as separate ECharts slices', () => {
    const slices = accountChartSlices([
      account({ openid: '100000000001', label: '主账号', videoCount: 3 }),
      account({ openid: '100000000002', label: '主账号', videoCount: 2 }),
    ], 'video');

    expect(slices.map(slice => slice.name)).toEqual(['主账号 · 000001', '主账号 · 000002']);
    expect(new Set(slices.map(slice => slice.name)).size).toBe(2);
    expect(slices.map(slice => slice.displayLabel)).toEqual(['主账号', '主账号']);
    expect(slices.map(slice => slice.value)).toEqual([3, 2]);
  });

  test('does not append account ids when labels are already unique', () => {
    const slices = accountChartSlices([
      account({ openid: '100000000001', label: '主账号', matchCount: 4 }),
      account({ openid: '100000000002', label: '小号', matchCount: 1 }),
    ], 'match');

    expect(slices.map(slice => slice.name)).toEqual(['主账号', '小号']);
    expect(slices.map(slice => slice.value)).toEqual([4, 1]);
  });
});
