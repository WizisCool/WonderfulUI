/**
 * WonderfulUI main app — 3-pane layout wired to the local library.
 *
 * Data flow (SQLite library):
 *   tauri::scan_all  ->  Rust refreshes the SQLite library through the
 *                        WonderfulDb source adapter, then returns a flat
 *                        matches array plus per-account metadata.
 *   tauri::get_match_rounds -> reads one full match from SQLite raw_json.
 *   frontend stores accounts + matches, applies search/filter in memory.
 *
 * Commit 9: replace demo-data with real data + search.
 * Plan A:   drop the 98 MB parser sidecar.
 * Plan B:   move the parser to Rust so IPC carries parsed matches (~50 KB /
 *            account) instead of raw bytes (~10 MB / account). 10x data is
 *            ~500x cheaper over the wire and ~10x faster to parse.
 */

import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import type { MatchRecord, VideoItem, EventItem, RoundItem } from '@wonderful-ui/parser';
import { createElement, Play, Settings, Crosshair, Skull, HeartHandshake, TrendingUp, Star, SlidersHorizontal, Zap, Loader2, Crown, Medal, Video, RefreshCw, GripVertical, Pencil } from 'lucide';
import Sortable from 'sortablejs';
import { openPlayer } from './player.ts';
import { openEventListModal } from './event-list-modal.ts';
import { normalizeMatchEvents } from './match-events.ts';
import { accountDisplayLabel, applyAccountOrder } from './account-preferences.ts';
import { FilterState, EMPTY_FILTERS, activeFilterCount, activeFilterSummary, loadFilters, saveFilters, loadOpen, saveOpen, agentCn, mapCn, modeCn, fmtMap, fmtScore, kdaRatio, fmtLevel, fmtMatchDuration, ADVANCED_RANGE_KEYS, CATEGORY_KEYS, RANGE_KEYS, normalizeVisibleFilters } from './filters.ts';
import { applyFilters, pruneUnavailableCategories } from './filter-engine.ts';
import { createFilterRail, buildAppliedChips } from './filter-bar.ts';
import { positionFloating, createArrow, referenceAtX } from './floating.ts';
import { mountScanProgress, type ScanProgressHandle } from './scan-progress.ts';
import { el } from './dom.ts';
import { loadRefreshScanMode, saveRefreshScanMode, scanModeLabel, settingsModal, type ScrapeMode } from './settings-modal.ts';

export const BRAND_NAME = 'WonderfulUI';
export const BRAND_NAME_BASE = 'Wonderful';
export const BRAND_NAME_ACCENT = 'UI';
export const BRAND_LOGO_URL = new URL('./assets/logo.svg', import.meta.url).href;

const ALL_ACCOUNTS = '__all__';

interface Account {
  openid: string;
  path: string;
  matchCount: number;
  /** In-game display name from `snapshot<openid>`, e.g. "超雄小猫咪". */
  nick?: string;
  /** Riot-style short ID / 编号, e.g. "13949". Combine as `<nick>#<tag>`. */
  tag?: string;
  /** WonderfulUI-local display override. Empty/undefined falls back to snapshot name. */
  customName?: string;
  /** Per-match MVP/SVP entries from `snapshot<openid>`. Keyed by matchesId. */
  achievements?: { matchesId: string; achvType: string; typeStr: string }[];
  error?: string;
}

interface LoadResult {
  dir: string;
  accounts: Account[];
  matches: MatchRecord[];
  totalErrors: number;
}

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: LoadResult };

export function shouldLoadMatchRounds(
  match: MatchRecord | null,
  loadedMatchIds: ReadonlySet<string>,
): match is MatchRecord {
  return !!match && match.videos.length > 0 && !loadedMatchIds.has(match.matches_id);
}

function brandLockup(): HTMLElement {
  return el('div', { class: 'brand' }, [
    el('img', {
      class: 'brand-logo',
      src: BRAND_LOGO_URL,
      alt: '',
      'aria-hidden': 'true',
      width: '36',
      height: '36',
      decoding: 'async',
    }),
    el('span', { class: 'brand-wordmark', 'aria-label': BRAND_NAME }, [
      el('span', { class: 'brand-name brand-name-base' }, [BRAND_NAME_BASE]),
      el('span', { class: 'brand-name brand-name-accent' }, [BRAND_NAME_ACCENT]),
    ]),
  ]);
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}  ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}


function kda(m: MatchRecord): string {
  return `${m.stats.kills}/${m.stats.deaths}/${m.stats.assists}`;
}

function topbar(query: string, scraping = false, settingsOpen = false, scanMode: ScrapeMode = 'incremental'): HTMLElement {
  const scanLabel = scanModeLabel(scanMode);
  return el('header', { class: 'topbar' }, [
    brandLockup(),
    el('div', { class: 'topbar-center' }, [
      el('input', {
        class: 'search',
        type: 'text',
        placeholder: '搜索 英雄 / 地图 / 模式 / 短码',
        value: query,
        'aria-label': '搜索高光',
      }),
    ]),
    el('div', { class: 'topbar-right' }, [
      el('button', {
        class: `iconbtn scrape-btn ${scraping ? 'is-loading' : ''}`,
        'aria-label': scraping ? '正在扫描资料库' : `${scanLabel}资料库`,
        'data-tip': scraping ? '正在扫描资料库' : `${scanLabel}资料库`,
        'data-action': 'scrape-library',
        type: 'button',
      }, [createElement(RefreshCw, { width: 16, height: 16 })]),
      el('button', {
        class: `iconbtn settings-btn ${settingsOpen ? 'is-active' : ''}`,
        'aria-label': '设置',
        'data-tip': '设置',
        'data-action': 'open-settings',
        type: 'button',
      }, [createElement(Settings, { width: 16, height: 16 })]),
    ]),
  ]);
}

function accountsPane(
  accounts: Account[],
  selected: string | null,
  filteredCounts: Map<string, number>,
  hasActiveFilters: boolean,
  editingOpenid: string | null,
): HTMLElement {
  const realCount = accounts.filter(a => a.openid !== ALL_ACCOUNTS).length;
  if (realCount === 0) {
    return el('aside', { class: 'pane accounts', 'aria-label': '账户列表' }, [
      el('div', { class: 'pane-head' }, [
        el('span', { class: 'pane-title' }, ['账户']),
        el('span', { class: 'pane-sub' }, ['0 个']),
      ]),
      el('div', { class: 'empty' }, [
        el('div', { class: 'empty-title' }, ['没有找到账户']),
        el('div', { class: 'empty-sub' }, [
          '默认目录 ', el('code', {}, ['%APPDATA%\\ACLOS\\WonderfulDb']), ' 下没有任何数据。',
        ]),
      ]),
    ]);
  }
  const unknownIdx = unknownIndices(accounts);
  const renderAccountRow = (a: Account): HTMLElement => {
    const isAll = a.openid === ALL_ACCOUNTS;
    const isSel = a.openid === selected;
    const label = accountLabel(a, unknownIdx.get(a.openid));
    const filteredCount = filteredCounts.get(a.openid) ?? a.matchCount;
    const countText = hasActiveFilters && !a.error
      ? `${filteredCount} / ${a.matchCount}`
      : (a.error ? '!' : `${a.matchCount}`);
    const tipCount = hasActiveFilters
      ? `${filteredCount} / ${a.matchCount} 条命中`
      : `${a.matchCount} 条高光`;
    return el('div', {
      class: `account ${isSel ? 'is-selected' : ''} ${a.error ? 'is-error' : ''} ${isAll ? 'is-all' : ''} ${editingOpenid === a.openid ? 'is-editing' : ''} ${hasActiveFilters && filteredCount === 0 ? 'is-filter-empty' : ''}`,
      role: 'option',
      'aria-selected': String(isSel),
      tabindex: '0',
      'data-account-id': a.openid,
      'data-tip': isAll
        ? `所有账户的高光\n${tipCount}`
        : (a.error ? a.error : `${label}\n${tipCount}\nopenid · ${a.openid}`),
    }, [
      el('span', { class: 'account-main' }, [
        isAll ? document.createTextNode('') : el('span', { class: 'account-grip', 'aria-hidden': 'true' }, [
          createElement(GripVertical, { width: 13, height: 13 }),
        ]),
        editingOpenid === a.openid
          ? el('input', {
            class: 'account-rename-input',
            type: 'text',
            value: a.customName ?? '',
            placeholder: label,
            'aria-label': '账户显示名',
            'data-account-rename-input': a.openid,
          })
          : el('span', { class: 'account-name' }, [isAll ? '全部' : label]),
      ]),
      isAll ? document.createTextNode('') : el('button', {
        class: 'account-edit-btn',
        type: 'button',
        'aria-label': '重命名账户',
        'data-action': 'rename-account',
        'data-account-id': a.openid,
      }, [createElement(Pencil, { width: 12, height: 12 })]),
      el('span', { class: 'account-count' }, [countText]),
    ]);
  };
  return el('aside', { class: 'pane accounts', 'aria-label': '账户列表' }, [
    el('div', { class: 'pane-head' }, [
      el('span', { class: 'pane-title' }, ['账户']),
      el('span', { class: 'pane-sub' }, [`${realCount} 个`]),
    ]),
    el('div', { class: 'account-list', role: 'listbox' }, [
      ...accounts.filter(a => a.openid === ALL_ACCOUNTS).map(renderAccountRow),
      el('div', { class: 'account-sortable-list', role: 'presentation' },
        accounts.filter(a => a.openid !== ALL_ACCOUNTS).map(renderAccountRow)
      ),
    ]),
  ]);
}

function buildScopeFilterToggle(
  filterBarOpen: boolean,
  activeFilterN: number,
  onToggleFilterBar: () => void,
): HTMLElement {
  const btn = el('button', {
    class: `scope-filter-toggle ${filterBarOpen ? 'is-open' : ''}`,
    type: 'button',
    'aria-label': filterBarOpen ? '收起筛选' : '展开筛选',
    'aria-pressed': String(filterBarOpen),
    'data-tip': filterBarOpen ? '收起筛选' : '展开筛选',
  }, [
    createElement(SlidersHorizontal, { width: 14, height: 14 }),
    activeFilterN > 0
      ? el('span', { class: 'scope-filter-toggle-count' }, [String(activeFilterN)])
      : document.createTextNode(''),
  ]);
  btn.addEventListener('click', onToggleFilterBar);
  return btn;
}

/** `Smoky#46211` when we have both, `Smoky` when we only have nick. When
 *  neither is available (snapshot file is empty / unreadable / missing),
 *  fall back to `未知账户#N` where N is the 1-based rank among all
 *  accounts in the current scan that also lack a nick. The raw openid
 *  is still discoverable via the row's tooltip. */
function accountLabel(a: Account, unknownIndex?: number): string {
  return accountDisplayLabel(a, unknownIndex);
}

/** Pre-pass: assign each nameless account a 1-based rank, in the order
 *  the backend returned them (which is sorted by openid in `scan_all`).
 *  Accounts that already have a nick get `undefined` and the label
 *  function takes the normal path. */
function unknownIndices(accounts: Account[]): Map<string, number> {
  const idx = new Map<string, number>();
  let n = 0;
  for (const a of accounts) {
    if (a.nick || a.customName?.trim()) continue;
    if (a.openid === ALL_ACCOUNTS) continue;
    n += 1;
    idx.set(a.openid, n);
  }
  return idx;
}

function matchRow(m: MatchRecord, accountLabel: string, isSelected: boolean, assetPathCache: Map<string, string>, matchAchievements: Map<string, { type: 'mvp' | 'svp'; typeStr: string }>): HTMLElement {
  const result = m.stats.has_won ? '胜' : '败';
  const resultClass = m.stats.has_won ? 'result-win' : 'result-loss';
  // Cover: map image (blurred) background + agent head icon badge (bottom-right corner).
  const mapUrl = m.career?.map_image as string | undefined;
  const mapLocal = mapUrl ? assetPathCache.get(mapUrl) : undefined;
  const heroUrl = m.career?.hero_image as string | undefined;
  const initial = agentCn(m)[0] ?? '?';
  const mode = modeCn(m);
  const cover = el('div', { class: 'match-cover', 'aria-hidden': 'true' });
  if (mapUrl) {
    const src = mapLocal ? convertFileSrc(mapLocal) : mapUrl;
    const bg = el('img', { class: 'cover-bg', src, alt: '', loading: 'lazy' });
    bg.addEventListener('error', () => { if (bg.isConnected) bg.remove(); });
    cover.append(bg);
  } else {
    cover.append(el('div', { class: 'cover-bg-fallback' }, [initial]));
  }
  cover.append(heroImg(agentCn(m), heroUrl, assetPathCache));
  // MVP/SVP pill — only when snapshot data is present
  const achv = matchAchievements.get(m.matches_id);
  if (achv) {
    const isMvp = achv.type === 'mvp';
    const badge = el('div', {
      class: `cover-badge cover-badge-${achv.type}`,
      'aria-label': isMvp ? '本局获得 MVP' : '本局获得 SVP',
      title: achv.typeStr,
    }, [
      createElement(isMvp ? Crown : Medal, { width: 9, height: 9 }),
      document.createTextNode(achv.type.toUpperCase()),
    ]);
    cover.append(badge);
  }
  return el('div', {
    class: `match-row ${isSelected ? 'is-selected' : ''}`,
    tabindex: '0',
    'data-match-id': m.matches_id,
    'data-tip': `${agentCn(m)}  ·  ${fmtScore(m)}  ·  ${mapCn(m)}\n${accountLabel}\n${fmtTime(m.matches_time)}\n${m.matches_id}`,
  }, [
    cover,
    el('div', { class: 'match-meta' }, [
      // Line 1: agent (left) + W 13:9 pill (right).
      el('div', { class: 'match-line match-line-1' }, [
        el('span', { class: 'match-agent' }, [agentCn(m)]),
        el('span', {
          class: `match-result-pill ${resultClass}`,
          'aria-label': m.stats.has_won ? `胜利 ${fmtScore(m)}` : `失败 ${fmtScore(m)}`,
        }, [`${result} ${fmtScore(m)}`]),
      ]),
      // Line 2: map (left) + mode chip (right).
      el('div', { class: 'match-line match-line-2' }, [
        el('span', { class: 'match-map' }, [mapCn(m)]),
        mode ? modeChipWithIcon(m, mode, assetPathCache) : document.createTextNode(''),
      ]),
      // Line 3: KDA (left) + video chip (right).
      el('div', { class: 'match-line match-line-3' }, [
        el('span', { class: 'match-kda' }, [kda(m)]),
        el('span', { class: 'match-video-chip' }, [
          createElement(Video, { width: 10, height: 10 }),
          document.createTextNode(`× ${m.videos.length}`),
        ]),
      ]),
      // Footer: time + account label.
      el('div', { class: 'match-footer' }, [
        el('span', { class: 'match-time' }, [fmtTime(m.matches_time)]),
        accountLabel ? el('span', { class: 'match-sep-dot' }, ['·']) : document.createTextNode(''),
        accountLabel ? el('span', { class: 'match-account' }, [accountLabel]) : document.createTextNode(''),
      ]),
    ]),
  ]);
}

/** Build a cover <img> with an onerror fallback to the agent-initial placeholder. */
function coverImg(src: string, initial: string): HTMLElement {
  const img = el('img', { class: 'cover-img', src, alt: '', loading: 'lazy' });
  img.addEventListener('error', () => {
    img.replaceWith(el('span', { class: 'cover-placeholder' }, [initial]));
  });
  return img;
}

/**
 * Convert a local Windows path to a Tauri asset URL. Tauri 2 / WebView2
 * block `file:///` access for renderer assets, so we have to go through
 * the `asset:` protocol (handled by convertFileSrc). The scope in
 * tauri.conf.json (security.assetProtocol.scope) controls which paths
 * are allowed; covers live under the ACLOS install + the user's NAS
 * mount, so we need a broad scope.
 */
function fileUrl(p: string): string {
  return convertFileSrc(p);
}

function listPane(
  accountLabels: Map<string, string>,
  allMatches: MatchRecord[],
  filteredMatches: MatchRecord[],
  selectedId: string | null,
  filters: FilterState,
  onFilterChange: (patch: Partial<FilterState>) => void,
  filterBarOpen: boolean,
  onToggleFilterBar: () => void,
  assetPathCache: Map<string, string>,
  onClearFilter: (key: string, value?: string) => void,
  onFocusSection: (key: string) => void,
  matchAchievements: Map<string, { type: 'mvp' | 'svp'; typeStr: string }>,
): HTMLElement {
  const activeCount = activeFilterCount(filters);
  const pane = el('main', { class: 'pane list', 'aria-label': '高光列表' });

  pane.append(el('div', { class: 'pane-head' }, [
    el('div', { class: 'pane-title-row' }, [
      el('span', { class: 'pane-title' }, ['对局列表']),
      buildScopeFilterToggle(filterBarOpen, activeCount, onToggleFilterBar),
    ]),
    el('div', { class: 'pane-head-right' }, [
      el('span', { class: 'pane-sub' }, [
        activeCount > 0 || filters.query.trim()
          ? `${filteredMatches.length} / ${allMatches.length} 条`
          : `${allMatches.length} 条 · 时间倒序`,
      ]),
    ]),
  ]));

  // match list (now includes applied filter chips at top when active)
  const list = el('div', { class: 'match-list', role: 'listbox' });

  // applied filter chips row
  const chipsEl = buildAppliedChips(filters, onClearFilter, onFocusSection);
  if (chipsEl) list.append(chipsEl);
  if (allMatches.length === 0) {
    list.append(el('div', { class: 'empty' }, [
      el('div', { class: 'empty-title' }, ['这个账户还没录到高光']),
      el('div', { class: 'empty-sub' }, ['去打一局 VALORANT 吧']),
    ]));
  } else if (filteredMatches.length === 0) {
    const emptyDiv = el('div', { class: 'empty' }, [
      el('div', { class: 'empty-title' }, ['没有匹配']),
      el('div', { class: 'empty-sub' }, [
        activeCount > 0
          ? `${allMatches.length} 条中无结果 · ${activeFilterSummary(filters)}`
          : `搜索 "${filters.query}" 在 ${allMatches.length} 条中没结果`,
      ]),
    ]);
    const clearBtn = el('button', { class: 'btn btn-primary', style: 'margin-top:12px' }, ['清除全部筛选']);
    clearBtn.addEventListener('click', () => {
      onFilterChange({ ...EMPTY_FILTERS, query: filters.query });
    });
    emptyDiv.append(clearBtn);
    list.append(emptyDiv);
  } else {
    for (const m of filteredMatches) {
      list.append(matchRow(m, accountLabels.get(m.openID) ?? m.openID, m.matches_id === selectedId, assetPathCache, matchAchievements));
    }
  }
  pane.append(list);
  return pane;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** ACLOS `video_level` is a stable integer (1=720p, 3=1080p in our
 *  fixtures). We use it instead of `video_resolution` because the
 *  resolution string carries stray `\r` characters from ACLOS's
 *  Windows-side serialization. Falls back to a sanitized form of
 *  `video_resolution` if level is unknown. */
function fmtResolution(v: VideoItem): string {
  if (v.video_level === '1') return '720p';
  if (v.video_level === '3') return '1080p';
  // Fallback: strip \r and try to parse "1440x1080"
  const raw = v.video_resolution.replace(/\r/g, '').trim();
  const m = /^(\d+)\s*x\s*(\d+)$/.exec(raw);
  if (m) return `${m[1]}×${m[2]}`;
  return raw || '—';
}

/** Quality badge for the cover: `1080p · 60` or just `1080p` / `60`
 *  when only one of the two is present. Returns the empty string
 *  when ACLOS supplied neither (the cover then renders no chip). */
function fmtQualityBadge(v: VideoItem): string {
  const res = fmtResolution(v);
  const fps = v.video_fps;
  if (res && fps) return `${res} · ${fps}`;
  if (res) return res;
  if (fps) return `${fps}fps`;
  return '';
}

// "集锦" types: long-form recaps (kill montage, death montage). Everything
// else is a "高光时刻" (moment: triple/quad/ace kill, prediction, etc.).
// Group by `video_type`, not by position or duration — see AGENTS.md.
const MONTAGE_TYPES = new Set(['击杀集锦', '死亡集锦']);
const MOMENT_TYPE_ORDER = ['三杀时刻', '四杀时刻', '五杀时刻', '进阶剪辑'];

function heroPlaceholder(agentName: string): HTMLElement {
  const initial = agentName[0]?.toUpperCase() ?? '?';
  let hue = 0;
  for (const c of agentName) hue = (hue * 31 + c.charCodeAt(0)) % 360;
  const div = el('div', { class: 'hero-placeholder' }, [initial]);
  div.style.setProperty('--hue', String(hue));
  return div;
}

/**
  * Build the hero avatar element. The pre-fetched `assetPathCache`
  * (populated after `scan_all` returns) maps the ACLOS career CDN URL
  * to a cached local path on disk. Cache hits render instantly; cache
  * misses (new agent never seen) fall back to a colored initial
  * placeholder. No bundled PNGs — the cache lives entirely under
  * `%LOCALAPPDATA%\wonderful-ui\assets\hero_image\`.
  */
function heroImg(cnName: string, heroUrl: string | undefined, assetPathCache: Map<string, string>): HTMLElement {
  if (!heroUrl) return heroPlaceholder(cnName);
  const localPath = assetPathCache.get(heroUrl);
  if (!localPath) return heroPlaceholder(cnName);
  const img = el('img', {
    class: 'hero-img',
    src: convertFileSrc(localPath),
    alt: cnName,
    loading: 'lazy',
  });
  img.addEventListener('error', () => {
    if (img.isConnected) img.replaceWith(heroPlaceholder(cnName));
  });
  return img;
}

function statCell(label: string, value: number | string, icon?: SVGElement, tone?: 'win' | 'loss' | 'assist' | 'neutral'): HTMLElement {
  const cls = tone && tone !== 'neutral' ? `stat-cell is-${tone}` : 'stat-cell';
  const children: HTMLElement[] = [];
  if (icon) children.push(el('div', { class: 'stat-icon' }, [icon]));
  children.push(el('div', { class: 'stat-value' }, [String(value)]));
  children.push(el('div', { class: 'stat-label' }, [label]));
  return el('div', { class: cls }, children);
}

function montageCard(v: MatchRecord['videos'][number]): HTMLElement {
  const initial = v.video_name[0] ?? '?';
  const badge = fmtQualityBadge(v);
  return el('div', { class: 'montage-card' }, [
    el('div', { class: 'montage-cover' }, [
      v.video_poster
        ? coverImg(fileUrl(v.video_poster), initial)
        : el('span', { class: 'cover-placeholder' }, [initial]),
      // Quality chip: `1080p · 60` (resolution + fps joined). Top-left
      // balances the play button on the top-right. Omit when both
      // signals are absent so the cover isn't peppered with "—".
      badge ? el('span', { class: 'resolution-chip' }, [badge]) : document.createTextNode(''),
    ]),
    el('div', { class: 'montage-info' }, [
      el('div', { class: 'montage-title' }, [v.video_name]),
      el('div', { class: 'montage-meta' }, [fmtVideoMeta(v)]),
    ]),
    el('button', {
      class: 'btn btn-play',
      'data-src': v.video_src,
      'aria-label': `播放 ${v.video_name}`,
    }, [createElement(Play, { width: 14, height: 14 })]),
  ]);
}

function momentCard(v: MatchRecord['videos'][number]): HTMLElement {
  const initial = v.video_name[0] ?? '?';
  const badge = fmtQualityBadge(v);
  return el('div', { class: 'moment-card' }, [
    el('div', { class: 'moment-cover' }, [
      v.video_poster
        ? coverImg(fileUrl(v.video_poster), initial)
        : el('span', { class: 'cover-placeholder' }, [initial]),
      badge ? el('span', { class: 'resolution-chip' }, [badge]) : document.createTextNode(''),
    ]),
    el('div', { class: 'moment-info' }, [
      el('div', { class: 'moment-name' }, [v.video_name]),
      el('div', { class: 'moment-duration' }, [fmtVideoMeta(v)]),
    ]),
    el('button', {
      class: 'btn btn-play',
      'data-src': v.video_src,
      'aria-label': `播放 ${v.video_name}`,
    }, [createElement(Play, { width: 14, height: 14 })]),
  ]);
}

/** Small game-mode icon (e.g. `competitive.png`) from
 *  `career.game_mode_icon`. Returns null when ACLOS didn't supply one
 *  — caller skips the element. When the cache has the file, serves it
 *  locally; otherwise falls back to the original CDN URL. The <img> uses
 *  onerror to self-destruct if either source 404s. */
function modeIconFor(m: MatchRecord, size: 'sm' | 'md', assetPathCache: Map<string, string>): HTMLElement | null {
  const url = m.career?.game_mode_icon;
  if (typeof url !== 'string' || !url) return null;
  const localPath = assetPathCache.get(url);
  const src = localPath ? convertFileSrc(localPath) : url;
  const img = el('img', {
    class: `mode-icon mode-icon-${size}`,
    src,
    alt: '',
    loading: 'lazy',
  });
  img.addEventListener('error', () => { img.remove(); });
  return img;
}

/** `match-mode` chip with the mode icon prepended when available. */
function modeChipWithIcon(m: MatchRecord, mode: string, assetPathCache: Map<string, string>): HTMLElement {
  const chip = el('span', { class: 'match-mode' });
  const icon = modeIconFor(m, 'sm', assetPathCache);
  if (icon) chip.append(icon);
  chip.append(document.createTextNode(mode));
  return chip;
}

/** Compact meta line under each video card: `4:01 · 2.1MB`.
 *  Quality (resolution + fps) lives on the cover chip — not here —
 *  so the line stays focused on playback-relevant facts. */
function fmtVideoMeta(v: VideoItem): string {
  const parts: string[] = [fmtDuration(v.video_duration)];
  if (v.video_size) parts.push(fmtSize(v.video_size));
  return parts.join(' · ');
}

/** Clickable stat card in the detail panel that opens the event list modal. */
function eventStatCell(
  m: MatchRecord,
  roundsLoaded: boolean,
  onOpen: (m: MatchRecord) => void,
): HTMLElement {
  const cell = el('button', {
    class: 'stat-cell event-stat-cell',
    type: 'button',
    'aria-label': '打开本局事件列表',
  });

  if (!roundsLoaded) {
    cell.appendChild(el('div', { class: 'event-stat-spinner' }, [
      createElement(Loader2, { width: 14, height: 14, class: 'spin' }),
    ]));
    cell.appendChild(el('div', { class: 'stat-value' }, ['—']));
    cell.appendChild(el('div', { class: 'stat-label' }, ['加载中…']));
    cell.disabled = true;
    return cell;
  }

  const events = normalizeMatchEvents(m);
  cell.appendChild(el('div', { class: 'stat-icon' }, [
    createElement(Zap, { width: 14, height: 14 }),
  ]));
  cell.appendChild(el('div', { class: 'stat-value' }, [String(events.length)]));
  cell.appendChild(el('div', { class: 'stat-label' }, ['事件']));

  if (events.length === 0) {
    cell.disabled = true;
    cell.title = '这场高光未携带事件数据';
  } else {
    cell.addEventListener('click', () => onOpen(m));
  }
  return cell;
}

function detailPane(
  m: MatchRecord | null,
  momentFilter: string | null,
  onMomentFilter: (t: string | null) => void,
  assetPathCache: Map<string, string>,
  onOpenEventList: (m: MatchRecord) => void,
  roundsLoaded: boolean,
): HTMLElement {
  if (!m) {
    return el('aside', { class: 'pane detail', 'aria-label': '高光详情' }, [
      el('div', { class: 'empty' }, [
        el('div', { class: 'empty-title' }, ['没有选中']),
        el('div', { class: 'empty-sub' }, ['从左侧账户选一个,再从中间选一场高光']),
      ]),
    ]);
  }

  const career = m.career;
  const mapName = mapCn(m);
  const gameMode = modeCn(m);
  const agentName = agentCn(m);
  const resultText = m.stats.has_won ? '胜' : '败';
  const resultClass = m.stats.has_won ? 'result-win' : 'result-loss';
  const resultLabel = m.stats.has_won ? '胜利' : '失败';

  const montages = m.videos.filter(v => MONTAGE_TYPES.has(v.video_type));
  const moments = m.videos.filter(v => !MONTAGE_TYPES.has(v.video_type));
  const momentsByType = new Map<string, typeof moments>();
  for (const v of moments) {
    if (!momentsByType.has(v.video_type)) momentsByType.set(v.video_type, []);
    momentsByType.get(v.video_type)!.push(v);
  }
  const visibleMoments = momentFilter ? (momentsByType.get(momentFilter) ?? []) : moments;

  const detail = el('aside', { class: 'pane detail detail-scroll', 'aria-label': '高光详情' });

  // ── header: hero + (agent | W 13:10 pill) + (mode·map·duration) ──
  // Two lines only — the result pill is no longer on its own row.
  // The pill sits to the right of the agent name on line 1, where it
  // semantically belongs ("the result of this match").
  const heroUrl = m.career?.hero_image as string | undefined;
  const heroSlot = el('div', { class: 'hero-avatar' }, [heroImg(agentName, heroUrl, assetPathCache)]);
  const matchDuration = fmtMatchDuration(m);
  const modeIconEl = modeIconFor(m, 'md', assetPathCache);
  const detailSub = el('div', { class: 'detail-sub' });
  if (modeIconEl) detailSub.append(modeIconEl);
  detailSub.append(
    document.createTextNode(gameMode ? `${gameMode} · ${mapName}` : mapName),
  );
  if (matchDuration) detailSub.append(document.createTextNode(` · ${matchDuration}`));
  detail.append(el('div', { class: 'detail-header' }, [
    heroSlot,
    el('div', { class: 'detail-header-meta' }, [
      el('div', { class: 'detail-agent-row' }, [
        el('div', { class: 'detail-agent' }, [agentName]),
        el('span', {
          class: `match-result-pill is-detail ${resultClass}`,
          'aria-label': `${resultLabel} ${fmtScore(m)}`,
        }, [`${resultText} ${fmtScore(m)}`]),
      ]),
      detailSub,
    ]),
  ]));

  // ── stats: 3×2 card grid (Row1: kills/deaths/assists, Row2: kda/score) ──
  const kdaNum = (m.stats.kills + m.stats.assists) / Math.max(m.stats.deaths, 1);
  const kdaTone = kdaNum >= 1.5 ? 'win' as const : kdaNum <= 0.8 ? 'loss' as const : 'neutral' as const;
  detail.append(el('div', { class: 'detail-stats-row' }, [
    statCell('击杀', m.stats.kills, createElement(Crosshair, { width: 14, height: 14 }), 'win'),
    statCell('死亡', m.stats.deaths, createElement(Skull, { width: 14, height: 14 }), 'loss'),
    statCell('助攻', m.stats.assists, createElement(HeartHandshake, { width: 14, height: 14 }), 'assist'),
    el('div', { class: 'stat-row2' }, [
      statCell('KDA', kdaRatio(m), createElement(TrendingUp, { width: 14, height: 14 }), kdaTone),
      statCell('得分', m.stats.score, createElement(Star, { width: 14, height: 14 })),
      eventStatCell(m, roundsLoaded, onOpenEventList),
    ]),
  ]));

  // ── 集锦 section ──
  if (montages.length > 0) {
    detail.append(el('section', { class: 'detail-section' }, [
      el('div', { class: 'section-title' }, ['集锦']),
      el('div', { class: 'montage-grid' }, montages.map(v => montageCard(v))),
    ]));
  }

  // ── 高光时刻 section: filter chips + grid ──
  if (moments.length > 0) {
    const typeOrder = [
      ...MOMENT_TYPE_ORDER.filter(t => momentsByType.has(t)),
      ...[...momentsByType.keys()].filter(t => !MOMENT_TYPE_ORDER.includes(t)),
    ];
    const chips = el('div', { class: 'moment-chips' });
    for (const type of typeOrder) {
      const count = momentsByType.get(type)!.length;
      const isActive = momentFilter === type;
      chips.append(el('button', {
        class: `moment-chip ${isActive ? 'is-active' : ''}`,
        'data-type': type,
        type: 'button',
      }, [`${type} × ${count}`]));
    }
    chips.addEventListener('click', e => {
      const btn = (e.target as HTMLElement).closest('.moment-chip') as HTMLElement | null;
      if (!btn) return;
      const type = btn.dataset.type!;
      onMomentFilter(momentFilter === type ? null : type);
    });

    detail.append(el('section', { class: 'detail-section' }, [
      el('div', { class: 'section-title' }, ['高光时刻']),
      chips,
      el('div', { class: 'moment-grid' },
        visibleMoments.length > 0
          ? visibleMoments.map(v => momentCard(v))
          : [el('div', { class: 'empty-inline' }, [`这场没有「${momentFilter}」`])]
      ),
    ]));
  }

  if (montages.length === 0 && moments.length === 0) {
    detail.append(el('div', { class: 'empty' }, [
      el('div', { class: 'empty-title' }, ['这场高光没有视频']),
    ]));
  }

  return detail;
}

// ─── scan progress (boot + in-app full scan) ───────────────
//
// Wraps the boot panel / full-scan overlay in a single async function.
// See `scan-progress.ts` for the listener wiring and the fade-out
// handoff. The boot phase mounts with `mode: 'boot'` and replaces
// `#app`; in-app full scans mount with `mode: 'overlay'` over a
// pre-allocated `.scan-progress-root` slot in the app skeleton.

function renderError(message: string): HTMLElement {
  return el('div', { class: 'app' }, [
    el('header', { class: 'topbar' }, [
      brandLockup(),
    ]),
    el('div', { class: 'panes' }, [
      el('main', { class: 'pane list full' }, [
        el('div', { class: 'empty error' }, [
          el('div', { class: 'empty-title' }, ['读取失败']),
          el('div', { class: 'empty-sub error-message' }, [message]),
          el('div', { class: 'empty-hint' }, [
            '检查 ', el('code', {}, ['%APPDATA%\\ACLOS\\WonderfulDb']), ' 是否存在并可读。',
          ]),
        ]),
      ]),
    ]),
  ]);
}

// ─── toast ─────────────────────────────────────────────────
let toastTimer: number | null = null;
function showToast(message: string, kind: 'ok' | 'error' = 'ok') {
  let host = document.getElementById('toast-host');
  if (!host) {
    host = el('div', { id: 'toast-host' });
    document.body.append(host);
  }
  // Mark the outgoing toast (if any) as closing so it fades out
  // smoothly instead of being yanked on the next innerHTML clear.
  for (const prev of Array.from(host.children)) {
    prev.classList.add('is-closing');
  }
  const t = el('div', { class: `toast ${kind}` }, [message]);
  host.append(t);
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    // animate out, then clean
    t.classList.add('is-closing');
    t.addEventListener('transitionend', () => {
      if (t.isConnected) t.remove();
    }, { once: true });
    // safety: in case transitionend doesn't fire
    setTimeout(() => { if (t.isConnected) t.remove(); }, 240);
  }, kind === 'error' ? 6000 : 2500);
}

export async function renderApp(root: HTMLElement) {
  const progress: ScanProgressHandle = await mountScanProgress(root, { mode: 'boot' });

  // Phase 1: get account shell immediately (does not block on scrape)
  let state: State;
  try {
    const shell = await invoke<{ accounts: Account[]; dir: string; totalErrors: number }>('scan_shell');
    state = {
      kind: 'ready',
      data: { accounts: shell.accounts, matches: [], dir: shell.dir, totalErrors: shell.totalErrors },
    };
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    progress.update(`错误: ${msg}`);
    await new Promise(r => setTimeout(r, 2000));
    root.replaceChildren(renderError(msg));
    progress.dispose();
    return;
  }

  // Wait for scrape to advance past scanning (poll on pct)
  await new Promise<void>((resolve) => {
    const check = () => {
      if (progress.getPct() >= 80) resolve();
      else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });

  // Get full match list
  let fullData: LoadResult;
  try {
    fullData = await invoke<LoadResult>('load_library');
  } catch {
    fullData = (state as Extract<State, { kind: 'ready' }>).data;
  }
  state = { kind: 'ready', data: fullData };

  // --- Asset pre-warm ---
  // The progress component's cache_asset_progress listener ticks the
  // bar through 88→99 as Rust emits the events; no manual label needed.
  const assetPathCache = new Map<string, string>();
  const entries: Array<{ kind: string; url: string }> = [];
  const seenAssets = new Set<string>();
  for (const m of fullData.matches) {
    const heroUrl = m.career?.hero_image;
    if (typeof heroUrl === 'string' && heroUrl && !seenAssets.has(heroUrl)) { seenAssets.add(heroUrl); entries.push({ kind: 'hero_image', url: heroUrl }); }
    const mapUrl = m.career?.map_image;
    if (typeof mapUrl === 'string' && mapUrl && !seenAssets.has(mapUrl)) { seenAssets.add(mapUrl); entries.push({ kind: 'map_image', url: mapUrl }); }
    const modeUrl = m.career?.game_mode_icon;
    if (typeof modeUrl === 'string' && modeUrl && !seenAssets.has(modeUrl)) { seenAssets.add(modeUrl); entries.push({ kind: 'game_mode_icon', url: modeUrl }); }
  }

  if (entries.length > 0) {
    try {
      const results = await invoke<Record<string, string>>('cache_assets', { entries });
      for (const [url, localPath] of Object.entries(results)) {
        assetPathCache.set(url, localPath);
      }
    } catch { /* non-fatal */ }
  }

  // Fade the boot screen out. The component sets pct=100, holds 220ms,
  // fades over 280ms, then unlistens and removes itself from #app.
  await progress.complete();

  let data = state.data;
  let selectedAccount: string | null = data.accounts.length > 0 ? ALL_ACCOUNTS : null;
  let selectedMatch: MatchRecord | null = null;
  let selectedVideo: VideoItem | null = null;
  let momentFilter: string | null = null;
  let filters: FilterState = normalizeVisibleFilters(loadFilters());
  let filterBarOpen: boolean = loadOpen();
  let filterMotionTimer: number | null = null;
  let scraping = false;
  let settingsOpen = false;
  let settingsClosing = false;
  let settingsCloseTimer: number | null = null;
  let refreshScanMode: ScrapeMode = loadRefreshScanMode();
  let editingAccount: string | null = null;
  let suppressAccountClick = false;
  let accountSortable: Sortable | null = null;
  // assetPathCache defined above in the boot phase; shared via closure

  // Fold per-account achievements into a flat matchesId → achievement map
  const matchAchievements = new Map<string, { type: 'mvp' | 'svp'; typeStr: string }>();
  function rebuildMatchAchievements() {
    matchAchievements.clear();
    for (const a of data.accounts) {
      if (a.achievements) {
        for (const achv of a.achievements) {
          if (achv.achvType === 'mvp' || achv.achvType === 'svp') {
            matchAchievements.set(achv.matchesId, { type: achv.achvType as 'mvp' | 'svp', typeStr: achv.typeStr });
          }
        }
      }
    }
  }

  // Tag matches with achievement type for downstream filtering
  function tagMatchAchievements() {
    for (const m of data.matches) {
      const achv = matchAchievements.get(m.matches_id);
      if (achv) (m as unknown as Record<string, unknown>)._achvType = achv.type;
    }
  }
  rebuildMatchAchievements();
  tagMatchAchievements();

  const app = el('div', { class: `app${filterBarOpen ? ' is-filter-open' : ''}` });
  const top = topbar(filters.query, scraping, settingsOpen, refreshScanMode);
  const panes = el('div', { class: 'panes' });
  const accountSlot = el('aside', { class: 'pane accounts', 'aria-label': '账户列表' });
  const filterSlot = el('aside', { class: 'pane filter-rail', 'aria-label': '筛选' });
  const listSlot = el('main', { class: 'pane list', 'aria-label': '高光列表' });
  const detailSlot = el('aside', { class: 'pane detail', 'aria-label': '高光详情' });
  const settingsSlot = el('div', { class: 'settings-modal-root' });
  // In-app full scan mounts a `.scan-progress` overlay into this slot.
  // The overlay is `position: fixed; inset: 0`, so DOM placement is
  // cosmetic — it visually covers the whole viewport regardless.
  const scanProgressSlot = el('div', { class: 'scan-progress-root' });
  filterSlot.hidden = !filterBarOpen;
  panes.append(accountSlot, filterSlot, listSlot, detailSlot);
  settingsSlot.hidden = true;
  app.append(top, panes, settingsSlot, scanProgressSlot);
  root.replaceChildren(app);

  const search = top.querySelector<HTMLInputElement>('.search');
  if (search) {
    search.addEventListener('input', e => {
      filters = { ...filters, query: (e.target as HTMLInputElement).value };
      saveFilters(filters);
      refreshForFilterChange({ refreshRail: true });
    });
    search.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        filters = { ...filters, query: '' };
        saveFilters(filters);
        search.value = '';
        refreshForFilterChange({ refreshRail: true });
      }
    });
  }

  top.addEventListener('click', e => {
    const target = e.target as HTMLElement;
    const scrapeBtn = target.closest<HTMLElement>('[data-action="scrape-library"]');
    if (scrapeBtn) {
      if (!scraping) void scrapeLibraryNow(refreshScanMode);
      return;
    }
    const settingsBtn = target.closest<HTMLElement>('[data-action="open-settings"]');
    if (settingsBtn) {
      setSettingsOpen(true);
    }
  });

  function playFirst(m: MatchRecord, seekMs?: number) {
    const video = m.videos[0];
    if (!video) { showToast('这场高光没有视频', 'error'); return; }
    void playVideoWithRounds(video, m, seekMs);
  }

  /** Open the player for `video`, first ensuring its match's rounds are
   *  loaded so the timeline markers (and any seek) work. */
  async function playVideoWithRounds(video: VideoItem, m: MatchRecord, seekMs?: number) {
    if (shouldLoadMatchRounds(m, loadedMatchIds)) {
      await loadMatchRounds(m);
    }
    selectedVideo = video;
    openPlayer(video, () => { selectedVideo = null; refreshAll(); }, seekMs, { match: m });
  }

  // Tracks which matches already have their rounds / events loaded, so we
  // don't re-invoke `get_match_rounds` every time the user re-selects the
  // same match. The actual rounds data lives on the `MatchRecord` object
  // itself (mutated in place by `loadMatchRounds`).
  const loadedMatchIds = new Set<string>();

  async function loadMatchRounds(m: MatchRecord): Promise<void> {
    if (loadedMatchIds.has(m.matches_id)) return;
    loadedMatchIds.add(m.matches_id);
    try {
      const full = await invoke<MatchRecord>('get_match_rounds', {
        openid: m.openID,
        matchId: m.matches_id,
      });
      // Mutate the in-place match object so the rest of the app sees the
      // rounds data without re-running match selection. We copy per-video
      // rounds onto the existing videos (matched by video_id) so the user's
      // currently selected match object is the same reference everywhere.
      for (const liveV of m.videos) {
        const fullV = full.videos.find(v => v.video_id === liveV.video_id);
        if (fullV) liveV.rounds = fullV.rounds;
      }
    } catch (e) {
      loadedMatchIds.delete(m.matches_id);
      showToast(`读取事件失败: ${(e as Error).message ?? String(e)}`, 'error');
    }
  }

  function ensureSelectedMatchRoundsLoaded() {
    const match = selectedMatch;
    if (!shouldLoadMatchRounds(match, loadedMatchIds)) return;
    void loadMatchRounds(match).then(() => {
      if (selectedMatch?.matches_id === match.matches_id) refreshDetail();
    });
  }

  function matchesForAccount(openid: string | null): MatchRecord[] {
    if (!openid) return [];
    const filtered = openid === ALL_ACCOUNTS
      ? data.matches
      : data.matches.filter((m: MatchRecord) => m.openID === openid);
    return [...filtered].sort((a, b) => b.matches_time - a.matches_time);
  }

  let scrollToKey: string | null = null;

  function realAccounts(): Account[] {
    return data.accounts;
  }

  function accountsForRender(): Account[] {
    const accounts = realAccounts();
    return accounts.length > 0
      ? [{ openid: ALL_ACCOUNTS, path: '', matchCount: data.matches.length }, ...accounts]
      : accounts;
  }

  function accountLabels(): Map<string, string> {
    const accounts = realAccounts();
    const unknownIdx = unknownIndices(accounts);
    const labels = new Map<string, string>();
    for (const a of accounts) {
      if (a.openid === ALL_ACCOUNTS) continue;
      labels.set(a.openid, accountLabel(a, unknownIdx.get(a.openid)));
    }
    return labels;
  }

  function accountOrder(): string[] {
    return data.accounts.map(a => a.openid);
  }

  function persistAccountOrder(prevAccounts: Account[], nextOrder: string[]) {
    void invoke('save_account_order', { openids: nextOrder }).catch(e => {
      data.accounts = prevAccounts;
      showToast(`账户排序保存失败: ${(e as Error).message ?? String(e)}`, 'error');
      refreshAll();
    });
  }

  function destroyAccountSortable() {
    accountSortable?.destroy();
    accountSortable = null;
  }

  function realAccountOrderFromDom(list: HTMLElement): string[] {
    return Array.from(list.querySelectorAll<HTMLElement>('.account[data-account-id]'))
      .map(row => row.dataset.accountId ?? '')
      .filter(openid => openid && openid !== ALL_ACCOUNTS);
  }

  function initAccountSortable() {
    destroyAccountSortable();
    const list = accountSlot.querySelector<HTMLElement>('.account-sortable-list');
    if (!list || data.accounts.filter(a => a.openid !== ALL_ACCOUNTS).length <= 1) return;
    accountSortable = Sortable.create(list, {
      animation: 150,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      direction: 'vertical',
      handle: '.account-grip',
      draggable: '.account:not(.is-all):not(.is-editing)',
      filter: '.account-edit-btn, .account-rename-input, .is-all',
      preventOnFilter: false,
      forceFallback: true,
      fallbackOnBody: true,
      fallbackTolerance: 0,
      fallbackClass: 'account-sortable-fallback',
      swapThreshold: 0.3,
      invertSwap: true,
      invertedSwapThreshold: 0.85,
      emptyInsertThreshold: 8,
      ghostClass: 'account-sortable-ghost',
      chosenClass: 'account-sortable-chosen',
      dragClass: 'account-sortable-drag',
      onMove: evt => {
        const related = evt.related as HTMLElement | null;
        return related?.dataset.accountId === ALL_ACCOUNTS ? false : true;
      },
      onStart: () => {
        accountSlot.classList.add('is-account-sorting');
        suppressAccountClick = true;
        hideTooltip();
      },
      onEnd: () => {
        accountSlot.classList.remove('is-account-sorting');
        window.setTimeout(() => { suppressAccountClick = false; }, 0);
        const nextOrder = realAccountOrderFromDom(list);
        const first = list.firstElementChild instanceof HTMLElement ? list.firstElementChild : null;
        const sentinelMoved = first?.dataset.accountId !== ALL_ACCOUNTS;
        if (nextOrder.join('\u0000') !== accountOrder().join('\u0000')) {
          const prevAccounts = [...data.accounts];
          data.accounts = applyAccountOrder(data.accounts, nextOrder);
          persistAccountOrder(prevAccounts, nextOrder);
        }
        if (sentinelMoved) refreshAccounts();
      },
      onUnchoose: () => {
        accountSlot.classList.remove('is-account-sorting');
        window.setTimeout(() => { suppressAccountClick = false; }, 0);
      },
    });
  }

  function startAccountRename(openid: string) {
    if (openid === ALL_ACCOUNTS) return;
    editingAccount = openid;
    refreshAccounts();
  }

  function cancelAccountRename() {
    if (!editingAccount) return;
    editingAccount = null;
    refreshAccounts();
  }

  function commitAccountRename(openid: string, rawValue: string) {
    if (editingAccount !== openid) return;
    const account = data.accounts.find(a => a.openid === openid);
    if (!account) {
      editingAccount = null;
      refreshAccounts();
      return;
    }
    const prev = account.customName;
    const next = rawValue.trim();
    account.customName = next || undefined;
    editingAccount = null;
    refreshAll();
    void invoke('rename_account', {
      openid,
      customName: next || null,
    }).catch(e => {
      account.customName = prev;
      showToast(`账户重命名保存失败: ${(e as Error).message ?? String(e)}`, 'error');
      refreshAll();
    });
  }

  function currentScopeLabel(): string {
    if (selectedAccount === ALL_ACCOUNTS) return '全部账号';
    const labels = accountLabels();
    return selectedAccount ? (labels.get(selectedAccount) ?? selectedAccount) : '未选择账户';
  }

  function filteredAccountCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    counts.set(ALL_ACCOUNTS, applyFilters(data.matches, filters).length);
    for (const a of realAccounts()) {
      if (a.error) {
        counts.set(a.openid, 0);
        continue;
      }
      counts.set(a.openid, applyFilters(data.matches.filter(m => m.openID === a.openid), filters).length);
    }
    return counts;
  }

  function currentAccountMatches(): MatchRecord[] {
    return matchesForAccount(selectedAccount);
  }

  function currentFilteredMatches(): MatchRecord[] {
    return applyFilters(currentAccountMatches(), filters);
  }

  function findMatch(id: string | undefined): MatchRecord | null {
    if (!id) return null;
    return currentFilteredMatches().find(m => m.matches_id === id)
      ?? currentAccountMatches().find(m => m.matches_id === id)
      ?? null;
  }

  function findVideo(src: string | undefined): VideoItem | null {
    if (!src) return null;
    const pools = selectedMatch ? [selectedMatch, ...currentAccountMatches()] : currentAccountMatches();
    for (const m of pools) {
      for (const v of m.videos) {
        if (v.video_src === src) return v;
      }
    }
    return null;
  }

  function findMatchByVideo(video: VideoItem): MatchRecord | null {
    for (const m of data.matches) {
      if (m.videos.some(v => v.video_id === video.video_id && v.video_src === video.video_src)) {
        return m;
      }
    }
    return null;
  }

  function setFilterBarOpen(open: boolean) {
    filterBarOpen = open;
    saveOpen(open);
    app.classList.toggle('is-filter-open', open);
    filterSlot.hidden = !open;
    refreshAccounts();
    if (open) refreshFilterRail();
    refreshList();
  }

  function applyFilterPatch(patch: Partial<FilterState>, opts: { refreshRail: boolean }) {
    Object.assign(filters, patch);
    filters = normalizeVisibleFilters(filters);
    const didPrune = pruneFiltersForScope();
    saveFilters(filters);
    refreshForFilterChange({ refreshRail: opts.refreshRail || didPrune || patchNeedsFullRailRefresh(patch) });
  }

  function refreshForFilterChange(opts: { refreshRail: boolean }) {
    beginFilterMotion();
    refreshAccounts();
    if (opts.refreshRail) refreshFilterRail();
    else refreshFilterRailChrome();
    refreshList();
    syncSearchValue();
  }

  function pruneFiltersForScope(): boolean {
    const next = normalizeVisibleFilters(pruneUnavailableCategories(currentAccountMatches(), filters));
    if (next === filters) return false;
    filters = next;
    return true;
  }

  function patchNeedsFullRailRefresh(patch: Partial<FilterState>): boolean {
    return CATEGORY_KEYS.some(key => Object.prototype.hasOwnProperty.call(patch, key));
  }

  function beginFilterMotion() {
    if (selectedVideo) return;
    app.classList.remove('is-filtering');
    void app.offsetWidth;
    app.classList.add('is-filtering');
    if (filterMotionTimer !== null) window.clearTimeout(filterMotionTimer);
    filterMotionTimer = window.setTimeout(() => {
      app.classList.remove('is-filtering');
      filterMotionTimer = null;
    }, 220);
  }

  function onClearFilter(key: string, value?: string) {
    if (key === '__all__') {
      Object.assign(filters, { ...EMPTY_FILTERS, query: filters.query });
      saveFilters(filters);
      refreshForFilterChange({ refreshRail: true });
      return;
    }
    if (key === 'query') {
      filters = { ...filters, query: '' };
      saveFilters(filters);
      refreshForFilterChange({ refreshRail: true });
      return;
    }
    const catSet = new Set(CATEGORY_KEYS);
    if (catSet.has(key as any)) {
      const arr = [...filters[key as keyof typeof filters] as unknown as string[]];
      if (value !== undefined) {
        const s = new Set(arr);
        s.delete(value);
        Object.assign(filters, { [key]: [...s] });
      }
      saveFilters(filters);
      refreshForFilterChange({ refreshRail: true });
      return;
    }
    if (RANGE_KEYS.includes(key as any)) {
      Object.assign(filters, { [key]: [null, null] });
      saveFilters(filters);
      refreshForFilterChange({ refreshRail: true });
      return;
    }
  }

  function onFocusSection(key: string) {
    scrollToKey = key;
    if (!filterBarOpen) {
      filterBarOpen = true;
      saveOpen(true);
    }
    app.classList.toggle('is-filter-open', filterBarOpen);
    refreshAccounts();
    refreshFilterRail();
    refreshList();
    runPendingScroll();
  }

  function refreshAll() {
    if (selectedVideo) return;
    app.classList.toggle('is-filter-open', filterBarOpen);
    refreshAccounts();
    refreshFilterRail();
    refreshList();
    refreshDetail();
    refreshSettingsModal();
    syncSearchValue();
    runPendingScroll();
  }

  function refreshTopbarChrome() {
    const btn = top.querySelector<HTMLButtonElement>('[data-action="scrape-library"]');
    if (btn) {
      const scanLabel = scanModeLabel(refreshScanMode);
      btn.classList.toggle('is-loading', scraping);
      btn.disabled = scraping;
      btn.setAttribute('aria-label', scraping ? '正在扫描资料库' : `${scanLabel}资料库`);
      btn.dataset.tip = scraping ? '正在扫描资料库' : `${scanLabel}资料库`;
    }
    const settingsBtn = top.querySelector<HTMLButtonElement>('[data-action="open-settings"]');
    if (settingsBtn) {
      settingsBtn.classList.toggle('is-active', settingsOpen);
      settingsBtn.setAttribute('aria-expanded', String(settingsOpen));
    }
  }

  function refreshSettingsModal() {
    const visible = settingsOpen || settingsClosing;
    settingsSlot.hidden = !visible;
    if (!visible) {
      settingsSlot.replaceChildren();
      return;
    }
    const current = settingsSlot.firstElementChild as HTMLElement | null;
    const currentClosing = current?.classList.contains('is-closing') ?? false;
    if (current && currentClosing === settingsClosing) {
      refreshSettingsModalChrome();
      return;
    }
    settingsSlot.replaceChildren(settingsModal(scraping, refreshScanMode, settingsClosing));
  }

  function refreshSettingsModalChrome() {
    const fullButton = settingsSlot.querySelector<HTMLButtonElement>('[data-action="scrape-library-full"]');
    if (fullButton) {
      fullButton.disabled = scraping;
      const label = fullButton.querySelector('span');
      if (label) label.textContent = scraping ? '扫描中' : '全量扫描';
    }
    for (const btn of settingsSlot.querySelectorAll<HTMLButtonElement>('[data-action="set-refresh-scan-mode"]')) {
      const active = btn.dataset.mode === refreshScanMode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-checked', String(active));
    }
  }

  function setRefreshScanMode(mode: ScrapeMode) {
    refreshScanMode = mode;
    saveRefreshScanMode(mode);
    refreshTopbarChrome();
    refreshSettingsModalChrome();
    hideTooltip();
  }

  function setSettingsOpen(open: boolean) {
    if (settingsCloseTimer !== null) {
      window.clearTimeout(settingsCloseTimer);
      settingsCloseTimer = null;
    }
    if (open) {
      settingsOpen = true;
      settingsClosing = false;
    } else {
      if (!settingsOpen && !settingsClosing) return;
      settingsOpen = false;
      settingsClosing = true;
      settingsCloseTimer = window.setTimeout(() => {
        settingsClosing = false;
        settingsCloseTimer = null;
        refreshTopbarChrome();
        refreshSettingsModal();
      }, 150);
    }
    refreshTopbarChrome();
    refreshSettingsModal();
    hideTooltip();
    if (open) {
      window.setTimeout(() => {
        settingsSlot.querySelector<HTMLButtonElement>('[data-action="close-settings"]')?.focus();
      }, 0);
    }
  }

  function trapSettingsFocus(e: KeyboardEvent) {
    if (!settingsOpen || e.key !== 'Tab') return;
    const modal = settingsSlot.querySelector<HTMLElement>('.settings-modal');
    if (!modal) return;
    const focusables = Array.from(
      modal.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter(node => !node.hasAttribute('disabled') && node.offsetParent !== null);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  async function scrapeLibraryNow(mode: ScrapeMode = 'incremental') {
    scraping = true;
    refreshTopbarChrome();
    refreshSettingsModal();
    const prevAccount = selectedAccount;
    const prevMatchId = selectedMatch?.matches_id;
    // Full scans reuse the boot progress UI: a fixed fullscreen overlay
    // with the same brand+progress+status visuals, then a smooth fade.
    // Incremental scans keep the original lightweight button-spinner
    // path — they're usually short and the overlay would be distracting.
    const useOverlay = mode === 'full';
    const progress = useOverlay
      ? await mountScanProgress(scanProgressSlot, {
          mode: 'overlay',
          skipAssetPreWarm: true,
          initialLabel: '正在准备全量扫描\u2026',
          initialPct: 5,
        })
      : null;
    try {
      const fresh = await invoke<LoadResult>('scrape_library', {
        trigger: mode === 'full' ? 'full_manual' : 'manual',
        mode,
      });
      data = fresh;
      rebuildMatchAchievements();
      tagMatchAchievements();
      loadedMatchIds.clear();
      if (prevAccount && (prevAccount === ALL_ACCOUNTS || data.accounts.some(a => a.openid === prevAccount))) {
        selectedAccount = prevAccount;
      } else {
        selectedAccount = data.accounts.length > 0 ? ALL_ACCOUNTS : null;
      }
      selectedMatch = prevMatchId
        ? data.matches.find(m => m.matches_id === prevMatchId) ?? null
        : null;
      if (selectedMatch && !matchesForAccount(selectedAccount).some(m => m.matches_id === selectedMatch!.matches_id)) {
        selectedMatch = null;
      }
      if (progress) {
        // The overlay's own completion handles the "done" feedback,
        // so suppress the toast when the overlay is in use.
        await progress.complete();
      } else {
        showToast(`资料库已${scanModeLabel(mode)}`);
      }
      refreshAll();
      ensureSelectedMatchRoundsLoaded();
    } catch (e) {
      const msg = `${scanModeLabel(mode)}失败: ${(e as Error).message ?? String(e)}`;
      if (progress) {
        progress.update(msg);
        await progress.complete();
      } else {
        showToast(msg, 'error');
      }
    } finally {
      scraping = false;
      refreshTopbarChrome();
      refreshSettingsModal();
    }
  }

  function syncSearchValue() {
    const input = top.querySelector<HTMLInputElement>('.search');
    if (!input || document.activeElement === input) return;
    input.value = filters.query;
  }

  function refreshAccounts() {
    if (selectedVideo) return;
    destroyAccountSortable();
    const pane = accountsPane(
      accountsForRender(),
      selectedAccount,
      filteredAccountCounts(),
      activeFilterCount(filters) > 0,
      editingAccount,
    );
    accountSlot.className = pane.className;
    accountSlot.setAttribute('aria-label', pane.getAttribute('aria-label') ?? '账户列表');
    accountSlot.replaceChildren(...Array.from(pane.childNodes));
    if (editingAccount) {
      const input = accountSlot.querySelector<HTMLInputElement>(`[data-account-rename-input="${editingAccount}"]`);
      if (input) {
        input.focus();
        input.select();
      }
    }
    initAccountSortable();
  }

  function refreshFilterRail() {
    if (selectedVideo) return;
    const prevBody = filterSlot.querySelector<HTMLElement>('.filter-rail-body');
    const prevScroll = prevBody?.scrollTop ?? 0;
    const rail = createFilterRail(
      filters,
      currentAccountMatches(),
      currentScopeLabel(),
      patch => applyFilterPatch(patch, { refreshRail: false }),
      () => setFilterBarOpen(false),
    );
    filterSlot.className = rail.className;
    filterSlot.setAttribute('aria-label', rail.getAttribute('aria-label') ?? '筛选');
    filterSlot.hidden = !filterBarOpen;
    filterSlot.replaceChildren(...Array.from(rail.childNodes));
    const nextBody = filterSlot.querySelector<HTMLElement>('.filter-rail-body');
    if (nextBody) nextBody.scrollTop = prevScroll;
  }

  function refreshFilterRailChrome() {
    const activeN = activeFilterCount(filters);
    const headRight = filterSlot.querySelector<HTMLElement>('.pane-head-right');
    if (headRight) {
      let sub = headRight.querySelector<HTMLElement>('.pane-sub');
      if (activeN > 0) {
        if (!sub) {
          sub = el('span', { class: 'pane-sub' });
          headRight.prepend(sub);
        }
        sub.textContent = `${activeN} 个`;
      } else {
        sub?.remove();
      }
    }

    const activeRangeN = ADVANCED_RANGE_KEYS.reduce((n, key) => {
      const [lo, hi] = filters[key];
      return n + (lo !== null || hi !== null ? 1 : 0);
    }, 0);
    const groupHeader = filterSlot.querySelector<HTMLElement>('.filter-num-group-header');
    const groupCount = filterSlot.querySelector<HTMLElement>('.filter-num-group-count');
    if (groupHeader) groupHeader.classList.toggle('is-active', activeRangeN > 0);
    if (groupCount) groupCount.textContent = activeRangeN > 0 ? String(activeRangeN) : '';

    let footer = filterSlot.querySelector<HTMLElement>('.filter-rail-footer');
    if (activeN > 0 && !footer) {
      footer = el('div', { class: 'filter-rail-footer' });
      const clearBtn = el('button', {
        class: 'filter-rail-clear',
        type: 'button',
      }, ['清除全部筛选']);
      clearBtn.addEventListener('click', () => {
        applyFilterPatch({ ...EMPTY_FILTERS, query: filters.query }, { refreshRail: true });
      });
      footer.append(clearBtn);
      filterSlot.append(footer);
    } else if (activeN === 0) {
      footer?.remove();
    }
  }

  function refreshList() {
    if (selectedVideo) return;
    const accountMatches = currentAccountMatches();
    const filteredMatches = applyFilters(accountMatches, filters);
    if (selectedMatch && !accountMatches.find(m => m.matches_id === selectedMatch!.matches_id)) {
      selectedMatch = null;
    }
    const listEl = listSlot.querySelector<HTMLElement>('.match-list');
    const prevListScroll = listEl?.scrollTop ?? 0;
    const pane = listPane(
      accountLabels(),
      accountMatches,
      filteredMatches,
      selectedMatch?.matches_id ?? null,
      filters,
      patch => applyFilterPatch(patch, { refreshRail: true }),
      filterBarOpen,
      () => setFilterBarOpen(!filterBarOpen),
      assetPathCache,
      onClearFilter,
      onFocusSection,
      matchAchievements,
    );
    listSlot.className = pane.className;
    listSlot.setAttribute('aria-label', pane.getAttribute('aria-label') ?? '高光列表');
    listSlot.replaceChildren(...Array.from(pane.childNodes));
    const newList = listSlot.querySelector<HTMLElement>('.match-list');
    if (newList) newList.scrollTop = prevListScroll;
  }

  function openEventListForMatch(m: MatchRecord) {
    if (!loadedMatchIds.has(m.matches_id)) return;
    const events = normalizeMatchEvents(m);
    if (events.length === 0) {
      showToast('这场高光没有事件数据', 'error');
      return;
    }
    const matchLabel = `${agentCn(m)} · ${mapCn(m)} · ${m.stats.kills}/${m.stats.deaths}/${m.stats.assists}`;
    openEventListModal(events, matchLabel, (video, seekMs) => {
      void playVideoWithRounds(video, m, seekMs);
    }, m.stats);
  }

  function refreshDetail() {
    if (selectedVideo) return;
    const roundsLoaded = selectedMatch
      ? loadedMatchIds.has(selectedMatch.matches_id)
      : false;
    const pane = detailPane(selectedMatch, momentFilter, t => {
      momentFilter = t;
      refreshDetail();
    }, assetPathCache, openEventListForMatch, roundsLoaded);
    detailSlot.className = pane.className;
    detailSlot.setAttribute('aria-label', pane.getAttribute('aria-label') ?? '高光详情');
    detailSlot.replaceChildren(...Array.from(pane.childNodes));
  }

  function selectAccount(openid: string) {
    selectedAccount = openid;
    selectedMatch = null;
    momentFilter = null;
    refreshAll();
  }

  function selectMatch(m: MatchRecord) {
    selectedMatch = m;
    momentFilter = null;
    refreshList();
    refreshDetail();
    ensureSelectedMatchRoundsLoaded();
  }

  function runPendingScroll() {
    if (scrollToKey && filterBarOpen) {
      const section = root.querySelector<HTMLElement>(`[data-filter-key="${scrollToKey}"]`);
      if (section) {
        section.scrollIntoView({ behavior: 'smooth', block: 'center' });
        section.classList.add('is-active');
        setTimeout(() => section.classList.remove('is-active'), 1200);
      }
      scrollToKey = null;
    }
  }

  root.addEventListener('click', e => {
    const target = e.target as HTMLElement;
    if (settingsOpen || settingsClosing) {
      if (target.classList.contains('settings-modal-backdrop')) {
        setSettingsOpen(false);
        return;
      }
      if (target.closest<HTMLElement>('[data-action="close-settings"]')) {
        setSettingsOpen(false);
        return;
      }
      if (target.closest<HTMLElement>('[data-action="scrape-library-full"]')) {
        if (!scraping) void scrapeLibraryNow('full');
        return;
      }
      const modeButton = target.closest<HTMLElement>('[data-action="set-refresh-scan-mode"]');
      if (modeButton) {
        const nextMode = modeButton.dataset.mode === 'full' ? 'full' : 'incremental';
        setRefreshScanMode(nextMode);
        return;
      }
      if (target.closest<HTMLElement>('.settings-modal')) return;
    }
    if (selectedVideo) return;
    const renameBtn = target.closest<HTMLElement>('[data-action="rename-account"]');
    if (renameBtn && root.contains(renameBtn)) {
      e.preventDefault();
      e.stopPropagation();
      const openid = renameBtn.dataset.accountId;
      if (openid) startAccountRename(openid);
      return;
    }

    if (target.closest<HTMLElement>('.account-rename-input')) return;

    const playBtn = target.closest<HTMLButtonElement>('button[data-src]');
    if (playBtn && root.contains(playBtn)) {
      const video = findVideo(playBtn.dataset.src);
      if (!video) { showToast('视频数据丢失', 'error'); return; }
      const match = findMatchByVideo(video);
      if (match) {
        void playVideoWithRounds(video, match);
      } else {
        selectedVideo = video;
        openPlayer(video, () => { selectedVideo = null; refreshAll(); });
      }
      return;
    }

    const account = target.closest<HTMLElement>('[data-account-id]');
    if (account && root.contains(account)) {
      if (suppressAccountClick) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const openid = account.dataset.accountId;
      if (openid) selectAccount(openid);
      return;
    }

    const row = target.closest<HTMLElement>('[data-match-id]');
    if (row && root.contains(row)) {
      const m = findMatch(row.dataset.matchId);
      if (m) selectMatch(m);
    }
  });

  root.addEventListener('dblclick', e => {
    if (selectedVideo) return;
    const target = e.target as HTMLElement;
    const account = target.closest<HTMLElement>('[data-account-id]');
    if (account && root.contains(account) && account.dataset.accountId !== ALL_ACCOUNTS) {
      e.preventDefault();
      const openid = account.dataset.accountId;
      if (openid) startAccountRename(openid);
      return;
    }
    const row = target.closest<HTMLElement>('[data-match-id]');
    if (!row || !root.contains(row)) return;
    const m = findMatch(row.dataset.matchId);
    if (m) playFirst(m);
  });

  root.addEventListener('keydown', e => {
    if (selectedVideo) return;
    const target = e.target as HTMLElement;
    const renameInput = target.closest<HTMLInputElement>('.account-rename-input');
    if (renameInput) {
      if (e.key === 'Enter') {
        e.preventDefault();
        const openid = renameInput.dataset.accountRenameInput;
        if (openid) commitAccountRename(openid, renameInput.value);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelAccountRename();
      }
      return;
    }

    const account = target.closest<HTMLElement>('[data-account-id]');
    if (account && root.contains(account) && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      const openid = account.dataset.accountId;
      if (openid) selectAccount(openid);
      return;
    }

    const row = target.closest<HTMLElement>('[data-match-id]');
    if (row && root.contains(row) && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      const m = findMatch(row.dataset.matchId);
      if (!m) return;
      selectMatch(m);
      if (e.key === 'Enter') playFirst(m);
    }
  });

  root.addEventListener('focusout', e => {
    const input = (e.target as HTMLElement).closest<HTMLInputElement>('.account-rename-input');
    if (!input) return;
    const openid = input.dataset.accountRenameInput;
    if (openid) commitAccountRename(openid, input.value);
  });

  wireTooltips(root);
  pruneFiltersForScope();
  saveFilters(filters);
  refreshAll();

  // global keyboard: ↑/↓ in list, Enter to play, / focuses search,
  // F toggles filter rail, Esc closes filter rail
  document.addEventListener('keydown', (e) => {
    if (settingsOpen) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setSettingsOpen(false);
        return;
      }
      trapSettingsFocus(e);
      return;
    }
    if (!selectedAccount || selectedVideo) return;
    const accountMatches = matchesForAccount(selectedAccount);

    // Esc: close filter rail (but not when in an input — search handles its own Esc)
    if (e.key === 'Escape' && filterBarOpen && document.activeElement?.tagName !== 'INPUT') {
      e.preventDefault();
      setFilterBarOpen(false);
      return;
    }

    // F: toggle filter rail (not while focused in an input)
    if (e.key === 'f' && document.activeElement?.tagName !== 'INPUT') {
      e.preventDefault();
      setFilterBarOpen(!filterBarOpen);
      return;
    }

    if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
      e.preventDefault();
      search?.focus();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const idx = accountMatches.findIndex(m => m.matches_id === selectedMatch?.matches_id);
      const next = e.key === 'ArrowDown'
        ? Math.min(accountMatches.length - 1, idx + 1)
        : Math.max(0, idx - 1);
      const m = accountMatches[next];
      if (m) { selectMatch(m); e.preventDefault(); }
    } else if (e.key === 'Enter' && selectedMatch) {
      e.preventDefault();
      playFirst(selectedMatch);
    }
  });
}

/**
 * Refresh and load the local library. Single Tauri call: Rust scans the
 * configured WonderfulDb source into SQLite, then returns the aggregated
 * matches + per-account metadata. Per-account failures are surfaced via
 * `account.error`; the whole call only fails for library/open or
 * directory-level source failures.
 */
async function loadAll(): Promise<LoadResult> {
  return await invoke<LoadResult>('scan_all');
}

// ─── custom tooltip ────────────────────────────────────────────────────
//
// Replaces the OS-native `title=` bubble. One shared `<div class="tooltip">`
// lives on `document.body`, positioned via @floating-ui/dom. Smart-flip
// chooses the best side based on available space; cursor-tracking aligns
// the horizontal anchor to the mouse X inside the target so the tooltip
// feels connected without chasing the cursor (element-bound, not jittery).
//
// A 800ms persistent-hover delay prevents the tooltip from fighting with
// click intent. The timer is cancelled on `mouseleave` / `blur` / scroll.

const TOOLTIP_DELAY_MS = 800;

let tooltipEl: HTMLDivElement | null = null;
let tooltipGlobalWired = false;
let tooltipTimer: number | null = null;
let tooltipTarget: HTMLElement | null = null;
let tooltipCursorX = 0;
const tooltipScopes = new WeakSet<ParentNode>();

function wireTooltipGlobals() {
  if (tooltipGlobalWired) return;
  tooltipGlobalWired = true;
  window.addEventListener('scroll', onTooltipScroll, { passive: true, capture: true });
  window.addEventListener('blur', hideTooltip);
}

function onTooltipScroll() {
  const tip = tooltipEl;
  if (!tip || !tip.classList.contains('is-visible')) return;
  if (tooltipTarget && tooltipTarget.isConnected) {
    const ref = referenceAtX(tooltipTarget, tooltipCursorX);
    positionFloating(ref, tip);
  } else {
    hideTooltip();
  }
}

function ensureTooltip(): HTMLDivElement {
  wireTooltipGlobals();
  if (tooltipEl) return tooltipEl;
  tooltipEl = document.createElement('div');
  tooltipEl.className = 'tooltip';
  tooltipEl.setAttribute('role', 'tooltip');
  const arrow = createArrow();
  tooltipEl.appendChild(arrow);
  document.body.appendChild(tooltipEl);
  return tooltipEl;
}

function clearTooltipTimer() {
  if (tooltipTimer != null) {
    clearTimeout(tooltipTimer);
    tooltipTimer = null;
  }
}

function showTooltipNow(target: HTMLElement, text: string) {
  const tip = ensureTooltip();
  if (tip.textContent === text && tip.classList.contains('is-visible')) {
    positionTooltip(target);
    return;
  }
  tip.textContent = text;
  tip.classList.add('is-visible');
  positionTooltip(target);
}

function scheduleTooltip(target: HTMLElement, text: string) {
  clearTooltipTimer();
  tooltipTimer = window.setTimeout(() => {
    tooltipTimer = null;
    showTooltipNow(target, text);
  }, TOOLTIP_DELAY_MS);
}

function hideTooltip() {
  clearTooltipTimer();
  tooltipTarget = null;
  tooltipEl?.classList.remove('is-visible');
}

function positionTooltip(target: HTMLElement) {
  const tip = tooltipEl;
  if (!tip) return;
  const ref = referenceAtX(target, tooltipCursorX);
  positionFloating(ref, tip);
}

function wireTooltips(scope: ParentNode) {
  if (tooltipScopes.has(scope)) return;
  tooltipScopes.add(scope);

  scope.addEventListener('mouseover', e => {
    const event = e as MouseEvent;
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
    if (!t || !scope.contains(t)) return;
    const related = event.relatedTarget as Node | null;
    if (related && t.contains(related)) return;
    tooltipTarget = t;
    tooltipCursorX = event.clientX;
    const text = t.dataset.tip;
    if (text) scheduleTooltip(t, text);
  });

  scope.addEventListener('mousemove', e => {
    const event = e as MouseEvent;
    if (!tooltipTarget) return;
    tooltipCursorX = event.clientX;
    if (tooltipEl?.classList.contains('is-visible') && tooltipTarget.isConnected) {
      positionTooltip(tooltipTarget);
    }
  });

  scope.addEventListener('mouseout', e => {
    const event = e as MouseEvent;
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
    if (!t || !scope.contains(t)) return;
    const related = event.relatedTarget as Node | null;
    if (related && t.contains(related)) return;
    hideTooltip();
  });

  scope.addEventListener('focusin', e => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
    if (!t || !scope.contains(t)) return;
    tooltipTarget = t;
    tooltipCursorX = t.getBoundingClientRect().left + t.getBoundingClientRect().width / 2;
    const text = t.dataset.tip;
    if (text) scheduleTooltip(t, text);
  });

  scope.addEventListener('focusout', hideTooltip);
}
