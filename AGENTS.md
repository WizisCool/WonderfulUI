# AGENTS.md

This is the high-priority entry file for agents working in WonderfulUI. Keep it short enough to read every time. Detailed reference material lives in `docs/`.

## Working Rules

### Think Before Coding

- State assumptions explicitly when they matter.
- If multiple interpretations exist, surface them before editing.
- Prefer the simplest change that satisfies the request.
- Ask only when a reasonable assumption would be risky.

### Simplicity First

- No speculative features.
- No abstractions for one-off code.
- No unrelated refactors.
- No broad "cleanup" while solving a narrow task.
- Every changed line should trace to the user's request.

### Surgical Changes

- Match existing style, even if you would design it differently.
- Touch only the files needed for the task.
- Remove imports, variables, or helpers made unused by your own change.
- Do not remove pre-existing dead code unless asked.
- The worktree may be dirty. Never revert changes you did not make.

### Goal-Driven Execution

For multi-step work, state a brief plan with verification:

```text
1. Step -> verify: check
2. Step -> verify: check
3. Step -> verify: check
```

Loop until the requested outcome is implemented and verified, or until a real blocker is identified.

## WonderfulUI Purpose

WonderfulUI is an offline parser and desktop GUI for ACLOS Tencent "无畏时刻" highlights. It lets users browse Valorant highlight metadata and local videos without launching Valorant, WeGame, Riot Client, or Vanguard.

## Hard Constraints

These are non-negotiable.

1. **不要破坏本地的游戏客户端。** Do not modify, replace, or delete files under:
   - `D:\Tencent Games\VALORANT\`
   - `D:\Riot Games\`
   - `C:\Riot Games\`
   - any game install path
2. **不要触发 ACE / Vanguard 反作弊。**
   - Do not start, inject into, or attach to `VALORANT-Win64-Shipping.exe`, `RiotClientServices.exe`, `RiotClientUx.exe`, `vgc.exe`, `vgk.sys`, or related processes.
   - Do not call `OpenProcess`, `ReadProcessMemory`, `WriteProcessMemory`, or `CreateRemoteThread` across those processes.
   - Do not write DLLs, INI files, configs, or tools into game or anti-cheat directories.
   - Do not actively connect to Riot official servers or third-party anti-cheat services.
3. **只读 ACLOS 本地缓存。** This project reads `WonderfulDb`; it does not write, modify, or repair ACLOS files.
4. **解析器纯只读。** Parser code must not call `fs.writeFile`, `truncate`, `rename`, or intentional timestamp-changing operations on `WonderfulDb`.
5. **GUI 不自动启动游戏。** Do not call `LaunchURI` or commands that open Riot Client / VALORANT. Opening a local `*.mp4` through the system default player is allowed.

Violating any item above is out of scope, even if it seems convenient.

## Locked Project Scope

- Parser target: `%USERPROFILE%\AppData\Roaming\ACLOS\WonderfulDb\`.
- Highlight file: `WonderfulDb\<account_id>`.
- Optional snapshot file: `WonderfulDb\snapshot<account_id>`.
- Locked ACLOS version: `2.15.3.449`.
- Schema file: `packages/parser/src/schema/_acl-source/eventDefine.js` (also `packages/parser/src/model.ts` for the parsed subset).
- Out of scope this iteration: `WeGameWonderfulDb`, IndexedDB, `blob_storage`, video export.
- Future ACLOS schema changes require a new `schema/vX_Y_Z.ts` or updated `_acl-source` files, not edits to the locked schema.

## Portability Contract

Production code must not hard-code user-specific paths.

- Derive default `WonderfulDb` from `process.env.USERPROFILE ?? process.env.HOME`.
- CLI commands accept explicit DB paths.
- GUI lets the user choose a directory and remembers it per user.
- Video paths are displayed and opened as ACLOS wrote them; do not rewrite NAS or local paths.
- Windows only is acceptable because ACLOS is Windows-only.

## Current Architecture

- Tauri 2 desktop shell.
- Rust parser runs in-process inside Tauri.
- Frontend is Vite + native TypeScript / DOM APIs.
- TS parser remains for CLI and Bun tests.
- SQLite library lives at `%LOCALAPPDATA%\wonderful-ui\library.db` with **WAL mode** for concurrent reads during writes.
- WonderfulDb is read only by `src-tauri/src/library/scraper.rs` as a source adapter; Tauri commands must not directly parse WonderfulDb files.
- The scraper also writes a deduped normalized event index into SQLite `events`. Keep raw match JSON as the replay/audit source; the SQL event index is for fast lookup, migration, and future library features.
- Account drag order and manual display names are WonderfulUI-local preferences stored in SQLite `account_preferences`; never write them back to `snapshot<openid>` or WonderfulDb.
- GUI calls `scan_all(dir?: string)` / `scrape_library(dir?: string, trigger?: string, mode?: "incremental" | "full")` to refresh the SQLite library, then receives parsed match JSON from the library view. Startup uses incremental scan; the top-right refresh button uses the user's saved scan mode from the settings modal (`增量扫描` / `全量扫描`). The bulk payload is **rounds-stripped** (see `strip_match_rounds`) to keep IPC small.
- Round / clip / event data is fetched on demand via the `get_match_rounds(openid, match_id)` Tauri command, which reads the full match JSON from SQLite.
- No parser sidecar executable is part of the current architecture.
- **Account scraping is parallelized** with `rayon`: account files are decrypted and parsed in parallel, then written to SQLite sequentially within per-account `BEGIN IMMEDIATE` / `COMMIT` transactions.
- **Match list uses DOM virtual scrolling** (`app.ts`): rows are `position: absolute` with `transform: translateY()`, a `.vlist-spacer` sets scrollable height, and a rAF-batched scroll handler rebuilds only the visible slice. `ROW_HEIGHT = 104` (96 px card + 8 px gap).
- **CSS GPU compositing**: `filter: brightness()` replaced with `::after` overlays, `backdrop-filter: blur()` removed, progress bar uses `transform: scaleX()` / `translateX()` instead of `width`/`left`, ECharts uses `renderer: 'canvas'`.
- **Event markers use Canvas rendering** when count > 20 (`CANVAS_MARKER_THRESHOLD` in `player-event-markers.ts`), reducing GPU composited layers from 50+ to 1. DOM path preserved for <= 20 markers.
- Tooltips and floating overlays use `packages/gui/src/floating.ts` (`@floating-ui/dom`), a shared positioning utility with cursor-aware alignment and edge flips. The global `.tooltip` element lives on `document.body` with a `.floating-arrow` indicator. Event markers on the progress bar detect track space and flip to bottom placement when needed.

More detail: `docs/ARCHITECTURE.md`.

## Kill-Point Events (2026-06-20)

`videos[i].rounds[].round_clips[].clip_events[]` carries one kill/death event per row. Parsed by both the TS and Rust parsers (TS: `packages/parser/src/model.ts:EventItem`; Rust: `src-tauri/src/parser/model.rs:EventItem`).

- `event_type` observed: `"kill"` (击杀集锦 / 高光时刻) and `"death"` (死亡集锦).
- All time and duration fields are milliseconds, but event timestamp semantics are state-specific. `击杀集锦` / `死亡集锦` montage events use `event_sTime` directly as the video timestamp. Moment videos (三杀时刻 / 四杀时刻 / etc.) use `clip_sTime + event_sTime`.
- There is no universal `max(round_sTime, clip_sTime) + event_sTime` formula. It double-counts observed montage events.
- `event_ext` carries rich Valorant shot metadata (`KillerPlayerName`, `KilledPlayerName`, `AgentName`, `WeaponSkinName`, `GetShotRolePart` 0=body/1=head/2=leg, `KillerIsMe`, `KilledIsMe`, `AssistNum`).
- Visible UI events must pass the shared event state machine (`packages/gui/src/event-state-machine.ts`, mirrored by `src-tauri/src/library/events.rs`): `EventName=Shot`, `EventTime` inside the match window, `AgentName` matching the current match agent, killer/victim names present, local-player flags present, shot part present, and video/event type compatible.
- Incomplete but shot-like rows are **quarantined**, not displayed. Unsupported or contradictory rows are **rejected**. Neither category may produce event-list rows or progress-bar markers.
- ACLOS records the same wall-clock kill event under multiple highlight videos for one match (e.g. an event appears in both 击杀集锦 and 三杀时刻). The event list dedupes accepted visible events on `(EventTime, victim)` for kills and `(EventTime, killer)` for deaths in `flattenMatchEvents`. Do not dedupe inside a single video — that data is already clean.
- If the dedup identity name is missing, do not merge solely by `EventTime` second. Fall back to a composite key using normalized names, weapon, and primary video-time bucket so unrelated same-second rows are preserved.
- ACLOS highlights can include the **whole team's** kills (all marked `KillerIsMe=1`). The state machine requires explicit local flags for visible rows, but per-match K/D shown in any UI must still come from `m.stats.*`, not from the event count. The list modal uses stats for the header counts and shows events as a playback index.
- Event playback uses a separate `seekMs`; under the state machine it equals the accepted state's exact video timestamp. `flattenMatchEvents` keeps the best playable duplicate: kills prefer `击杀集锦`, deaths prefer `死亡集锦`.
- Event row click and progress-bar dot click both apply a 2 s pre-roll (`EVENT_PREROLL_MS` in `event-time.ts`, via `playbackSeekMsForVideo`). The player seeks to `event_time - 2 s` (clamped >= 0) so the user sees the kill/death happen instead of the post-frame. Dot positions on the bar stay at the exact event time for visual reference.
- Weapon skin paths like `LugerPistol_Ashen_PrimaryAsset.Default__LugerPistol_Ashen_PrimaryAsset_C` are normalised in `packages/gui/src/weapons.ts`. Weapon codes are mapped by `WEAPON_CN`; skin Chinese names come from the committed local dump `packages/gui/src/generated/valorant-skins.zh-CN.ts`, refreshed with `bun run update:skins`. Runtime GUI code must not fetch Valorant-API.

## Reference Docs

- `docs/ACLOS_FORMAT.md` - WonderfulDb paths, format notes, snapshot nicknames, parser field semantics, rounds/clips/events.
- `docs/ARCHITECTURE.md` - runtime shape, Tauri commands, scaling plan, dev/test workflow, repo layout.
- `docs/FRONTEND_CONVENTIONS.md` - stable DOM rendering, account sentinel, match/detail layout, asset cache, player rules, fonts/icons, event interaction flow.
- `docs/AGENT_WORKFLOW.md` - standard agent loops for features, bug fixes, refactors, optional PRs, manual checks, and GitHub Actions releases.
- `DESIGN.md` - product visual system and UI constraints.
- `PRODUCT.md` - product intent and user-facing behavior.

Before changing parser behavior, read `docs/ACLOS_FORMAT.md`.
Before changing app structure or build workflow, read `docs/ARCHITECTURE.md`.
Before changing GUI layout, DOM refresh, CSS, icons, player, or tooltips, read `docs/FRONTEND_CONVENTIONS.md` plus `DESIGN.md`.
Before preparing an external PR, manual GitHub check, or release, read `docs/AGENT_WORKFLOW.md` plus `VERSIONING.md`.

## Development Workflow

Iteration loop:

```bash
bunx tauri dev
# or
bun run dev
```

- Frontend changes use Vite HMR, usually 1-2 seconds.
- Small Rust changes rebuild and relaunch Tauri, usually 3-10 seconds after warmup.
- Config or dependency changes require restarting `tauri dev`.

Release loop:

```bash
bunx tauri build
# or
bun run build
```

Use release builds only when validating shipment or installer behavior.

## Verification Commands

Run the smallest relevant set:

```bash
# TS parser unit tests
bun test packages/parser

# Rust parser unit tests
cargo test --release --manifest-path src-tauri/Cargo.toml --lib

# GUI unit tests
bun test packages/gui

# TS parser CLI sanity
bun run packages/parser/cli.ts scan 4807045517549591240
```

For doc-only changes, at minimum verify Markdown links and review `git diff`.

## Highest-Risk Pitfalls

- ACLOS can hold `WonderfulDb` open while writing; torn reads are possible if ACLOS is running.
- Keep direct WonderfulDb reads isolated to `library::scraper`; command handlers and GUI-facing load paths should go through SQLite.
- Incremental scan skips only unchanged accounts with no previous parse error; full scan is available from the refresh-button mode setting and as a direct settings-modal maintenance action.
- `snapshot<openid>` is optional and must not block highlight loading.
- `ALL_ACCOUNTS = '__all__'` is a synthetic sentinel, not a real account.
- Frontend uses a stable DOM skeleton; do not rebuild all of `#app` for normal state changes.
- Component-owned global listeners must be disposed when their owner leaves the DOM.
- Match videos group by `video_type`, not by array position or duration.
- User-facing hero/map/mode labels should come from `career.*` when available.
- Rust `VideoItem.video_is_processing` must serialize as `video_isProcessing`.
- Date range end dates are inclusive through `23:59:59.999` local time.
- Icons come from lucide; do not use Unicode symbol glyphs for controls.
- Chinese UI labels must use MiSans / `--font-sans`, not JetBrains Mono.
- Built-in video player lives in `#player-host`, outside `#app`.
- Player z-index (1200) is above event modal z-index (1100) so the list modal stays visible behind the player when the user clicks a row.
- Event-list modal dedup happens in `flattenMatchEvents` (TS), not in the parser — the parser faithfully returns what ACLOS wrote; the UI collapses duplicates for the user's per-match view after the event state machine accepts visible rows. The dedup key normalizes player names (strips `#tag`, folds case) and buckets `EventTime` to the second for tolerance. Events missing required state-machine evidence are quarantined and are not deduped into UI rows.
- `KillerIsMe=1` is unreliable in ACLOS highlight videos (often marks the whole team's kills as "me"). Never derive a per-match kill/death count from the event list — use `m.stats.*` instead. Visible kill rows require `KillerIsMe=1` and `KilledIsMe=0`; visible death rows require `KilledIsMe=1` and `KillerIsMe=0`; missing flags quarantine the row. **The filtered event count is still not a reliable K/D tally**.
- **Cross-match event filtering:** ACLOS highlight videos (especially 击杀集锦) can stitch kills from multiple matches. The shared state machine requires `event_ext.AgentName` to be present and match `m.agent.agent_name`; missing or mismatching agent evidence prevents UI exposure. This is a heuristic — if the same agent was played in multiple matches, cross-match events with the same agent name may slip through.
- **Snapshot achievements** (MVP/SVP badge + filter) come from `snapshot<openid>`, not the main WonderfulDb file. Coverage is partial (early ACLOS builds didn't write `match`-type records). The badge silently hides when data is missing. **Never aggregate** snapshot data — only filter by it.
- **Virtual scroll layout**: match rows are `position: absolute` siblings of `.vlist-spacer` inside `.match-list` (`position: relative`). Do not nest rows inside a separate wrapper — it pushes them below the spacer. `ROW_HEIGHT` (104) must account for card `min-height` (96) + visual gap (8). Changing `.match-row` padding or `min-height` requires adjusting `ROW_HEIGHT`.

Details for these pitfalls are in `docs/ACLOS_FORMAT.md` and `docs/FRONTEND_CONVENTIONS.md`.

## Documentation Maintenance

- Keep `AGENTS.md` as the short entry point.
- Add agent execution, optional PR, manual check, and release workflow facts to `docs/AGENT_WORKFLOW.md`.
- Add durable parser facts to `docs/ACLOS_FORMAT.md`.
- Add architecture, workflow, or performance facts to `docs/ARCHITECTURE.md`.
- Add GUI implementation conventions to `docs/FRONTEND_CONVENTIONS.md`.
- If a note is not needed by most future agents before editing, keep it out of `AGENTS.md` and link to it instead.
