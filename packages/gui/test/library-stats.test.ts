import { describe, expect, test } from 'bun:test';
import {
  accountChartSlices,
  buildAccountShareChartOption,
  chartTotal,
  CHART_PALETTE,
  fmtBytes,
  type AccountStat,
} from '../src/utils/library-stats.ts';

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
  test('keeps duplicate account labels as separate slices', () => {
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

  test('filters zero-value accounts and sorts by value desc', () => {
    const slices = accountChartSlices([
      account({ openid: 'a', label: 'A', videoCount: 1 }),
      account({ openid: 'b', label: 'B', videoCount: 0 }),
      account({ openid: 'c', label: 'C', videoCount: 5 }),
    ], 'video');
    expect(slices.map(s => s.name)).toEqual(['C', 'A']);
    expect(chartTotal(slices)).toBe(6);
  });
});

describe('fmtBytes', () => {
  test('formats thresholds', () => {
    expect(fmtBytes(512)).toBe('512 B');
    expect(fmtBytes(2048)).toBe('2.0 KB');
    expect(fmtBytes(2 * 1024 * 1024)).toBe('2.0 MB');
  });
});

describe('buildAccountShareChartOption', () => {
  test('builds pie series with slice data and totals', () => {
    const accounts = [
      account({ openid: '1', label: '甲', videoCount: 75 }),
      account({ openid: '2', label: '乙', videoCount: 25 }),
    ];
    const { option, total, label, emptyLabel } = buildAccountShareChartOption(accounts, 'video');
    expect(total).toBe(100);
    expect(label).toBe('视频');
    expect(emptyLabel).toBe('暂无视频');
    const series = option.series as Array<{
      type: string;
      emphasis?: { scale?: boolean };
      data: Array<{ name: string; value: number }>;
    }>;
    expect(series[0]!.type).toBe('pie');
    expect(series[0]!.data.map(d => d.name)).toEqual(['甲', '乙']);
    expect(series[0]!.data.map(d => d.value)).toEqual([75, 25]);
    // Subtle hover lift (small scaleSize) + sibling dim; scale is allowed
    // only while tooltip stays pointer-events:none.
    const emphasis = series[0]!.emphasis as { scale?: boolean; scaleSize?: number; focus?: string };
    expect(emphasis.scale).toBe(true);
    expect(emphasis.scaleSize ?? 0).toBeLessThanOrEqual(4);
    expect(emphasis.focus).toBe('self');
  });

  test('tooltip refuses pointer events (anti-flicker)', () => {
    const { option } = buildAccountShareChartOption(
      [account({ openid: '1', label: '甲', videoCount: 1 })],
      'video',
    );
    const tip = option.tooltip as { extraCssText?: string; enterable?: boolean; transitionDuration?: number };
    expect(tip.enterable).toBe(false);
    // Keep tooltip fade short (seconds in ECharts); long ramps reintroduce flicker.
    expect(tip.transitionDuration ?? 0).toBeLessThanOrEqual(0.12);
    expect(tip.extraCssText ?? '').toContain('pointer-events:none');
  });

  test('palette and series colors are canvas-safe (no oklch)', () => {
    for (const c of CHART_PALETTE) {
      expect(c.startsWith('#')).toBe(true);
      expect(c.toLowerCase()).not.toContain('oklch');
    }
    const { option } = buildAccountShareChartOption(
      [account({ openid: '1', label: '甲', videoCount: 3 }), account({ openid: '2', label: '乙', videoCount: 1 })],
      'video',
    );
    const colors = option.color as string[];
    expect(colors.every(c => !/oklch/i.test(c))).toBe(true);
  });

  test('empty accounts produce placeholder slice', () => {
    const { option, total } = buildAccountShareChartOption([], 'match');
    expect(total).toBe(0);
    const series = option.series as Array<{ data: Array<{ name: string; value: number }> }>;
    expect(series[0]!.data).toHaveLength(1);
    expect(series[0]!.data[0]!.name).toBe('暂无对局');
  });
});
