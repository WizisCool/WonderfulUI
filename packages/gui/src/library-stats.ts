import * as echarts from 'echarts';

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
    cssVar('--ink-2', '#c6bfb6'),
    cssVar('--win', '#62c97f'),
    cssVar('--warn', '#d9b75f'),
    cssVar('--loss', '#d9574f'),
    cssVar('--ink-3', '#90877e'),
    'oklch(0.62 0.13 210)',
    'oklch(0.68 0.12 300)',
  ];
}

function truncateLegendName(name: string): string {
  return name.length > 12 ? `${name.slice(0, 11)}…` : name;
}

let accountVideoChart: echarts.ECharts | null = null;
let accountVideoResizeObserver: ResizeObserver | null = null;

export function mountAccountVideoChart(host: HTMLElement, stats: LibraryStats): void {
  disposeAccountVideoChart();
  if (!host.isConnected) return;

  const accounts = [...stats.accounts]
    .filter(account => account.videoCount > 0)
    .sort((a, b) => b.videoCount - a.videoCount);
  const totalVideos = accounts.reduce((sum, account) => sum + account.videoCount, 0);
  const videosByName = new Map(accounts.map(account => [account.label, account.videoCount]));
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const palette = chartPalette();

  accountVideoChart = echarts.init(host, undefined, { renderer: 'canvas' });
  accountVideoChart.setOption({
    color: palette,
    tooltip: {
      trigger: 'item',
      borderColor: cssVar('--border', '#4a403a'),
      backgroundColor: cssVar('--surface-3', '#302923'),
      textStyle: {
        color: cssVar('--ink', '#efe9e1'),
        fontFamily: cssVar('--font-sans', 'sans-serif'),
        fontSize: 12,
      },
      formatter: (params: unknown) => {
        const item = params as { name?: string; value?: number; percent?: number };
        return `${item.name ?? '账号'}<br/>视频 ${item.value ?? 0} · ${item.percent ?? 0}%`;
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
        const count = videosByName.get(name);
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
      name: '账号视频',
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
      label: {
        show: totalVideos > 0,
        position: 'center',
        color: cssVar('--ink', '#efe9e1'),
        fontFamily: cssVar('--font-mono', 'monospace'),
        fontSize: 18,
        fontWeight: 600,
        formatter: () => `${totalVideos}\n视频`,
        lineHeight: 22,
      },
      labelLine: {
        show: false,
      },
      data: totalVideos > 0
        ? accounts.map(account => ({
            name: account.label,
            value: account.videoCount,
          }))
        : [{
            name: '暂无视频',
            value: 1,
            itemStyle: { color: cssVar('--ink-4', '#665e59') },
          }],
      animation: !reducedMotion,
      animationDuration: reducedMotion ? 0 : 360,
      animationEasing: 'cubicOut',
    }],
    graphic: totalVideos > 0 ? [] : [{
      type: 'text',
      left: 'center',
      top: 'middle',
      style: {
        text: '暂无视频',
        fill: cssVar('--ink-3', '#918982'),
        font: `12px ${cssVar('--font-sans', 'sans-serif')}`,
      },
    }],
  });

  const instance = accountVideoChart;
  if ('ResizeObserver' in window) {
    accountVideoResizeObserver = new ResizeObserver(() => {
      if (accountVideoChart === instance) instance.resize();
    });
    accountVideoResizeObserver.observe(host);
  }
  window.requestAnimationFrame(() => {
    if (accountVideoChart === instance) instance.resize();
  });
}

export function disposeAccountVideoChart(): void {
  accountVideoResizeObserver?.disconnect();
  accountVideoResizeObserver = null;
  if (accountVideoChart) {
    accountVideoChart.dispose();
    accountVideoChart = null;
  }
}
