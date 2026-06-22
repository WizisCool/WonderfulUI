import * as echarts from 'echarts/core';
import { PieChart } from 'echarts/charts';
import { LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

// Register only the chart / components / renderer this module actually uses.
// ECharts 5+ tree-shaking: nothing else is needed for the single donut chart
// in SettingsModal. ~1MB saved vs. `import * as echarts from 'echarts'`.
echarts.use([PieChart, LegendComponent, TooltipComponent, CanvasRenderer]);

export type ChartMetric = 'video' | 'match';

export const CHART_METRIC_LABELS: Record<ChartMetric, string> = {
  video: '视频',
  match: '对局',
};

export const CHART_METRIC_EMPTY: Record<ChartMetric, string> = {
  video: '暂无视频',
  match: '暂无对局',
};

const CHART_METRIC_TOOLTIP: Record<ChartMetric, string> = {
  video: '视频',
  match: '对局',
};

/** Mirrors the Rust `LibraryStats` struct (camelCase via serde). */
export interface LibraryStats {
  sourceBytes: number;
  libraryDbBytes: number;
  assetCacheBytes: number;
  logBytes: number;
  videosBytes: number;
  missingVideosBytes: number;
  totalVideos: number;
  missingVideos: number;
  totalAccounts: number;
  accounts: AccountStat[];
  recentScans: ScanJobStat[];
  assetKinds: AssetKindStat[];
}

export interface AccountStat {
  openid: string;
  label: string;
  matchCount: number;
  videoCount: number;
  sourceBytes: number;
  sourcePath: string;
  parseError: string | null;
}

export interface ScanJobStat {
  id: string;
  trigger: string;
  status: string;
  startedAt: number;
  finishedAt: number | null;
  durationMs: number;
  matchesSeen: number;
  videosSeen: number;
  eventsSeen: number;
  errorsSeen: number;
  message: string | null;
}

export interface AssetKindStat {
  kind: string;
  count: number;
  bytes: number;
}

export function fmtBytes(bytes: number): string {
  const safeBytes = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  if (safeBytes >= 1024 * 1024 * 1024) return `${(safeBytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (safeBytes >= 1024 * 1024) return `${(safeBytes / 1024 / 1024).toFixed(1)} MB`;
  if (safeBytes >= 1024) return `${(safeBytes / 1024).toFixed(1)} KB`;
  return `${safeBytes} B`;
}

function cssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function chartPalette(): string[] {
  return [
    cssVar('--accent', '#e34b43'),
    'oklch(0.70 0.14 45)',
    'oklch(0.62 0.13 210)',
    'oklch(0.68 0.12 300)',
    'oklch(0.75 0.12 180)',
    'oklch(0.60 0.14 330)',
    'oklch(0.65 0.10 80)',
    'oklch(0.55 0.10 160)',
  ];
}

function truncateLegendName(name: string): string {
  return name.length > 12 ? `${name.slice(0, 11)}…` : name;
}

function shortOpenid(openid: string): string {
  return openid.length > 6 ? openid.slice(-6) : openid;
}

function countFor(account: AccountStat, metric: ChartMetric): number {
  return metric === 'video' ? account.videoCount : account.matchCount;
}

function tooltipPosition(
  _point: number[],
  _params: unknown,
  _dom: unknown,
  _rect: unknown,
  size: { contentSize: number[]; viewSize: number[] },
): [number, number] {
  const contentWidth = size.contentSize[0] ?? 0;
  const contentHeight = size.contentSize[1] ?? 0;
  const viewWidth = size.viewSize[0] ?? 0;
  const viewHeight = size.viewSize[1] ?? 0;
  const x = Math.min(viewWidth - contentWidth - 8, Math.round(viewWidth * 0.54));
  const y = Math.round((viewHeight - contentHeight) / 2);
  return [Math.max(8, x), Math.max(8, Math.min(viewHeight - contentHeight - 8, y))];
}

function chartSignature(stats: LibraryStats, metric: ChartMetric, reducedMotion: boolean): string {
  return `${metric}|motion:${reducedMotion ? 'reduced' : 'full'}|${stats.accounts
    .map(a => `${a.openid}:${a.label}:${a.videoCount}:${a.matchCount}:${a.parseError ?? ''}`)
    .join(';')}`;
}

let accountVideoChart: echarts.ECharts | null = null;
let accountVideoResizeObserver: ResizeObserver | null = null;
let accountVideoHost: HTMLElement | null = null;
let accountVideoSignature: string | null = null;

export interface AccountChartSlice {
  name: string;
  displayLabel: string;
  value: number;
}

export function accountChartSlices(accounts: AccountStat[], metric: ChartMetric): AccountChartSlice[] {
  const labelCounts = new Map<string, number>();
  for (const account of accounts) {
    labelCounts.set(account.label, (labelCounts.get(account.label) ?? 0) + 1);
  }
  return accounts.map(account => {
    const label = account.label;
    const duplicate = (labelCounts.get(label) ?? 0) > 1;
    return {
      name: duplicate ? `${label} · ${shortOpenid(account.openid)}` : label,
      displayLabel: label,
      value: countFor(account, metric),
    };
  });
}

function buildChartOption(
  accounts: AccountStat[],
  metric: ChartMetric,
  palette: string[],
  reducedMotion: boolean,
): echarts.EChartsCoreOption {
  const slices = accountChartSlices(accounts, metric);
  const total = slices.reduce((sum, account) => sum + account.value, 0);
  const valuesByName = new Map(slices.map(account => [account.name, account.value]));
  const metricLabel = CHART_METRIC_LABELS[metric];
  const tooltipUnit = CHART_METRIC_TOOLTIP[metric];
  const hasData = total > 0;

  return {
    color: palette,
    animation: !reducedMotion,
    animationDuration: reducedMotion ? 0 : 360,
    animationEasing: 'cubicOut',
    stateAnimation: {
      duration: 0,
    },
    tooltip: {
      trigger: 'item',
      renderMode: 'richText',
      confine: true,
      position: tooltipPosition,
      borderColor: cssVar('--border', '#4a403a'),
      backgroundColor: cssVar('--surface-3', '#302923'),
      textStyle: {
        color: cssVar('--ink', '#efe9e1'),
        fontFamily: cssVar('--font-sans', 'sans-serif'),
        fontSize: 12,
      },
      formatter: (params: unknown) => {
        const item = params as { data?: { displayLabel?: string }; name?: string; value?: number; percent?: number };
        return `${item.data?.displayLabel ?? item.name ?? '账号'}\n${tooltipUnit} ${item.value ?? 0} · ${item.percent ?? 0}%`;
      },
    },
    legend: {
      type: 'scroll',
      orient: 'vertical',
      right: 4,
      top: 'middle',
      height: 164,
      itemWidth: 8,
      itemHeight: 8,
      icon: 'circle',
      formatter: (name: string) => {
        const count = valuesByName.get(name);
        return count === undefined ? truncateLegendName(name) : `${truncateLegendName(name)}  ${count}`;
      },
      textStyle: {
        color: cssVar('--ink-2', '#c6bfb6'),
        fontFamily: cssVar('--font-sans', 'sans-serif'),
        fontSize: 11,
      },
      pageIconColor: cssVar('--ink-2', '#c6bfb6'),
      pageIconInactiveColor: cssVar('--ink-4', '#665e59'),
      pageTextStyle: {
        color: cssVar('--ink-3', '#918982'),
      },
    },
    series: [{
      name: `账号${metricLabel}`,
      type: 'pie',
      radius: ['54%', '78%'],
      center: ['35%', '51%'],
      avoidLabelOverlap: true,
      minAngle: 4,
      padAngle: 1.2,
      itemStyle: {
        borderColor: cssVar('--surface', '#231d1a'),
        borderWidth: 2,
        borderRadius: 2,
      },
      emphasis: {
        disabled: true,
      },
      label: {
        show: false,
      },
      labelLine: {
        show: false,
      },
      data: hasData
        ? slices.map(account => ({
            name: account.name,
            value: account.value,
            displayLabel: account.displayLabel,
          }))
        : [{
            name: CHART_METRIC_EMPTY[metric],
            value: 1,
            itemStyle: { color: cssVar('--border-soft', '#423831') },
          }],
      animation: !reducedMotion,
      animationDuration: reducedMotion ? 0 : 360,
      animationEasing: 'cubicOut',
    }],
  };
}

export function mountAccountVideoChart(
  host: HTMLElement,
  stats: LibraryStats,
  metric: ChartMetric = 'video',
): { total: number; label: string; emptyLabel: string } {
  if (!host.isConnected) {
    disposeAccountVideoChart();
    return { total: 0, label: CHART_METRIC_LABELS[metric], emptyLabel: CHART_METRIC_EMPTY[metric] };
  }

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sig = chartSignature(stats, metric, reducedMotion);
  if (accountVideoChart && accountVideoHost === host && accountVideoSignature === sig) {
    const accounts = [...stats.accounts].filter(a => countFor(a, metric) > 0);
    const total = accounts.reduce((sum, a) => sum + countFor(a, metric), 0);
    return { total, label: CHART_METRIC_LABELS[metric], emptyLabel: CHART_METRIC_EMPTY[metric] };
  }

  if (!accountVideoChart || accountVideoHost !== host) {
    disposeAccountVideoChart();
    accountVideoChart = echarts.init(host, undefined, {
      renderer: 'canvas',
    });
    accountVideoHost = host;
  }

  const accounts = [...stats.accounts]
    .filter(account => countFor(account, metric) > 0)
    .sort((a, b) => countFor(b, metric) - countFor(a, metric));
  const option = buildChartOption(accounts, metric, chartPalette(), reducedMotion);
  accountVideoChart.setOption(option, {
    notMerge: true,
    lazyUpdate: false,
  });
  accountVideoSignature = sig;

  const total = accounts.reduce((sum, account) => sum + countFor(account, metric), 0);

  const instance = accountVideoChart;
  if (!accountVideoResizeObserver && 'ResizeObserver' in window) {
    accountVideoResizeObserver = new ResizeObserver(() => {
      if (accountVideoChart === instance) instance.resize();
    });
    accountVideoResizeObserver.observe(host);
  }
  window.requestAnimationFrame(() => {
    if (accountVideoChart === instance) instance.resize();
  });

  return { total, label: CHART_METRIC_LABELS[metric], emptyLabel: CHART_METRIC_EMPTY[metric] };
}

export function disposeAccountVideoChart(): void {
  accountVideoResizeObserver?.disconnect();
  accountVideoResizeObserver = null;
  if (accountVideoChart) {
    accountVideoChart.dispose();
    accountVideoChart = null;
  }
  accountVideoHost = null;
  accountVideoSignature = null;
}
