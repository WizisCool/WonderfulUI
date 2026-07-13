/**
 * Unified Valorant display-asset resolution for WonderfulUI.
 *
 * Strategy (offline-friendly high-light browser):
 * 1. Prefer ACLOS `career.*` text/URLs when present (parsed from local WonderfulDb).
 * 2. Else fall back to a portable lookup table (map_id / agent_name → CN + CDN URL).
 * 3. Remote images are fetched once via Tauri `cache_assets` and served from disk cache.
 *
 * All map/hero/mode image **URLs** for a match should go through the helpers below
 * so cache collection and UI stay in one place. No machine-local openids.
 */

import type { MatchRecord } from '@wonderful-ui/parser';

const GTIMG_MAP = 'https://game.gtimg.cn/images/val/agamezlk/map';
const GTIMG_HERO = 'https://game.gtimg.cn/images/val/agamezlk/headicon';

export type AssetKind = 'hero_image' | 'map_image' | 'game_mode_icon';

export interface RemoteAssetEntry {
  kind: AssetKind;
  url: string;
}

export interface MapAsset {
  cn: string;
  image: string;
}

export interface AgentAsset {
  cn: string;
  image: string;
}

// ─── Lookup tables ─────────────────────────────────────────────────────────

const MAP_BY_KEY: Record<string, MapAsset> = {
  ascent: { cn: '亚海悬城', image: `${GTIMG_MAP}/ascent/cover.PNG` },
  bonsai: { cn: '霓虹町', image: `${GTIMG_MAP}/split/cover.PNG` },
  canyon: { cn: '裂变峡谷', image: `${GTIMG_MAP}/fracture/cover.PNG` },
  duality: { cn: '源工重镇', image: `${GTIMG_MAP}/bind/cover.PNG` },
  foxtrot: { cn: '微风岛屿', image: `${GTIMG_MAP}/breeze/cover.PNG` },
  infinity: { cn: '幽邃地窟', image: `${GTIMG_MAP}/abyss/cover.PNG` },
  jam: { cn: '莲华古城', image: `${GTIMG_MAP}/lotus/cover.PNG` },
  juliett: { cn: '日落之城', image: `${GTIMG_MAP}/sunset/cover.PNG` },
  pitt: { cn: '深海明珠', image: `${GTIMG_MAP}/pearl/cover.PNG` },
  plummet: { cn: '天枢云阙', image: `${GTIMG_MAP}/summit/cover.PNG` },
  port: { cn: '森寒冬港', image: `${GTIMG_MAP}/icebox/cover.PNG` },
  rook: { cn: '盐海矿镇', image: `${GTIMG_MAP}/corrode/cover.PNG` },
  triad: { cn: '隐世修所', image: `${GTIMG_MAP}/haven/cover.PNG` },

  // 国服斗牛（Skirmish A–E → 1–5）
  skirmish_a: { cn: '斗牛 1', image: `${GTIMG_MAP}/skirmish_a/cover.PNG` },
  skirmish_b: { cn: '斗牛 2', image: `${GTIMG_MAP}/skirmish_b/cover.PNG` },
  skirmish_c: { cn: '斗牛 3', image: `${GTIMG_MAP}/skirmish_c/cover.PNG` },
  skirmish_d: {
    cn: '斗牛 4',
    image:
      'https://media.valorant-api.com/maps/1c7555fc-4bc6-3b98-9674-789d47ef6c50/splash.png',
  },
  skirmish_e: {
    cn: '斗牛 5',
    image:
      'https://media.valorant-api.com/maps/4490f1d6-4818-bf5f-9b3a-9c9a8dbb52ed/splash.png',
  },

  range: {
    cn: '训练场',
    image:
      'https://media.valorant-api.com/maps/ee613ee9-28b7-4beb-9666-08db13bb2244/splash.png',
  },
  rangev2: {
    cn: '训练场',
    image:
      'https://media.valorant-api.com/maps/5914d1e0-40c4-cfdd-6b88-eba06347686c/splash.png',
  },
  npev2: {
    cn: '基础训练',
    image:
      'https://media.valorant-api.com/maps/ee613ee9-28b7-4beb-9666-08db13bb2244/splash.png',
  },

  // 团队死斗 / 特殊模式地图 — 国服官方中文名（valorant-api zh-CN / OP.GG）
  // District→商街, Kasbah→古城, Piazza→小镇, Drift→渔市, Glitch→乱次元
  hurm_alley: { cn: '商街', image: `${GTIMG_MAP}/district/cover.PNG` },
  hurm_bowl: { cn: '古城', image: `${GTIMG_MAP}/kasbah/cover.PNG` },
  hurm_yard: { cn: '小镇', image: `${GTIMG_MAP}/piazza/cover.PNG` },
  hurm_helix: { cn: '渔市', image: `${GTIMG_MAP}/drift/cover.PNG` },
  hurm_hightide: { cn: '乱次元', image: `${GTIMG_MAP}/glitch/cover.PNG` },
  district: { cn: '商街', image: `${GTIMG_MAP}/district/cover.PNG` },
  kasbah: { cn: '古城', image: `${GTIMG_MAP}/kasbah/cover.PNG` },
  piazza: { cn: '小镇', image: `${GTIMG_MAP}/piazza/cover.PNG` },
  drift: { cn: '渔市', image: `${GTIMG_MAP}/drift/cover.PNG` },
  glitch: { cn: '乱次元', image: `${GTIMG_MAP}/glitch/cover.PNG` },
};

const AGENT_BY_EN: Record<string, AgentAsset> = {
  Breach: { cn: '铁臂', image: `${GTIMG_HERO}/01.png` },
  Jett: { cn: '捷风', image: `${GTIMG_HERO}/02.png` },
  Raze: { cn: '雷兹', image: `${GTIMG_HERO}/03.png` },
  Omen: { cn: '幽影', image: `${GTIMG_HERO}/04.png` },
  Brimstone: { cn: '炼狱', image: `${GTIMG_HERO}/05.png` },
  Phoenix: { cn: '不死鸟', image: `${GTIMG_HERO}/06.png` },
  Sage: { cn: '贤者', image: `${GTIMG_HERO}/07.png` },
  Sova: { cn: '猎枭', image: `${GTIMG_HERO}/08.png` },
  Viper: { cn: '蝰蛇', image: `${GTIMG_HERO}/09.png` },
  Cypher: { cn: '零', image: `${GTIMG_HERO}/10.png` },
  Reyna: { cn: '芮娜', image: `${GTIMG_HERO}/11.png` },
  Killjoy: {
    cn: '奇乐',
    image:
      'https://media.valorant-api.com/agents/1e58de9c-4950-5125-93e9-a0aee9f98746/displayicon.png',
  },
  Skye: { cn: '斯凯', image: `${GTIMG_HERO}/13.png` },
  Yoru: {
    cn: '夜露',
    image:
      'https://media.valorant-api.com/agents/7f94d92c-4234-0a36-9646-3a87eb8b5c89/displayicon.png',
  },
  Astra: {
    cn: '星礈',
    image:
      'https://media.valorant-api.com/agents/41fb69c1-4189-7b37-f117-bcaf1e96f1bf/displayicon.png',
  },
  'KAY/O': {
    cn: 'K/O',
    image:
      'https://media.valorant-api.com/agents/601dbbe7-43ce-be57-2a40-4abd24953621/displayicon.png',
  },
  Chamber: {
    cn: '尚勃勒',
    image:
      'https://media.valorant-api.com/agents/22697a3d-45bf-8dd7-4fec-84a9e28c69d7/displayicon.png',
  },
  Neon: { cn: '霓虹', image: `${GTIMG_HERO}/18.png` },
  Fade: { cn: '黑梦', image: `${GTIMG_HERO}/19.png` },
  Harbor: {
    cn: '海神',
    image:
      'https://media.valorant-api.com/agents/95b78ed7-4637-86d9-7e41-71ba8c293152/displayicon.png',
  },
  Gekko: {
    cn: '盖可',
    image:
      'https://media.valorant-api.com/agents/e370fa57-4757-3604-3648-499e1f642d3f/displayicon.png',
  },
  Deadlock: {
    cn: '钢锁',
    image:
      'https://media.valorant-api.com/agents/cc8b64c8-4b25-4ff9-6e7f-37b4da43d235/displayicon.png',
  },
  Iso: { cn: '壹决', image: `${GTIMG_HERO}/23.png` },
  Clove: {
    cn: '暮蝶',
    image:
      'https://media.valorant-api.com/agents/1dbf2edd-4729-0984-3115-daa5eed44993/displayicon.png',
  },
  Vyse: { cn: '维斯', image: `${GTIMG_HERO}/25.png` },
  Tejo: {
    cn: '钛狐',
    image:
      'https://media.valorant-api.com/agents/b444168c-4e35-8076-db47-ef9bf368f384/displayicon.png',
  },
  Waylay: {
    cn: '幻棱',
    image:
      'https://media.valorant-api.com/agents/df1cb487-4902-002e-5c17-d28e83e78588/displayicon.png',
  },
};

// ─── Pure lookups ──────────────────────────────────────────────────────────

export function mapLookupKeys(mapId: string): string[] {
  if (!mapId) return [];
  const norm = mapId.replace(/\\/g, '/');
  const parts = norm.split('/').filter(Boolean);
  const last = (parts[parts.length - 1] ?? '').toLowerCase();
  const keys = new Set<string>();
  if (last) keys.add(last);
  if (parts.length >= 2) {
    const parent = parts[parts.length - 2]!.toLowerCase();
    if (parent.startsWith('hurm_')) keys.add(parent);
  }
  if (last === 'range' || last === 'rangev2') {
    keys.add('range');
    keys.add('rangev2');
  }
  return [...keys];
}

export function lookupMapAsset(mapId: string): MapAsset | undefined {
  for (const k of mapLookupKeys(mapId)) {
    const hit = MAP_BY_KEY[k];
    if (hit) return hit;
  }
  return undefined;
}

export function lookupAgentAsset(agentName: string): AgentAsset | undefined {
  if (!agentName) return undefined;
  const direct = AGENT_BY_EN[agentName];
  if (direct) return direct;
  const lower = agentName.toLowerCase();
  for (const [k, v] of Object.entries(AGENT_BY_EN)) {
    if (k.toLowerCase() === lower) return v;
  }
  if (lower === 'kayo' || lower === 'kay/o') return AGENT_BY_EN['KAY/O'];
  return undefined;
}

// ─── Unified match resolution (single entry points for UI + cache) ─────────

/** User-facing map label: career → table → last path segment. */
export function resolveMatchMapLabel(m: MatchRecord): string {
  const career = (m.career?.map_name as string | undefined)?.trim();
  if (career) return career;
  const mapId = m.map?.map_id ?? '';
  return lookupMapAsset(mapId)?.cn ?? mapId.split('/').pop() ?? mapId;
}

/** User-facing agent label: career → table → English agent_name. */
export function resolveMatchAgentLabel(m: MatchRecord): string {
  const career = (m.career?.hero_name as string | undefined)?.trim();
  if (career) return career;
  const en = m.agent?.agent_name ?? '';
  return lookupAgentAsset(en)?.cn || en;
}

/** Map cover remote URL: career → table. */
export function resolveMatchMapImage(m: MatchRecord): string | undefined {
  return resolveMatchAssetUrl(m, 'map_image');
}

/** Hero portrait remote URL: career → table. */
export function resolveMatchHeroImage(m: MatchRecord): string | undefined {
  return resolveMatchAssetUrl(m, 'hero_image');
}

/** Mode icon remote URL (career only; no table). */
export function resolveMatchModeIcon(m: MatchRecord): string | undefined {
  return resolveMatchAssetUrl(m, 'game_mode_icon');
}

/**
 * Single URL dispatcher for all match display images.
 * career.* → portable CDN table (map/hero) → undefined.
 * Cache collection and UI both go through this path.
 */
export function resolveMatchAssetUrl(
  m: MatchRecord,
  kind: AssetKind,
): string | undefined {
  if (kind === 'map_image') {
    const career = (m.career?.map_image as string | undefined)?.trim();
    if (career) return career;
    return lookupMapAsset(m.map?.map_id ?? '')?.image;
  }
  if (kind === 'hero_image') {
    const career = (m.career?.hero_image as string | undefined)?.trim();
    if (career) return career;
    return lookupAgentAsset(m.agent?.agent_name ?? '')?.image;
  }
  // game_mode_icon — career only
  const url = m.career?.game_mode_icon;
  return typeof url === 'string' && url.trim() ? url.trim() : undefined;
}

/**
 * Collect unique remote image URLs for Tauri `cache_assets`.
 * Same resolveMatchAssetUrl path as the UI — never invent URLs here.
 */
export function collectMatchAssetEntries(matches: MatchRecord[]): RemoteAssetEntry[] {
  const seen = new Set<string>();
  const out: RemoteAssetEntry[] = [];
  const kinds: AssetKind[] = ['map_image', 'hero_image', 'game_mode_icon'];
  for (const m of matches) {
    for (const kind of kinds) {
      const url = resolveMatchAssetUrl(m, kind);
      if (!url || !/^https?:\/\//i.test(url) || seen.has(url)) continue;
      seen.add(url);
      out.push({ kind, url });
    }
  }
  return out;
}

/**
 * Turn a remote (or already-local) asset URL into an `<img src>` value.
 * - Prefer disk cache → convertFileSrc(localPath)
 * - Else use remote URL so first paint works while cache_assets runs
 * - `failed` hides broken images after onerror
 */
export function resolveAssetDisplaySrc(
  url: string | undefined,
  assetPathCache: Map<string, string>,
  convertFileSrc: (path: string) => string,
  failed = false,
): string | null {
  if (failed || !url) return null;
  const cached = assetPathCache.get(url);
  if (cached) return convertFileSrc(cached);
  if (url.startsWith('/') || url.startsWith('data:')) return url;
  if (/^https?:\/\//i.test(url)) return url;
  return url;
}

/**
 * UI-only entry point: match + kind → final `<img src>`.
 * Components should call this instead of wiring URL resolve + cache lookup themselves.
 */
export function resolveMatchAssetSrc(
  m: MatchRecord,
  kind: AssetKind,
  assetPathCache: Map<string, string>,
  convertFileSrc: (path: string) => string,
  failed = false,
): string | null {
  return resolveAssetDisplaySrc(
    resolveMatchAssetUrl(m, kind),
    assetPathCache,
    convertFileSrc,
    failed,
  );
}
