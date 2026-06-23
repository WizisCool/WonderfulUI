import { invoke as tauriInvoke, convertFileSrc as tauriConvertFileSrc } from '@tauri-apps/api/core';
import { listen as tauriListen } from '@tauri-apps/api/event';
import type { MatchRecord, RoundItem, VideoItem } from '@wonderful-ui/parser';
import type { LibraryStats } from './utils/library-stats.ts';

export type UnlistenFn = () => void;

type InvokeArgs = Record<string, unknown> | undefined;
type Listener<T> = (event: { payload: T }) => void;

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    __WUI_DEBUG__?: {
      enabled: boolean;
      mode: 'browser';
      emit<T>(event: string, payload: T): void;
      getLibrary(): unknown;
    };
  }
}

function hasTauriRuntime(): boolean {
  return typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;
}

function wantsDebugRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return params.has('debug') || params.get('runtime') === 'browser';
}

export const isBrowserDebugRuntime =
  typeof window !== 'undefined' && (wantsDebugRuntime() || !hasTauriRuntime());

const mockEventListeners = new Map<string, Set<Listener<unknown>>>();

function emitMockEvent<T>(event: string, payload: T): void {
  const listeners = mockEventListeners.get(event);
  if (!listeners) return;
  for (const listener of listeners) listener({ payload });
}

function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function svgData(label: string, bg: string, fg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 270">
      <rect width="480" height="270" fill="${bg}"/>
      <path d="M0 218 120 112 216 164 314 66 480 206v64H0z" fill="${fg}" opacity=".34"/>
      <circle cx="382" cy="72" r="42" fill="${fg}" opacity=".5"/>
      <text x="28" y="236" fill="#f2eee8" font-family="system-ui, sans-serif" font-size="38" font-weight="700">${label}</text>
    </svg>`,
  )}`;
}

const now = Date.parse('2026-06-20T22:10:00+08:00');
const ascentMap = svgData('亚海悬城', '#24201d', '#df4f45');
const bindMap = svgData('源工重镇', '#20231f', '#62c97f');
const jettHero = svgData('捷风', '#1f2428', '#c6bfb6');
const sovaHero = svgData('猎枭', '#24211e', '#d9b75f');
const modeIcon = svgData('竞技', '#211d1a', '#df4f45');
const posterKill = svgData('击杀集锦', '#211b19', '#df4f45');
const posterDeath = svgData('死亡集锦', '#171615', '#90877e');
const posterMoment = svgData('三杀时刻', '#1c211d', '#62c97f');

function eventExt(input: {
  eventTime: string;
  killer: string;
  killed: string;
  agent: string;
  weapon: string;
  killerIsMe: number;
  killedIsMe: number;
  shotPart: number;
  assistNum?: number;
}): Record<string, unknown> {
  return {
    EventName: 'Shot',
    EventTime: input.eventTime,
    KillerPlayerName: input.killer,
    KilledPlayerName: input.killed,
    AgentName: input.agent,
    WeaponSkinName: input.weapon,
    KillerIsMe: input.killerIsMe,
    KilledIsMe: input.killedIsMe,
    GetShotRolePart: input.shotPart,
    AssistNum: input.assistNum ?? 0,
  };
}

function roundWithEvents(events: Array<{ id: string; s: number; type: 'kill' | 'death'; ext: Record<string, unknown> }>): RoundItem {
  return {
    round_id: 'debug-round-1',
    round_duration: 82000,
    round_sTime: 0,
    round_honors: [],
    round_clips: [{
      clip_id: 'debug-clip-1',
      clip_duration: 82000,
      clip_sTime: 0,
      clip_events: events.map(e => ({
        event_id: e.id,
        event_sTime: e.s,
        event_type: e.type,
        event_ext: e.ext,
      })),
    }],
  };
}

function video(
  id: string,
  type: string,
  name: string,
  poster: string,
  rounds?: RoundItem[],
): VideoItem {
  return {
    video_id: id,
    video_src: `D:\\WonderfulUIDebug\\${id}.mp4`,
    video_duration: 82000,
    video_fps: 60,
    video_resolution: '1440x1080',
    video_name: name,
    video_poster: poster,
    video_ext: '.mp4',
    video_time: now,
    video_size: 58 * 1024 * 1024,
    video_level: '3',
    video_type: type,
    video_hash: `${id}-hash`,
    cover_hash: `${id}-cover`,
    template_id: 'debug-template',
    clips_count: rounds ? 1 : 0,
    is_upload: false,
    rounds,
  };
}

const debugRounds = roundWithEvents([
  {
    id: 'debug-kill-1',
    s: 12400,
    type: 'kill',
    ext: eventExt({
      eventTime: '2026-06-20 22:14:18.120',
      killer: 'DebugPlayer#0001',
      killed: '训练靶标#9102',
      agent: 'Jett',
      weapon: 'AssaultRifle_AK_PrimaryAsset.Default__AssaultRifle_AK_PrimaryAsset_C',
      killerIsMe: 1,
      killedIsMe: 0,
      shotPart: 1,
    }),
  },
  {
    id: 'debug-death-1',
    s: 43800,
    type: 'death',
    ext: eventExt({
      eventTime: '2026-06-20 22:17:42.240',
      killer: '对面雷兹#7777',
      killed: 'DebugPlayer#0001',
      agent: 'Jett',
      weapon: 'Shotgun_Auto_PrimaryAsset.Default__Shotgun_Auto_PrimaryAsset_C',
      killerIsMe: 0,
      killedIsMe: 1,
      shotPart: 0,
    }),
  },
]);

const fullMatches: MatchRecord[] = [
  {
    matches_id: 'debug-match-20260620-001',
    matches_time: now,
    map: { map_id: '/Game/Maps/Jam/Jam', map_name: '亚海悬城', map_image: ascentMap },
    agent: { agent_id: 'debug-agent-jett', agent_name: 'Jett' },
    stats: {
      kills: 24,
      assists: 7,
      deaths: 14,
      score: 6210,
      has_won: true,
      mode_name: '/Game/GameModes/Bomb/BombGameMode.BombGameMode_C',
      rounds_won: 13,
      rounds_lost: 9,
      game_level: '141',
    },
    openID: 'debug-openid-main',
    mode: 'competitive',
    minRoundId: 1,
    gameStartTime: '2026-06-20 22:12:00',
    gameEndTime: '2026-06-20 22:44:00',
    videos: [
      video('debug-kill-montage', '击杀集锦', '捷风 击杀集锦', posterKill, [debugRounds]),
      video('debug-death-montage', '死亡集锦', '捷风 死亡集锦', posterDeath, [debugRounds]),
      video('debug-triple-moment', '三杀时刻', '捷风 三杀时刻', posterMoment, [debugRounds]),
    ],
    career: {
      hero_name: '捷风',
      hero_image: jettHero,
      map_name: '亚海悬城',
      map_image: ascentMap,
      game_mode: '竞技模式',
      game_mode_icon: modeIcon,
    },
  },
  {
    matches_id: 'debug-match-20260619-002',
    matches_time: now - 86_400_000,
    map: { map_id: '/Game/Maps/Duality/Duality', map_name: '源工重镇', map_image: bindMap },
    agent: { agent_id: 'debug-agent-sova', agent_name: 'Sova' },
    stats: {
      kills: 15,
      assists: 12,
      deaths: 17,
      score: 4890,
      has_won: false,
      mode_name: '/Game/GameModes/Bomb/BombGameMode.BombGameMode_C',
      rounds_won: 11,
      rounds_lost: 13,
      game_level: '136',
    },
    openID: 'debug-openid-alt',
    mode: 'competitive',
    minRoundId: 1,
    gameStartTime: '2026-06-19 21:04:00',
    gameEndTime: '2026-06-19 21:40:00',
    videos: [
      video('debug-sova-kill-montage', '击杀集锦', '猎枭 击杀集锦', posterKill, []),
      video('debug-sova-clutch', '残局时刻', '猎枭 残局时刻', posterMoment, []),
    ],
    career: {
      hero_name: '猎枭',
      hero_image: sovaHero,
      map_name: '源工重镇',
      map_image: bindMap,
      game_mode: '竞技模式',
      game_mode_icon: modeIcon,
    },
  },
];

let accountOrder = ['debug-openid-main', 'debug-openid-alt'];
let customNames = new Map<string, string>();

function accountPayload() {
  const base = [
    {
      openid: 'debug-openid-main',
      path: 'D:\\WonderfulUIDebug\\WonderfulDb\\debug-openid-main',
      matchCount: fullMatches.filter(m => m.openID === 'debug-openid-main').length,
      nick: 'DebugPlayer',
      tag: '0001',
      customName: customNames.get('debug-openid-main') || undefined,
      achievements: [{ matchesId: 'debug-match-20260620-001', achvType: 'mvp', typeStr: 'MVP' }],
    },
    {
      openid: 'debug-openid-alt',
      path: 'D:\\WonderfulUIDebug\\WonderfulDb\\debug-openid-alt',
      matchCount: fullMatches.filter(m => m.openID === 'debug-openid-alt').length,
      nick: '浏览器样本',
      tag: '1420',
      customName: customNames.get('debug-openid-alt') || undefined,
      achievements: [{ matchesId: 'debug-match-20260619-002', achvType: 'svp', typeStr: 'SVP' }],
    },
  ];
  return accountOrder
    .map(id => base.find(account => account.openid === id))
    .filter((account): account is NonNullable<typeof account> => !!account);
}

function strippedMatches(): MatchRecord[] {
  return deepClone(fullMatches).map(match => ({
    ...match,
    videos: match.videos.map(({ rounds: _rounds, ...videoWithoutRounds }) => videoWithoutRounds),
  }));
}

function loadResult() {
  return {
    dir: 'D:\\WonderfulUIDebug\\WonderfulDb',
    accounts: accountPayload(),
    matches: strippedMatches(),
    totalErrors: 0,
  };
}

function libraryStats(): LibraryStats {
  const accounts = accountPayload().map(account => {
    const matches = fullMatches.filter(match => match.openID === account.openid);
    return {
      openid: account.openid,
      label: account.customName || (account.nick && account.tag ? `${account.nick}#${account.tag}` : account.nick || account.openid),
      matchCount: matches.length,
      videoCount: matches.reduce((sum, match) => sum + match.videos.length, 0),
      sourceBytes: 1024 * 1024 * matches.length,
      sourcePath: account.path,
      parseError: null,
    };
  });
  return {
    sourceBytes: 4 * 1024 * 1024,
    libraryDbBytes: 768 * 1024,
    assetCacheBytes: 512 * 1024,
    logBytes: 18 * 1024,
    videosBytes: fullMatches.reduce((sum, match) => sum + match.videos.reduce((n, v) => n + v.video_size, 0), 0),
    missingVideosBytes: 0,
    totalVideos: fullMatches.reduce((sum, match) => sum + match.videos.length, 0),
    missingVideos: 0,
    totalAccounts: accounts.length,
    accounts,
    recentScans: [{
      id: 'debug-scan-1',
      trigger: 'browser_debug',
      status: 'ok',
      startedAt: now - 12_000,
      finishedAt: now - 7_000,
      durationMs: 5000,
      matchesSeen: fullMatches.length,
      videosSeen: fullMatches.reduce((sum, match) => sum + match.videos.length, 0),
      eventsSeen: 2,
      errorsSeen: 0,
      message: 'browser debug fixture',
    }],
    assetKinds: [
      { kind: 'hero_image', count: 2, bytes: 64 * 1024 },
      { kind: 'map_image', count: 2, bytes: 128 * 1024 },
      { kind: 'game_mode_icon', count: 1, bytes: 12 * 1024 },
    ],
  };
}

function startMockBootEvents(): void {
  window.setTimeout(() => emitMockEvent('wui://phase', { phase: 'scanning' }), 20);
  window.setTimeout(() => emitMockEvent('wui://account_started', { current: 1, total: 2 }), 45);
  window.setTimeout(() => emitMockEvent('wui://account_loaded', { current: 1, total: 2 }), 80);
  window.setTimeout(() => emitMockEvent('wui://account_loaded', { current: 2, total: 2 }), 120);
  window.setTimeout(() => emitMockEvent('wui://scrape_summary', { matches: fullMatches.length }), 150);
  window.setTimeout(() => emitMockEvent('wui://phase', { phase: 'loading_view' }), 180);
}

async function mockInvoke<T>(cmd: string, args?: InvokeArgs): Promise<T> {
  await new Promise(resolve => window.setTimeout(resolve, 30));
  switch (cmd) {
    case 'scan_shell':
      startMockBootEvents();
      return deepClone({
        accounts: accountPayload(),
        dir: 'D:\\WonderfulUIDebug\\WonderfulDb',
        totalErrors: 0,
      }) as T;
    case 'scan_all':
    case 'load_library':
    case 'scrape_library':
      return deepClone(loadResult()) as T;
    case 'get_match_rounds': {
      const matchId = args?.matchId;
      const match = fullMatches.find(item => item.matches_id === matchId);
      if (!match) throw new Error(`debug match not found: ${String(matchId)}`);
      return deepClone(match) as T;
    }
    case 'cache_asset':
      return String(args?.url ?? '') as T;
    case 'cache_assets': {
      const entries = Array.isArray(args?.entries) ? args.entries as Array<{ url?: unknown }> : [];
      const result: Record<string, string> = {};
      for (const entry of entries) {
        if (typeof entry.url === 'string') result[entry.url] = entry.url;
      }
      return result as T;
    }
    case 'save_account_order': {
      const next = Array.isArray(args?.openids) ? args.openids.filter((id): id is string => typeof id === 'string') : [];
      if (next.length > 0) accountOrder = next;
      return undefined as T;
    }
    case 'aclos_status':
      // In browser debug, fake "ACLOS is here with accounts" so the
      // dashboard is exercised. Pass ?debug=1&onboarding=1 in the URL to
      // exercise the first-run screen instead.
      if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('onboarding') === '1') {
        return deepClone({
          dir: 'D:\\WonderfulUIDebug\\WonderfulDb (missing)',
          dirExists: false,
          hasAccounts: false,
        }) as T;
      }
      return deepClone({
        dir: 'D:\\WonderfulUIDebug\\WonderfulDb',
        dirExists: true,
        hasAccounts: true,
      }) as T;
    case 'rename_account': {
      const openid = typeof args?.openid === 'string' ? args.openid : '';
      const customName = typeof args?.customName === 'string' ? args.customName.trim() : '';
      if (openid) {
        if (customName) customNames.set(openid, customName);
        else customNames.delete(openid);
      }
      return undefined as T;
    }
    case 'get_log_status':
      return deepClone({
        logDir: 'D:\\WonderfulUIDebug\\logs',
        logPath: 'D:\\WonderfulUIDebug\\logs\\wonderful-ui.log',
        size: 18 * 1024,
        modifiedMs: now,
        maxBytes: 2 * 1024 * 1024,
        latestText: [
          '1781964600.120 [INFO] browser_debug: mock scan_shell',
          '1781964601.240 [INFO] browser_debug: mock load_library',
          '1781964602.360 [INFO] browser_debug: chart fixture ready',
        ].join('\n'),
      }) as T;
    case 'get_library_stats':
      return deepClone(libraryStats()) as T;
    case 'play_video':
    case 'reveal_in_explorer':
    case 'reveal_logs_dir':
    case 'log_event':
      console.info(`[WonderfulUI debug] ${cmd}`, args ?? {});
      return undefined as T;
    default:
      throw new Error(`Unhandled browser debug command: ${cmd}`);
  }
}

export async function invoke<T>(cmd: string, args?: InvokeArgs): Promise<T> {
  if (isBrowserDebugRuntime) return mockInvoke<T>(cmd, args);
  return tauriInvoke<T>(cmd, args);
}

export function convertFileSrc(path: string): string {
  if (isBrowserDebugRuntime) return path;
  return tauriConvertFileSrc(path);
}

export async function listen<T>(event: string, handler: Listener<T>): Promise<UnlistenFn> {
  if (!isBrowserDebugRuntime) return tauriListen<T>(event, handler);
  const listeners = mockEventListeners.get(event) ?? new Set<Listener<unknown>>();
  listeners.add(handler as Listener<unknown>);
  mockEventListeners.set(event, listeners);
  return () => {
    listeners.delete(handler as Listener<unknown>);
    if (listeners.size === 0) mockEventListeners.delete(event);
  };
}

if (isBrowserDebugRuntime) {
  window.__WUI_DEBUG__ = {
    enabled: true,
    mode: 'browser',
    emit: emitMockEvent,
    getLibrary: () => deepClone(loadResult()),
  };
  document.documentElement.dataset.wuiRuntime = 'browser-debug';
  console.info('[WonderfulUI] Browser debug runtime enabled');
}
