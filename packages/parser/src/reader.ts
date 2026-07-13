/**
 * Reader: parse a WonderfulDb payload.
 *
 * Two entry points:
 *   - `parseWonderfulDbBuffer(buf, openid)`: pure, takes the raw file bytes
 *     (the ASCII hex text, as-is from disk). Works in any JS runtime.
 *   - `readWonderfulDbText(hexText, openid)`: legacy convenience that takes
 *     a hex string instead of bytes. Same thing under the hood.
 *
 * `parseSnapshotDbBuffer` is the matching entry for the per-account
 * `snapshot<openid>` file (same AES scheme, different top-level key,
 * `key_snapshot_list<openid>`). It only surfaces the player's own
 * `ss_nick` / `ss_nick_id` — anything else is dropped.
 *
 * File IO is intentionally NOT in this module — see `reader-file.ts` for the
 * Bun/Node-specific `readWonderfulDbFile` helper used by the CLI.
 */

import { hexToBytes } from './decoder.ts';
import { decryptWonderfulDbBuffer } from './crypto.ts';
import type { MatchRecord, MatchMap, MatchStats, Agent, VideoItem, EventItem, RoundClip, RoundHonor, RoundItem, WonderfulDbFile, AccountSnapshot, SnapshotAchievement } from './model.ts';

export class WonderfulDbError extends Error {
  constructor(message: string) { super(message); this.name = 'WonderfulDbError'; }
}

function asString(v: unknown, ctx: string): string {
  if (typeof v !== 'string') throw new WonderfulDbError(`${ctx}: expected string, got ${typeof v}`);
  return v;
}
function asNumber(v: unknown, ctx: string): number {
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new WonderfulDbError(`${ctx}: expected number, got ${typeof v} ${JSON.stringify(v)}`);
  }
  return n;
}
function asBool(v: unknown, ctx: string): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v === 'true' || v === '1';
  throw new WonderfulDbError(`${ctx}: expected bool, got ${typeof v}`);
}

function parseMap(v: unknown): MatchMap {
  if (v == null || typeof v !== 'object') return { map_id: '' };
  const o = v as Record<string, unknown>;
  return {
    map_id: typeof o.map_id === 'string' ? o.map_id : '',
    map_name: typeof o.map_name === 'string' ? o.map_name : undefined,
    map_image: typeof o.map_image === 'string' ? o.map_image : undefined,
  };
}

function parseAgent(v: unknown): Agent {
  if (v == null || typeof v !== 'object') return { agent_id: '', agent_name: '' };
  const o = v as Record<string, unknown>;
  return {
    agent_id: typeof o.agent_id === 'string' ? o.agent_id : '',
    agent_name: typeof o.agent_name === 'string' ? o.agent_name : '',
  };
}

function parseStats(v: unknown): MatchStats {
  const o = (v ?? {}) as Record<string, unknown>;
  return {
    kills: asNumber(o.kills ?? 0, 'stats.kills'),
    assists: asNumber(o.assists ?? 0, 'stats.assists'),
    deaths: asNumber(o.deaths ?? 0, 'stats.deaths'),
    score: asNumber(o.score ?? 0, 'stats.score'),
    has_won: asBool(o.has_won ?? false, 'stats.has_won'),
    mode_name: typeof o.mode_name === 'string' ? o.mode_name : '',
    rounds_won: asNumber(o.rounds_won ?? 0, 'stats.rounds_won'),
    rounds_lost: asNumber(o.rounds_lost ?? 0, 'stats.rounds_lost'),
    game_level: typeof o.game_level === 'string' ? o.game_level : '',
  };
}

function parseVideo(v: unknown): VideoItem {
  const o = (v ?? {}) as Record<string, unknown>;
  return {
    video_id: typeof o.video_id === 'string' ? o.video_id : '',
    video_isProcessing: typeof o.video_isProcessing === 'boolean' ? o.video_isProcessing : undefined,
    video_src: typeof o.video_src === 'string' ? o.video_src : '',
    video_duration: asNumber(o.video_duration ?? 0, 'video.video_duration'),
    video_fps: asNumber(o.video_fps ?? 0, 'video.video_fps'),
    video_resolution: typeof o.video_resolution === 'string' ? o.video_resolution : '',
    video_name: typeof o.video_name === 'string' ? o.video_name : '',
    video_poster: typeof o.video_poster === 'string' ? o.video_poster : '',
    video_ext: typeof o.video_ext === 'string' ? o.video_ext : '',
    video_time: asNumber(o.video_time ?? 0, 'video.video_time'),
    video_size: asNumber(o.video_size ?? 0, 'video.video_size'),
    video_level: typeof o.video_level === 'string' ? o.video_level : '',
    video_type: typeof o.video_type === 'string' ? o.video_type : '',
    video_hash: typeof o.video_hash === 'string' ? o.video_hash : '',
    cover_hash: typeof o.cover_hash === 'string' ? o.cover_hash : '',
    template_id: typeof o.template_id === 'string' ? o.template_id : '',
    clips_count: typeof o.clips_count === 'number' ? o.clips_count : undefined,
    is_upload: typeof o.is_upload === 'boolean' ? o.is_upload : undefined,
    rounds: Array.isArray(o.rounds) ? o.rounds.map(parseRound) : undefined,
  };
}

function parseEvent(v: unknown): EventItem {
  const o = (v ?? {}) as Record<string, unknown>;
  return {
    event_id: typeof o.event_id === 'string' ? o.event_id : '',
    event_sTime: asNumber(o.event_sTime ?? 0, 'event.event_sTime'),
    event_type: typeof o.event_type === 'string' ? o.event_type : '',
    event_ext: typeof o.event_ext === 'object' && o.event_ext != null ? o.event_ext as Record<string, unknown> : undefined,
  };
}

function parseRoundClip(v: unknown): RoundClip {
  const o = (v ?? {}) as Record<string, unknown>;
  return {
    clip_id: typeof o.clip_id === 'string' ? o.clip_id : '',
    clip_duration: asNumber(o.clip_duration ?? 0, 'roundClip.clip_duration'),
    clip_sTime: asNumber(o.clip_sTime ?? 0, 'roundClip.clip_sTime'),
    clip_events: Array.isArray(o.clip_events) ? o.clip_events.map(parseEvent) : [],
  };
}

function parseRoundHonor(v: unknown): RoundHonor {
  const o = (v ?? {}) as Record<string, unknown>;
  return {
    honor_id: typeof o.honor_id === 'string' ? o.honor_id : '',
    honor_name: typeof o.honor_name === 'string' ? o.honor_name : '',
    honor_time: typeof o.honor_time === 'string' ? o.honor_time : '',
  };
}

function parseRound(v: unknown): RoundItem {
  const o = (v ?? {}) as Record<string, unknown>;
  return {
    round_id: typeof o.round_id === 'string' ? o.round_id : String(o.round_id ?? ''),
    round_duration: asNumber(o.round_duration ?? 0, 'round.round_duration'),
    round_sTime: asNumber(o.round_sTime ?? 0, 'round.round_sTime'),
    round_clips: Array.isArray(o.round_clips) ? o.round_clips.map(parseRoundClip) : [],
    round_honors: Array.isArray(o.round_honors) ? o.round_honors.map(parseRoundHonor) : [],
  };
}

function parseMatch(v: unknown): MatchRecord {
  if (v == null || typeof v !== 'object') {
    throw new WonderfulDbError('match: expected object');
  }
  const o = v as Record<string, unknown>;
  const known = new Set([
    'matches_id', 'matches_time', 'map', 'agent', 'stats', 'openID', 'mode',
    'minRoundId', 'gameStartTime', 'gameEndTime', 'videos', 'career',
  ]);
  const extras: Record<string, unknown> = {};
  for (const k of Object.keys(o)) {
    if (!known.has(k)) extras[k] = o[k];
  }
  return {
    matches_id: asString(o.matches_id ?? '', 'matches_id'),
    matches_time: asNumber(o.matches_time ?? 0, 'matches_time'),
    map: parseMap(o.map),
    agent: parseAgent(o.agent),
    stats: parseStats(o.stats),
    openID: typeof o.openID === 'string' ? o.openID : '',
    mode: typeof o.mode === 'string' ? o.mode : '',
    minRoundId: asNumber(o.minRoundId ?? 0, 'minRoundId'),
    gameStartTime: typeof o.gameStartTime === 'string' ? o.gameStartTime : '',
    gameEndTime: typeof o.gameEndTime === 'string' ? o.gameEndTime : '',
    videos: Array.isArray(o.videos) ? o.videos.map(parseVideo) : [],
    career: typeof o.career === 'object' && o.career != null ? o.career as Record<string, unknown> : undefined,
    extras: Object.keys(extras).length ? extras : undefined,
  };
}

/** Internal: given a decrypted JSON text, build the WonderfulDbFile shape. */
function buildFromJson(json: string, openid: string): WonderfulDbFile {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    throw new WonderfulDbError(`decrypted plaintext is not valid JSON: ${(e as Error).message}`);
  }
  if (raw == null || typeof raw !== 'object') {
    throw new WonderfulDbError('decrypted JSON: expected top-level object');
  }
  // The known top-level key is "key_wonderful_list_<openid>" but the file
  // could in theory carry other keys; we just pick the wonderful-list one.
  const expectedKey = `key_wonderful_list_${openid}`;
  let list = raw[expectedKey];
  if (list == null) {
    // fall back: pick the first key whose value is an array
    for (const k of Object.keys(raw)) {
      if (Array.isArray(raw[k])) { list = raw[k]; break; }
    }
  }
  if (!Array.isArray(list)) {
    throw new WonderfulDbError(`no match list found (expected key "${expectedKey}")`);
  }
  const matches = list.map((m, i) => {
    try { return parseMatch(m); }
    catch (e) {
      throw new WonderfulDbError(`match[${i}]: ${(e as Error).message}`);
    }
  });
  return { key: expectedKey, matches, raw };
}

/**
 * Parse a WonderfulDb file from its raw bytes. `buf` is the file content as
 * read from disk — pure ASCII hex (0-9, a-f). Works in any JS runtime.
 */
export async function parseWonderfulDbBuffer(buf: Uint8Array, openid: string): Promise<WonderfulDbFile> {
  const hexText = new TextDecoder().decode(buf);
  const cipher = hexToBytes(hexText);
  const json = await decryptWonderfulDbBuffer(cipher, openid);
  return buildFromJson(json, openid);
}

/** Convenience: parse from a hex string (same as parseWonderfulDbBuffer but accepts a string). */
export async function readWonderfulDbText(hexText: string, openid: string): Promise<WonderfulDbFile> {
  const cipher = hexToBytes(hexText);
  const json = await decryptWonderfulDbBuffer(cipher, openid);
  return buildFromJson(json, openid);
}

/**
 * Parse a `snapshot<openid>` file and lift out:
 *   1. The player's display name + #tag from the first record that has them.
 *   2. Per-match MVP/SVP achievements from `ss_type === "match"` records.
 *
 * The snapshot file uses the same AES-256-CBC scheme as the wonderful-list
 * file; only the top-level key prefix is different.
 *
 * Returns `{ nick: undefined, tag: undefined }` (never throws) when the
 * payload is missing, empty, corrupt, or has no `ss_nick` / `ss_nick_id`
 * — ACLOS writes an empty 48-byte container when there's nothing to save,
 * and we'd rather show the openid than block the whole account.
 *
 * Achievements are sourced from `snapshot.ss_achieve_type` (only `"mvp"` /
 * `"svp"`). Early ACLOS versions did not write `match`-type records, so
 * historical matches may not carry achievement data. The GUI must silently
 * skip matches without an entry.
 */
export async function parseSnapshotDbBuffer(buf: Uint8Array, openid: string): Promise<AccountSnapshot> {
  const empty: AccountSnapshot = {};
  if (buf.length === 0) return empty;
  let cipher: Uint8Array;
  try {
    const hexText = new TextDecoder().decode(buf);
    cipher = hexToBytes(hexText);
  } catch {
    return empty;
  }
  if (cipher.length === 0) return empty;
  let json: string;
  try {
    json = await decryptWonderfulDbBuffer(cipher, openid);
  } catch {
    return empty;
  }
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(json);
  } catch {
    return empty;
  }
  if (raw == null || typeof raw !== 'object') return empty;
  // Known key prefix is `key_snapshot_list<openid>` (no separator — note
  // the missing underscore vs the wonderful-list key). Fall back to "first
  // array value" so we stay robust against ACLOS renaming the prefix.
  const expectedKey = `key_snapshot_list${openid}`;
  const list = (raw[expectedKey] ?? Object.values(raw).find(v => Array.isArray(v))) as unknown;
  if (!Array.isArray(list)) return empty;

  // nick/tag: prefer chronologically latest record (matches_time / ss_time)
  // so renames win over first-wins stale data. GUI also has a Rust-side
  // ACLOS LocalStorage/log fallback when snapshot has no nick at all.
  let nick: string | undefined;
  let tag: string | undefined;
  let nickTime = Number.NEGATIVE_INFINITY;
  const achievements: SnapshotAchievement[] = [];

  for (const rec of list) {
    if (rec == null || typeof rec !== 'object') continue;
    const snap = (rec as Record<string, unknown>).snapshot;
    if (snap == null || typeof snap !== 'object') continue;
    const s = snap as Record<string, unknown>;
    const recObj = rec as Record<string, unknown>;
    const recTimeRaw = recObj.matches_time ?? s.ss_time;
    const recTime = typeof recTimeRaw === 'number' ? recTimeRaw : Number(recTimeRaw) || 0;
    const n = typeof s.ss_nick === 'string' && s.ss_nick.trim() ? s.ss_nick.trim() : undefined;
    const t = typeof s.ss_nick_id === 'string' && s.ss_nick_id.trim() ? s.ss_nick_id.trim() : undefined;
    if ((n || t) && recTime >= nickTime) {
      nickTime = recTime;
      if (n) nick = n;
      if (t) tag = t;
    }
    // MVP/SVP: only collect pure achievement records (ss_type === "match")
    const achv = typeof s.ss_achieve_type === 'string' ? s.ss_achieve_type : '';
    if (achv !== 'mvp' && achv !== 'svp') continue;
    const mid = (rec as Record<string, unknown>).matches_id;
    if (typeof mid !== 'string' || !mid) continue;
    const typeStr = typeof s.ss_type_str === 'string' ? s.ss_type_str : achv.toUpperCase();
    achievements.push({ matches_id: mid, type: achv as 'mvp' | 'svp', typeStr });
  }

  const result: AccountSnapshot = {};
  if (nick !== undefined) result.nick = nick;
  if (tag !== undefined) result.tag = tag;
  if (achievements.length) result.achievements = achievements;
  return result;
}
