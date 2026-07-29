/**
 * Canonical Valorant labels and display assets.
 *
 * Known maps and agents always resolve through the generated registry so the
 * same entity cannot change name or CDN URL between ACLOS records. Raw
 * `career.*` values are retained only as an unknown-entity fallback. The
 * registry is generated from the documented sources in
 * `tools/update-valorant-metadata.ts`; never add per-account/sample overrides.
 */

import type { MatchRecord } from '@wonderful-ui/parser';
import {
  VALORANT_AGENTS,
  VALORANT_GAME_MODES,
  VALORANT_MAPS,
  type ValorantAgentMetadata,
  type ValorantGameModeMetadata,
  type ValorantMapMetadata,
} from './generated/valorant-metadata.zh-CN.ts';

export type AssetKind = 'hero_image' | 'map_image' | 'game_mode_icon';

export interface RemoteAssetEntry {
  kind: AssetKind;
  url: string;
}

export type MapAsset = ValorantMapMetadata;
export type AgentAsset = ValorantAgentMetadata;
export type GameModeAsset = ValorantGameModeMetadata;

const MAP_BY_KEY = new Map<string, MapAsset>();
const AGENT_BY_ID = new Map<string, AgentAsset>();
const AGENT_BY_NAME = new Map<string, AgentAsset>();
const GAME_MODE_BY_KEY = new Map<string, GameModeAsset>();

for (const map of VALORANT_MAPS) {
  for (const key of mapLookupKeys(map.mapUrl)) MAP_BY_KEY.set(key, map);
}

for (const agent of VALORANT_AGENTS) {
  AGENT_BY_ID.set(agent.uuid.toLowerCase(), agent);
  AGENT_BY_NAME.set(normalizeAgentName(agent.en), agent);
  AGENT_BY_NAME.set(normalizeAgentName(agent.developerName), agent);
}

for (const mode of VALORANT_GAME_MODES) {
  GAME_MODE_BY_KEY.set(normalizeText(mode.en), mode);
  GAME_MODE_BY_KEY.set(normalizeText(mode.cn), mode);
  GAME_MODE_BY_KEY.set(modePathKey(mode.assetPath), mode);
}

// ─── Pure lookups ──────────────────────────────────────────────────────────

export function mapLookupKeys(mapId: string): string[] {
  if (!mapId.trim()) return [];
  const normalized = mapId
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .toLowerCase();
  const parts = normalized.split('/').filter(Boolean);
  const last = parts[parts.length - 1] ?? '';
  return last && last !== normalized ? [normalized, last] : [normalized];
}

export function lookupMapAsset(mapId: string): MapAsset | undefined {
  for (const key of mapLookupKeys(mapId)) {
    const hit = MAP_BY_KEY.get(key);
    if (hit) return hit;
  }
  return undefined;
}

export function lookupAgentAsset(
  agentName: string,
  agentId = '',
): AgentAsset | undefined {
  const byId = AGENT_BY_ID.get(agentId.trim().toLowerCase());
  if (byId) return byId;
  const nameKey = normalizeAgentName(agentName);
  return nameKey ? AGENT_BY_NAME.get(nameKey) : undefined;
}

export function lookupGameModeAsset(match: MatchRecord): GameModeAsset | undefined {
  const candidates = [
    modePathKey(match.stats?.mode_name ?? ''),
    normalizeText(match.mode ?? ''),
    normalizeText(stringValue(match.career?.game_mode) ?? ''),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const hit = GAME_MODE_BY_KEY.get(candidate);
    if (hit) return hit;
  }
  return undefined;
}

function normalizeAgentName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_:/-]+/g, '');
}

function modePathKey(value: string): string {
  const basename = value
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    ?.split('.')[0]
    ?? '';
  return normalizeText(basename)
    .replace(/(?:_?primaryasset|_?dataassetdesktop|_?c)$/g, '');
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function localAssetValue(value: unknown): string | undefined {
  const source = stringValue(value);
  return source && (source.startsWith('/') || source.startsWith('data:'))
    ? source
    : undefined;
}

function matchMapAsset(match: MatchRecord): MapAsset | undefined {
  return lookupMapAsset(match.map?.map_id ?? '');
}

function matchAgentAsset(match: MatchRecord): AgentAsset | undefined {
  return lookupAgentAsset(
    match.agent?.agent_name ?? '',
    match.agent?.agent_id ?? '',
  );
}

// ─── Unified match resolution (single entry points for UI + cache) ─────────

/** Known map registry → unknown career/map label → final path segment. */
export function resolveMatchMapLabel(match: MatchRecord): string {
  const canonical = matchMapAsset(match);
  if (canonical) return canonical.cn;
  const mapId = match.map?.map_id ?? '';
  return stringValue(match.career?.map_name)
    ?? stringValue(match.map?.map_name)
    ?? mapId.replace(/\\/g, '/').split('/').filter(Boolean).pop()
    ?? mapId;
}

/** Known agent registry → unknown career label → raw agent name. */
export function resolveMatchAgentLabel(match: MatchRecord): string {
  const canonical = matchAgentAsset(match);
  if (canonical) return canonical.cn;
  return stringValue(match.career?.hero_name) ?? match.agent?.agent_name ?? '';
}

export function resolveMatchMapImage(match: MatchRecord): string | undefined {
  return resolveMatchAssetUrl(match, 'map_image');
}

export function resolveMatchHeroImage(match: MatchRecord): string | undefined {
  return resolveMatchAssetUrl(match, 'hero_image');
}

export function resolveMatchModeIcon(match: MatchRecord): string | undefined {
  return resolveMatchAssetUrl(match, 'game_mode_icon');
}

/**
 * Single URL dispatcher for display and cache collection.
 *
 * Canonical bundled paths win for known IDs or names. Unknown entities may use
 * an already-local/data source, but HTTP(S) fields are deliberately ignored:
 * the highlight browser must not require runtime access to an overseas CDN.
 */
export function resolveMatchAssetUrl(
  match: MatchRecord,
  kind: AssetKind,
): string | undefined {
  if (kind === 'map_image') {
    return matchMapAsset(match)?.image
      ?? localAssetValue(match.career?.map_image)
      ?? localAssetValue(match.map?.map_image);
  }
  if (kind === 'hero_image') {
    return matchAgentAsset(match)?.image ?? localAssetValue(match.career?.hero_image);
  }
  return lookupGameModeAsset(match)?.image ?? localAssetValue(match.career?.game_mode_icon);
}

/**
 * Backward-compatible cache collector. Canonical assets are bundled paths and
 * therefore produce no network work; unknown HTTP(S) source fields are never
 * returned by the resolver.
 */
export function collectMatchAssetEntries(matches: MatchRecord[]): RemoteAssetEntry[] {
  const seen = new Set<string>();
  const out: RemoteAssetEntry[] = [];
  const kinds: AssetKind[] = ['map_image', 'hero_image', 'game_mode_icon'];
  for (const match of matches) {
    for (const kind of kinds) {
      const url = resolveMatchAssetUrl(match, kind);
      if (!url || !/^https?:\/\//i.test(url) || seen.has(url)) continue;
      seen.add(url);
      out.push({ kind, url });
    }
  }
  return out;
}

/**
 * Turn a bundled or legacy cached asset into an `<img src>` value.
 * HTTP(S) input is never returned to the WebView; `failed` hides broken
 * images after onerror.
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
  if (/^https?:\/\//i.test(url)) return null;
  return url;
}

/** Match + kind → final `<img src>` for UI components. */
export function resolveMatchAssetSrc(
  match: MatchRecord,
  kind: AssetKind,
  assetPathCache: Map<string, string>,
  convertFileSrc: (path: string) => string,
  failed = false,
): string | null {
  return resolveAssetDisplaySrc(
    resolveMatchAssetUrl(match, kind),
    assetPathCache,
    convertFileSrc,
    failed,
  );
}
