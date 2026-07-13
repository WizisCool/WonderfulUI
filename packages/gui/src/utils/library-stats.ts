/**
 * Library stats types + pure helpers for settings charts.
 *
 * Rendering goes through `vue-echarts` (`AccountShareChart.vue` and future
 * settings charts). Keep this module free of DOM / ECharts instances — only
 * data shaping and option builders so unit tests stay pure.
 */

import type { EChartsCoreOption } from 'echarts/core';

export type ChartMetric = 'video' | 'match';

export const CHART_METRIC_LABELS: Record<ChartMetric, string> = {
  video: '视频',
  match: '对局',
};

export const CHART_METRIC_EMPTY: Record<ChartMetric, string> = {
  video: '暂无视频',
  match: '暂无对局',
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

function shortOpenid(openid: string): string {
  return openid.length > 6 ? openid.slice(-6) : openid;
}

export function countFor(account: AccountStat, metric: ChartMetric): number {
  return metric === 'video' ? account.videoCount : account.matchCount;
}

export interface AccountChartSlice {
  /** Unique key for legend / series data (disambiguated when labels collide). */
  name: string;
  /** User-facing label (no openid suffix). */
  displayLabel: string;
  value: number;
  openid: string;
}

/** Build chart slices for accounts with value > 0, sorted by value desc. */
export function accountChartSlices(accounts: AccountStat[], metric: ChartMetric): AccountChartSlice[] {
  const nonzero = accounts.filter(a => countFor(a, metric) > 0);
  const labelCounts = new Map<string, number>();
  for (const account of nonzero) {
    labelCounts.set(account.label, (labelCounts.get(account.label) ?? 0) + 1);
  }
  const slices = nonzero.map(account => {
    const label = account.label;
    const duplicate = (labelCounts.get(label) ?? 0) > 1;
    return {
      name: duplicate ? `${label} · ${shortOpenid(account.openid)}` : label,
      displayLabel: label,
      value: countFor(account, metric),
      openid: account.openid,
    };
  });
  slices.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, 'zh-CN'));
  return slices;
}

export function chartTotal(slices: readonly AccountChartSlice[]): number {
  return slices.reduce((sum, s) => sum + s.value, 0);
}

/**
 * Warm palette as **sRGB hex only**.
 * ECharts paints on Canvas2D; WebView2/Chromium canvas often fails to parse
 * `oklch(...)` (and other modern CSS color functions) for `fillStyle`, so the
 * largest slice (accent) can render fully transparent — a huge “missing” arc
 * that still receives tooltip hits. Never feed oklch/color-mix into ECharts.
 */
export const CHART_PALETTE = [
  '#e34b43', // accent red (≈ --accent)
  '#d4894a', // warm orange
  '#3d9bb8', // cyan
  '#b06bc9', // purple
  '#3cb89a', // teal
  '#c45a8c', // magenta
  '#c4a24a', // gold
  '#4a9b6e', // green
] as const;

export function truncateLegendName(name: string, max = 12): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

/**
 * Resolve a CSS custom property to a canvas-safe color.
 * Prefer computed rgb()/hex; if the cascade still yields oklch/color-mix,
 * fall back to the provided hex (WebView2 canvas cannot paint those).
 */
function readCssVar(name: string, fallbackHex: string): string {
  if (typeof document === 'undefined') return fallbackHex;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!raw) return fallbackHex;
  if (/^#([0-9a-f]{3,8})$/i.test(raw)) return raw;
  if (/^rgba?\(/i.test(raw) || /^hsla?\(/i.test(raw)) return raw;
  // oklch / lab / color-mix / etc. → not reliable on Canvas2D
  if (/oklch|oklab|lab\(|lch\(|color-mix|color\(/i.test(raw)) return fallbackHex;

  // Force the browser to resolve the token through a throwaway element.
  try {
    const probe = document.createElement('span');
    probe.style.color = raw;
    probe.style.display = 'none';
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    if (resolved && resolved !== 'rgba(0, 0, 0, 0)' && resolved !== 'transparent') {
      return resolved;
    }
  } catch {
    /* use fallback */
  }
  return fallbackHex;
}

/**
 * ECharts option for the account-share donut (资料库概览).
 * Pure enough for unit tests that only assert series data / legend names;
 * color tokens fall back when `document` is missing (bun:test).
 */
export function buildAccountShareChartOption(
  accounts: AccountStat[],
  metric: ChartMetric,
): { option: EChartsCoreOption; total: number; label: string; emptyLabel: string } {
  const slices = accountChartSlices(accounts, metric);
  const total = chartTotal(slices);
  const label = CHART_METRIC_LABELS[metric];
  const emptyLabel = CHART_METRIC_EMPTY[metric];
  const valuesByName = new Map(slices.map(s => [s.name, s.value]));
  const hasData = total > 0;

  // Hex fallbacks match DESIGN tokens; never pass unresolved oklch to canvas.
  const surface = readCssVar('--surface', '#231d1a');
  const surface3 = readCssVar('--surface-3', '#302923');
  const border = readCssVar('--border', '#4a403a');
  const borderSoft = readCssVar('--border-soft', '#423831');
  const ink = readCssVar('--ink', '#efe9e1');
  const ink2 = readCssVar('--ink-2', '#c6bfb6');
  const ink3 = readCssVar('--ink-3', '#918982');
  const ink4 = readCssVar('--ink-4', '#665e59');
  // Font family is not a paint color — raw CSS value is fine.
  const fontSans =
    (typeof document !== 'undefined'
      ? getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim()
      : '') || 'sans-serif';

  const option: EChartsCoreOption = {
    color: [...CHART_PALETTE],
    /*
     * Motion vocabulary (quiet, app-owned):
     * - Enter: short expansion of the ring (~480ms, cubicOut)
     * - Metric switch: soft morph (~360ms)
     * - Hover: tiny radial lift (scaleSize 3) + sibling dim, ~180ms state ease
     * Anti-flicker still required: tooltip never captures pointer; scale stays small.
     */
    animation: true,
    animationDuration: 480,
    animationDurationUpdate: 360,
    animationEasing: 'cubicOut',
    animationEasingUpdate: 'cubicInOut',
    // Hover / blur state transitions — smooth but short so it never feels laggy.
    stateAnimation: {
      duration: 180,
      easing: 'cubicOut',
    },
    tooltip: {
      trigger: 'item',
      enterable: false,
      showDelay: 0,
      // Tiny hide delay avoids edge jitter when the pointer grazes pad gaps.
      hideDelay: 40,
      // Keep tooltip fade short; long opacity ramps reintroduce enter/leave loops.
      transitionDuration: 0.08,
      // CRITICAL: tooltip must not steal the pointer (classic pie flicker).
      extraCssText: 'pointer-events:none;box-shadow:0 4px 14px rgba(0,0,0,0.45);',
      // Park tooltip off the active wedge.
      position: (
        point: number[],
        _params: unknown,
        _dom: unknown,
        _rect: unknown,
        size: { contentSize: number[]; viewSize: number[] },
      ) => {
        const [px = 0, py = 0] = point;
        const cw = size.contentSize[0] ?? 0;
        const ch = size.contentSize[1] ?? 0;
        const vw = size.viewSize[0] ?? 0;
        const vh = size.viewSize[1] ?? 0;
        // Prefer a bit further out so a small hover-scale never covers the tip.
        let x = px + 18;
        let y = py - ch / 2;
        if (x + cw > vw - 6) x = Math.max(6, px - cw - 18);
        if (y < 6) y = 6;
        if (y + ch > vh - 6) y = Math.max(6, vh - ch - 6);
        return [x, y];
      },
      confine: true,
      borderColor: border,
      backgroundColor: surface3,
      textStyle: {
        color: ink,
        fontFamily: fontSans,
        fontSize: 12,
      },
      formatter: (params: unknown) => {
        const item = params as {
          data?: { displayLabel?: string };
          name?: string;
          value?: number;
          percent?: number;
        };
        const title = item.data?.displayLabel ?? item.name ?? '账号';
        return `${title}<br/>${label} ${item.value ?? 0} · ${item.percent ?? 0}%`;
      },
    },
    legend: {
      type: 'scroll',
      orient: 'vertical',
      right: 8,
      top: 'middle',
      height: 168,
      itemWidth: 8,
      itemHeight: 8,
      itemGap: 8,
      icon: 'circle',
      pageIconColor: ink2,
      pageIconInactiveColor: ink4,
      pageTextStyle: { color: ink3 },
      formatter: (name: string) => {
        const count = valuesByName.get(name);
        const short = truncateLegendName(name);
        return count === undefined ? short : `${short}  ${count}`;
      },
      textStyle: {
        color: ink2,
        fontFamily: fontSans,
        fontSize: 11,
      },
    },
    series: [
      {
        name: `账号${label}`,
        type: 'pie',
        radius: ['54%', '78%'],
        // Leave room for the right-side scroll legend.
        center: ['34%', '50%'],
        avoidLabelOverlap: true,
        minAngle: 4,
        padAngle: 1.4,
        // Grow-from-center on first paint; quieter than a full spin.
        animationType: 'expansion',
        animationTypeUpdate: 'transition',
        animationDuration: 480,
        animationDurationUpdate: 360,
        animationEasing: 'cubicOut',
        animationEasingUpdate: 'cubicInOut',
        // Mild stagger so slices settle in sequence without a circus.
        animationDelay: (idx: number) => Math.min(idx * 28, 200),
        animationDelayUpdate: (idx: number) => Math.min(idx * 16, 120),
        // Subtle lift + sibling dim. scaleSize stays small (px) so hit-region
        // shift is negligible; tooltip still uses pointer-events:none.
        emphasis: {
          disabled: false,
          scale: true,
          scaleSize: 3,
          focus: 'self',
          itemStyle: {
            shadowBlur: 0,
            borderColor: ink,
            borderWidth: 2,
          },
        },
        blur: {
          itemStyle: {
            opacity: 0.55,
          },
        },
        itemStyle: {
          borderColor: surface,
          borderWidth: 2,
          borderRadius: 3,
        },
        // Center total is a Vue overlay — never series.label (joins hover state).
        label: { show: false },
        labelLine: { show: false },
        data: hasData
          ? slices.map(s => ({
              name: s.name,
              value: s.value,
              displayLabel: s.displayLabel,
            }))
          : [
              {
                name: emptyLabel,
                value: 1,
                displayLabel: emptyLabel,
                itemStyle: { color: borderSoft },
                tooltip: { show: false },
                emphasis: { disabled: true },
              },
            ],
      },
    ],
  };

  return { option, total, label, emptyLabel };
}
