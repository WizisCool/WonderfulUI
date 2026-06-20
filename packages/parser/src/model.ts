/**
 * TypeScript model for ACLOS WonderfulDb records.
 *
 * Schema source: packages/parser/src/schema/_acl-source/eventDefine.js
 * Observed runtime fields are richer than the JS class defaults (extra keys
 * like openID, mode, gameStartTime, gameEndTime, career are present in the
 * actual JSON). We model the common ones; unknown fields are preserved as
 * `extras` so future readers can see them.
 */

export interface MatchMap {
  map_id: string;             // e.g. "/Game/Maps/Jam/Jam"
  map_name?: string;          // human name "亚海悬城" / "Ascent" (from career)
  map_image?: string;
}

export interface Agent {
  agent_id: string;           // UUID
  agent_name: string;         // e.g. "Cypher"
}

export interface MatchStats {
  kills: number;
  assists: number;
  deaths: number;
  score: number;
  has_won: boolean;
  mode_name: string;          // internal path
  rounds_won: number;
  rounds_lost: number;
  game_level: string;         // e.g. "141"
}

export interface VideoItem {
  video_id: string;
  video_isProcessing?: boolean;
  video_src: string;          // local mp4 path
  video_duration: number;     // milliseconds
  video_fps: number;
  video_resolution: string;   // e.g. "1920x1080"
  video_name: string;
  video_poster: string;       // local cover path
  video_ext: string;
  video_time: number;         // unix ms
  video_size: number;         // bytes
  video_level: string;
  video_type: string;
  video_hash: string;
  cover_hash: string;
  template_id: string;
  clips_count?: number;
  is_upload?: boolean;
  rounds?: RoundItem[];
}

export interface EventItem {
  event_id: string;
  event_sTime: number;
  event_type: string;           // "kill" | "death"
  event_ext?: Record<string, unknown>;
}

export interface RoundClip {
  clip_id: string;
  clip_duration: number;
  clip_sTime: number;
  clip_events: EventItem[];
}

export interface RoundHonor {
  honor_id: string;
  honor_name: string;
  honor_time: string;
}

export interface RoundItem {
  round_id: string;
  round_duration: number;
  round_sTime: number;
  round_clips: RoundClip[];
  round_honors: RoundHonor[];
}

export interface MatchRecord {
  matches_id: string;
  matches_time: number;       // unix ms
  map: MatchMap;
  agent: Agent;
  stats: MatchStats;
  openID: string;
  mode: string;               // "competitive" / "unrated" / etc.
  minRoundId: number;
  gameStartTime: string;
  gameEndTime: string;
  videos: VideoItem[];
  career?: Record<string, unknown>;
  /** Anything we don't explicitly model. */
  extras?: Record<string, unknown>;
}

export interface WonderfulDbFile {
  /** Top-level key in the decrypted JSON, e.g. "key_wonderful_list_4807045517549591240". */
  key: string;
  matches: MatchRecord[];
  /** The raw top-level object, so callers can see if there are other keys. */
  raw: Record<string, unknown>;
}

/** Subset of ACLOS `SnapshotItem` that the GUI cares about. */
export interface SnapshotRecord {
  /** Snapshot sub-tree, e.g. `snapshot.ss_nick = "超雄小猫咪"`. */
  snapshot?: {
    /** Player's in-game display name. */
    ss_nick?: string;
    /** Riot-style short ID / 编号 (e.g. "13949"). */
    ss_nick_id?: string;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

/**
 * Per-match achievement extracted from `snapshot<openid>` (only MVP/SVP).
 *
 * ACLOS writes one `SnapshotAchievement` per match where `ss_type === "match"`
 * and `ss_achieve_type` is `"mvp"` or `"svp"`. Early ACLOS versions did not
 * write `match`-type snapshot records, so coverage has historical gaps.
 *
 * **Guardrails**: never use for filtering, sorting, or statistics — snapshot
 * is a partial data source with missing records for historical matches. The
 * GUI must silently skip matches without an entry.
 */
export interface SnapshotAchievement {
  matches_id: string;
  /** "mvp" | "svp" — filtered to only these two values by the parser. */
  type: 'mvp' | 'svp';
  /** Chinese display label, e.g. "MVP" / "SVP" / "五杀". Used as tooltip. */
  typeStr: string;
}

/**
 * Player display-name metadata lifted out of `snapshot<openid>` so the GUI
 * can show `Smoky#46211` instead of the raw openid. Both fields are
 * independently optional: ACLOS may write the file with just a nick, just
 * a tag, or (when there's nothing to save) as a 48-byte empty container.
 */
export interface AccountSnapshot {
  /** e.g. "超雄小猫咪" */
  nick?: string;
  /** e.g. "13949" — combine with nick as `<nick>#<tag>`. */
  tag?: string;
  /** Per-match MVP/SVP achievements. Undefined when no records are present. */
  achievements?: SnapshotAchievement[];
}
