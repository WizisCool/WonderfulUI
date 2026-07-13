# ACLOS Data Format Notes

Last organized: 2026-06-22.

This document holds ACLOS/WonderfulDb facts that are useful for parser and GUI work.

## Safety Boundary

- `WonderfulDb` is treated as a read-only local cache. The project reads it only when ACLOS is not actively writing it.
- Parser code must not call `fs.writeFile`, `truncate`, `rename`, or any syscall that intentionally changes `WonderfulDb` metadata.
- Do not modify ACLOS, Riot, WeGame, VALORANT, Vanguard, or game install files while researching this format.

## Locked Scope

- Parser target: `%USERPROFILE%\AppData\Roaming\ACLOS\WonderfulDb\`.
- Highlight file: `WonderfulDb\<account_id>`.
- Snapshot file: `WonderfulDb\snapshot<account_id>`.
- Locked ACLOS version: `2.15.3.449`.
- Schema file: `packages/parser/src/schema/_acl-source/eventDefine.js` (also `packages/parser/src/model.ts` for the parsed subset).
- Out of scope for this iteration: `WeGameWonderfulDb`, IndexedDB, `blob_storage`, and video export.
- Future ACLOS schemas should add a new `schema/vX_Y_Z.ts`; do not rewrite the locked schema in place.

The snapshot file is optional. Missing, empty, corrupt, or undecryptable snapshots must never block highlight loading.

## Portability Contract

Production code must not hard-code user-specific paths **or per-machine identity**.

- Default `WonderfulDb` directory is derived from `process.env.USERPROFILE ?? process.env.HOME`.
- CLI `scan` and `show` accept an explicit `<path-to-db>` argument.
- GUI lets the user choose a directory and remembers the last choice per user, not globally.
- ACLOS is Windows-only, so this app targets Windows.
- Non-default ACLOS layouts require the user to choose the directory manually.
- Video paths are stored by ACLOS inside the JSON. The app displays and opens them as-is; it does not rewrite `Z:\...` or local paths.
- Do **not** commit openid → nick maps, special cases for one PC’s accounts, or
  absolute media roots as product logic. Nickname resolution must stay format-
  driven (snapshot fields, generic ACLOS cache/log heuristics, user rename).

## Known Local Paths

These are based on the default ACLOS installation.

| Purpose | Path pattern |
|---|---|
| Video / cover media | `Z:\无畏时刻\wonderfulVideos<account_id>\<highlight_id>\*.mp4` / `*.jpeg` |
| Main metadata DB | `%AppData%\Roaming\ACLOS\WonderfulDb\<account_id>` |
| WeGame mirror DB | `%AppData%\Roaming\ACLOS\WeGameWonderfulDb\<account_id>` |
| ACLOS install | `<ACLOS install dir>\ACLOS\` |
| asar package | `<ACLOS install dir>\ACLOS\Launcher\resources\app.asar` |
| ACLOS debug log | `%AppData%\Roaming\ACLOS\logs\highlight.log` |

Known account IDs below are **optional local fixtures** for developer machines
that happen to have those WonderfulDb files (tests skip if absent). They are
**not** product constants and must not be special-cased in release code:

- `4807045517549591240`
- `14121192131852595386`
- `13794749312275947089`
- `1228584785010313960` - legacy, video folder removed

## Format Findings

- `WonderfulDb` files are ASCII hex text using only `0-9` and `a-f`.
- The parser hex-decodes the file before decrypting and parsing the inner payload.
- A 10,002,688 character file becomes 5,001,344 bytes after hex decode.
- Highlight and snapshot files use the same AES-256-CBC scheme with the account openid as part of key derivation.
- ACLOS is Electron + Node. `highlight.log` mostly contains `ignore 645 EventID` noise; useful messages often appear under `wonderful-log` / `send cross msg` JSON.
- `C:\ProgramData\Riot Games\Metadata\valorant.live\valorant.live.db` is unrelated to highlights.

## Snapshot Nicknames

Player display names come **primarily** from `snapshot<openid>`, not from the wonderful-list file.

- Top-level snapshot key shape: `key_snapshot_list<openid>`.
- Useful fields:
  - `snapshot.ss_nick` - display name.
  - `snapshot.ss_nick_id` - tag / number.
- Nick/tag selection: prefer the record with the latest `matches_time` (fallback `ss_time`) that carries those fields — not first-wins — so renames surface correctly.
- Display format: `Nick#Tag` when both exist, otherwise `Nick`.
- If no nickname metadata is available after snapshot + fallback, GUI uses `未知账户#N`, where `N` is the 1-based rank among nameless accounts in the current scan.
- The raw openid remains available in account-row tooltip text.

Both TS and Rust snapshot parsers should return empty nickname metadata on corrupt hex, decrypt, or JSON errors.

### Account nick / #tag resolution (Rust GUI scraper)

`library/aclos_identity.rs` resolves display names **before** falling back to
`未知账户#N`. Paths are under `%APPDATA%\ACLOS\` only (read-only; never
Riot/Vanguard/game installs).

| Priority | Source | How |
|---|---|---|
| 1 (primary) | Chromium **Local Storage LevelDB** | Opened with pure-Rust `rusty-leveldb` (if LOCK held, copy dir to temp and open). Keys: `ACLOS_USER_ROLES_INFO` (JSON array of current roles on `app://aclos.val.qq.com`), `acloshighlight_user_<openid>` (often under `https://val.qq.com`). Values: `0x01`+UTF-8 JSON and/or `0x00`+UTF-16LE JSON. |
| 2 | `snapshot<openid>` | `ss_nick` / `ss_nick_id` (latest `matches_time`); **required second source** — LevelDB does **not** cover every WonderfulDb openid. Also **only** source for MVP/SVP. |
| 3 | Logs / raw IDB files | Text harvest; logs often use **masked** openids matched by prefix+suffix |

**Why snapshot cannot be removed as nick source:** LevelDB only stores roles ACLOS has written into Local Storage (current login + highlight user cache). WonderfulDb may list additional openid shells (empty or snapshot-only) with no `acloshighlight_user_*` row. Deleting snapshot nick merge would regress those accounts to openid / `未知账户#N`. MVP/SVP have no LevelDB equivalent.

Rules:

1. LevelDB wins over snapshot for nick/tag when both exist.
2. Placeholder nick `我` is ignored.
3. MVP/SVP still come **only** from snapshot (and snapshot file parse must remain).
4. No hard-coded openid→nick maps. No live `api.val.qq.com`.
5. If LevelDB + snapshot + logs all miss, UI shows openid / `未知账户#N`.

## Display Field Semantics

Prefer the ACLOS `career.*` strings for user-facing labels when present:

- Hero name: `career.hero_name`, else local EN→CN table (`packages/gui/src/utils/valorant-assets.ts`), else `m.agent.agent_name`.
- Map name: `career.map_name`, else local `map_id` table (Skirmish / Range / HURM included), else last path segment of `map_id`.
- Game mode: `career.game_mode`, fallback empty string.
- Hero avatar / map cover / mode icon: **only** via `packages/gui/src/utils/valorant-assets.ts`.
  - URL: `resolveMatchAssetUrl(match, kind)` (career → portable CDN table).
  - UI `<img src>`: `resolveMatchAssetSrc(match, kind, assetPathCache, convertFileSrc)`.
  - Cache batch: `collectMatchAssetEntries(matches)` → Tauri `cache_assets` (first visit remote, later disk).
- Do not hard-code map/hero CDN URLs in components; extend the tables in `valorant-assets.ts`.
- Team rounds: `stats.rounds_won` / `stats.rounds_lost`.
- Personal combat score: `stats.score`.
- Match duration: `gameStartTime` / `gameEndTime`.

Skirmish / Range / TDM matches often omit `career.*` entirely — without the local
asset table the UI would show raw `Skirmish_A` and English `Jett`. Keep
`valorant-assets.ts` portable (no machine openids); extend it when new map
path segments appear in ACLOS.

Do not use `agent.agent_id`, raw unmapped `map_id`, `stats.mode_name`, or `career.battle_id` as user-facing display labels.

## Video Semantics

- Montage videos are identified by `video_type` in `{ 击杀集锦, 死亡集锦 }`.
- Every other `video_type` is treated as a moment, such as 三杀时刻, 四杀时刻, 五杀时刻, or 进阶剪辑.
- Do not group videos by array position or duration; ACLOS can rotate order and duration thresholds drift.
- Video card quality chip uses `video_level`, not `video_resolution`.
- `video_resolution` can contain stray carriage returns, for example `"1440\rx1080\r"`.
- Known `video_level` values: `1 = 720p`, `3 = 1080p`.
- Rust `VideoItem.video_is_processing` must serialize to `video_isProcessing` for WebView IPC compatibility.

## Research Notes

- `app.asar` can contain minified or bytecode-like assets. Prefer targeted keyword search first; fall back to binary fingerprints only when needed.
- ACLOS can hold `WonderfulDb` open while running. If a parser read looks torn or inconsistent, check whether ACLOS is still writing.

## Rounds, Clips, and Events (observed 2026-06-19)

Each video in ACLOS carries kill/death event data under `videos[i].rounds[]` (see
`packages/parser/src/schema/_acl-source/eventDefine.js` for `VideoDetail` /
`RoundItem` / `RoundClip` / `EventItem`).

- **`RoundItem`**: `round_id` (number or string), `round_duration` (ms), `round_sTime` (ms offset in video), `round_clips[]`, `round_honors[]`.
- **`RoundClip`**: `clip_id`, `clip_duration` (ms), `clip_sTime` (ms offset within round), `clip_events[]`.
- **`EventItem`**: `event_id`, `event_sTime` (ms), `event_type` (`"kill"` | `"death"`), `event_ext` (JSON object).
- **Honors** (`round_honors`): `honor_name`, `honor_time` — occasional MVP/SVP markers.

### Event state and video timestamp model

Observed ACLOS 2.15.3.449 data does **not** have one safe timestamp formula
for every video type. The UI and SQLite event index use a shared state machine
instead of ad-hoc timestamp math.

| Visible state | Source video | Accepted event type | Video timestamp |
|---------------|--------------|---------------------|-----------------|
| `montage` | `击杀集锦` | `kill` | `event_sTime` |
| `montage` | `死亡集锦` | `death` | `event_sTime` |
| `moment` | other highlight types, e.g. 三杀时刻 | `kill` | `clip_sTime + event_sTime` |

The old `max(round_sTime, clip_sTime) + event_sTime` rule double-counts
observed montage rows. In local samples, `event_sTime` in montage videos is
already video-absolute. In short moment videos, multi-clip rows use
`clip_sTime + event_sTime`.

Only accepted visible states can produce event-list rows or progress-bar
markers. Shot-like rows with incomplete evidence are quarantined; unsupported
or contradictory rows are rejected.

### `event_ext` fields (observed)

`event_ext` carries rich Valorant shot metadata. Key fields:

- `EventName`: always `"Shot"` in observed data.
- `EventTime`: ISO-like local wall-clock, e.g. `"2026-06-08 20:01:14.523"`.
- `KillerPlayerName`, `KilledPlayerName`: display names.
- `AgentName`: the local player's agent at the time.
- `WeaponSkinName`: full weapon + skin class path, e.g. `LugerPistol_Ashen_PrimaryAsset.Default__LugerPistol_Ashen_PrimaryAsset_C`.
- `GetShotRolePart`: `0` = body, `1` = head, `2` = leg.
- `KillerIsMe`, `KilledIsMe`: `1` / `0`.
- `AssistNum`, `AssistInfos[]`: assist count and details.
- `ShooterRoleID`, `KilledRoleID`, `AgentPosition`, `GetShotRolePosition`: spatial data.

All `*_sTime` and `*_duration` fields use **milliseconds**.

### ACLOS data quirks (observed)

These are bugs/quirks in ACLOS's own data, not in the parser. The UI has to work around them.

1. **Same real kill recorded under multiple highlight videos.** A single kill
   (uniquely identified by `EventTime` + victim) can appear in both `击杀集锦`
   and `三杀时刻` videos of the same match — the data is byte-for-byte
   identical (same `KillerPlayerName`, `WeaponSkinName`, `BloodAfter`,
   `GetShotRolePart`, etc.). The GUI's event list dedupes on
   `(EventTime, victim)` for kills and `(EventTime, killer)` for deaths in
   `normalizeMatchEvents`. When duplicates exist, the GUI keeps the most
   playable occurrence. Kill rows prefer `击杀集锦` and death rows prefer
   `死亡集锦`, because those sources match user expectations for the per-match
   event list. If the matching montage candidate cannot be seeked within its
   own video duration, the GUI falls back to another playable duplicate. The
   parser itself does **not** dedupe — it faithfully returns what ACLOS wrote.
   When the dedup identity name is missing, normalization must not collapse
   all same-second rows together. It falls back to a composite key of type,
   normalized names, primary video-time bucket, and weapon so distinct events
   survive while cross-video duplicates still collapse.
2. **All highlight-video events are flagged `KillerIsMe=1`** regardless of
   whether the local player actually got the kill. A 击杀集锦 for a
   14-kill match can carry 70+ "kills" with `KillerIsMe=1`, but only 14
   truly belong to the local player. **Never** derive per-match K/D from
   the event count — use `m.stats.*` (which ACLOS populates correctly).
3. **Kill montages can stitch kills from multiple matches.** A single
   `击杀集锦` may carry `event_ext.AgentName` switching between Jett /
   Cypher / Breach within the same video — i.e. the highlight is
   cross-match. The local player's actual `agent` for the match is on
   `m.agent.agent_name`.
4. **`AssistNum > 0` on a `KillerIsMe=1` kill** is normal: it means "I got
   the killing blow with N other assists on the target". Not a duplicate
   and not a "fake kill" — count it as a real kill.
5. **Cross-match event filtering:** The visible-event state machine filters
   cross-match events by comparing `event_ext.AgentName` (the local player's
   agent at the event time) against `m.agent.agent_name` (the current match's
   agent). Missing or mismatching agent evidence prevents UI exposure in both
   the event list and progress-bar markers. This is a heuristic — if the same
   agent was played across multiple matches, cross-match events with the same
   agent name may not be caught.
6. **Normalization is strict at the UI boundary:** `event_type` and
   `AgentName` are trimmed / case-normalized before filtering. Visible rows
   require `EventName=Shot`, parseable `EventTime` inside the match window,
   player names, local-player flags, shot part, and a seekable timestamp.
   Invalid or missing fields quarantine the row instead of surfacing a
   confusing marker.

### Visible event state machine

The shared state machine lives in `packages/gui/src/utils/event-state-machine.ts`
and is mirrored by `src-tauri/src/library/events.rs` for the SQLite event
index.

Visible rows require all of the following:

- `event_type` normalizes to `kill` or `death`.
- `event_ext` is an object and `EventName` is `Shot`.
- `KillerPlayerName`, `KilledPlayerName`, `AgentName`, `EventTime`,
  `KillerIsMe`, `KilledIsMe`, and `GetShotRolePart` are present.
- `EventTime` parses as ACLOS local time and falls within the match window
  with a 30 second tolerance.
- `AgentName` matches `m.agent.agent_name` after trim/case normalization.
- Kill rows have `KillerIsMe=1` and `KilledIsMe=0`; death rows have
  `KilledIsMe=1` and `KillerIsMe=0`.
- The timestamp model for the video type yields a value within
  `video_duration`.

Rows that look like Valorant shot events but lack required evidence are
**quarantined**. They may be useful for future audits, but they must not
create event-list rows, event counts, or progress-bar dots. Rows that are
unsupported or contradictory are **rejected**.

### Local SQLite event index

The local library stores deduped normalized event rows in SQLite `events` during
scrape. This index is derived data for faster lookup, migration, and future
library features. The authoritative event source remains the full
`matches.raw_json` payload, because it preserves the original ACLOS rounds,
clips, video objects, and raw `event_ext`.

### IPC size note

`scan_all` strips `rounds` from every match before sending, so the initial
payload stays at ~50 KB / account. The GUI invokes
`get_match_rounds(openid, match_id)` on demand to fetch the full `rounds`
tree for a single match when the user opens it. The frontend mutates the
in-memory match in place (`v.rounds = fullV.rounds`) so subsequent
re-renders of the same match use the loaded data without re-invoking.

### Event playback seek behavior

The event list keeps two times:

- `timeMs` — the accepted state's exact video timestamp, used for
  sorting/display and progress-bar dot placement.
- `seekMs` — the timestamp used inside the selected video when opening the
  player.

For accepted events, `seekMs` equals `timeMs`. The player applies the
2 second pre-roll separately through `playbackSeekMsForVideo`, clamped to
zero. Rows whose timestamp cannot fit the video's duration are quarantined,
so the UI does not show dots that jump to unrelated moments.

### Weapon skin → Chinese name

`packages/gui/src/utils/weapons.ts` exports `weaponNameOnly(path)` /
`weaponLabel(path)` which strip the Unreal Engine class decoration
(`…/LugerPistol_Ashen_PrimaryAsset.Default__LugerPistol_Ashen_PrimaryAsset_C`)
and map the weapon code (`LugerPistol`, `RevolverPistol`, `AK`, `MP5`,
`BoltActionSniper`, etc.) to its Chinese name (`鬼魅`, `正义`, `狂徒`,
`骇灵`, `冥驹`, …). Weapon codes are resolved by longest known prefix, so
multi-part codes like `AssaultRifle_ACR` (幻影) and `AssaultRifle_Burst`
(獠犬) are not collapsed to the generic `AssaultRifle` fallback.

Skin names come from the committed local Valorant-API dump at
`packages/gui/src/utils/generated/valorant-skins.zh-CN.ts`, generated from
`https://valorant-api.com/v1/weapons/skins?language=zh-CN` by
`bun run update:skins`. The GUI must not fetch this API at runtime, so it
stays usable in offline / poor-network environments. Unknown skin codes
fall back to the cleaned English label. **Add new weapon codes to
`WEAPON_CN`; refresh the dump for new or renamed skin names.**

### Snapshot-derived achievement data (MVP/SVP badge)

The `snapshot<openid>` file carries per-match achievement records under
`ss_type === "match"` entries. The GUI consumes only two fields for a
diagonal corner ribbon on the match cover:

- `snapshot.ss_achieve_type` — `"mvp"` | `"svp"` | `""` (empty = skip)
- `snapshot.ss_type_str` — Chinese display label, used as tooltip
- `record.matches_id` — joins against `MatchRecord.matches_id`

**Source stability**: Achievements are written by ACLOS automatically
at end-of-match (not user-triggered). Early ACLOS builds (prior to the
`2.15.3.449` deltas that introduced `match`-type snapshot records) do
not populate this data — historical matches permanently lack it. The
snapshot schema may also change with ACLOS upgrades; the parser fails
silently (drops the account's achievement array) on any parse error.

**Guardrails (project-wide, non-negotiable)**:

1. **Silent when missing**: no fallback text, no "unknown" chip, no
   placeholder. A missing entry is visually absent.
2. **Never sort/aggregate/export** on snapshot-derived achievement
   fields. Coverage is partial.
3. **Filtering is allowed** via the "成就" category in the filter
   rail (MVP / SVP), but the user must understand partial coverage.
   Do not add snapshot fields to range or numeric filters.
4. **Snapshot fields must never** be used for per-account statistics,
   win-rate calculations, or any cross-match aggregation.

**Coverage**: In observed fixtures, 2 of 3 active accounts (4807, 1412)
have match-type achievement records. The third (1379) has an empty
snapshot file (no achievements). The legacy 1228 account also has an
empty snapshot file.
