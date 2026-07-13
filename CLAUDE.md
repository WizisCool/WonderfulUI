# CLAUDE.md

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

### Git / Remote

- Local commits are fine when the user asks for a commit, or when a release step clearly requires one.
- **Do not `git push` to `main` (or any remote) unless the user explicitly asks.**
  - "提交 / commit / 做好" alone is **not** permission to push.
  - Release wording ("发布 / 打 tag / 推送") counts only when it clearly includes publishing to the remote.
- Do not push tags, force-push, or amend published history unless explicitly requested.
- Prefer leaving the branch ahead of `origin` and reporting how to push, rather than pushing by default.
- Details: `docs/AGENT_WORKFLOW.md` § Git Workflow.

### No Machine-Local Hardcoding (release-grade)

WonderfulUI is a product for many Windows installs, not a one-PC script.

- **Never hard-code fixes that only apply to data on one machine** (a specific openid, nick, tag, match id, absolute path like `D:\...` / `Z:\...`, ACLOS install path, or maintainer username).
- Production logic must use **generic algorithms** (parse formats, env-derived defaults, user-chosen paths, optional empty fallbacks).
- Do not write `if openid == "…" { nick = "…" }` (or equivalent maps of real accounts) to “fix” bad labels on the developer’s PC.
- Optional **local fixture** openids in tests/docs are for *skip-if-missing* integration checks only; they must not drive release behavior or special-case UI.
- When debugging with real local WonderfulDb, keep findings in analysis/comments for humans; ship only portable code.

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

Production code must not hard-code user-specific paths **or identity**.

- Derive default `WonderfulDb` from `process.env.USERPROFILE ?? process.env.HOME`.
- CLI commands accept explicit DB paths.
- GUI lets the user choose a directory and remembers it per user.
- Video paths are displayed and opened as ACLOS wrote them; do not rewrite NAS or local paths.
- Account labels come from ACLOS Local Storage LevelDB role cache / snapshot / log heuristics / user rename — never from a committed list of the maintainer’s accounts.
- **Empty highlight shells:** accounts with **zero matches** are not kept in the library UI (and successful scrapes purge empty openids). WonderfulUI is a highlight browser, not an account directory of bare openids.
- Windows only is acceptable because ACLOS is Windows-only.

## Current Architecture

- Tauri 2 desktop shell.
- Rust parser runs in-process inside Tauri.
- **Frontend is Vue 3** (`<script setup lang="ts">` + `<style scoped>`) with **Pinia** state management and **vue-router** (`createMemoryHistory`).
- TS parser remains for CLI and Bun tests.
- **Vue component smoke tests** use **vitest** + `@vue/test-utils` + `happy-dom` (`.component.test.ts`), kept separate from the bun:test runner. Bun cannot process `.vue` SFC imports natively; vitest handles them through `@vitejs/plugin-vue`. Stores are injected via `createTestingPinia` with initial state — no separate store tests.
- SQLite library lives at `%LOCALAPPDATA%\wonderful-ui\library.db` with **WAL mode** for concurrent reads during writes.
- WonderfulDb is read only by `src-tauri/src/library/scraper.rs` as a source adapter; Tauri commands must not directly parse WonderfulDb files.
- The scraper also writes a deduped normalized event index into SQLite `events`. Keep raw match JSON as the replay/audit source; the SQL event index is for fast lookup, migration, and future library features.
- Account drag order and manual display names are WonderfulUI-local preferences stored in SQLite `account_preferences`; never write them back to `snapshot<openid>` or WonderfulDb.
- All Tauri `invoke()` calls go through **Pinia store actions** (6 stores: `account`, `filter`, `detail`, `player`, `settings`, `ui`). Components never call `invoke()` directly.
- GUI calls `scan_all(dir?: string)` / `scrape_library(dir?: string, trigger?: string, mode?: "incremental" | "full")` to refresh the SQLite library, then receives parsed match JSON from the library view. Startup uses incremental scan; the match-list header refresh button uses the user's saved scan mode from the settings modal (`增量扫描` / `全量扫描`). The bulk payload is **rounds-stripped** (see `strip_match_rounds`) to keep IPC small.
- Round / clip / event data is fetched on demand via the `get_match_rounds(openid, match_id)` Tauri command, which reads the full match JSON from SQLite.
- No parser sidecar executable is part of the current architecture.
- **Account scraping is parallelized** with `rayon`: account files are decrypted and parsed in parallel, then written to SQLite sequentially within per-account `BEGIN IMMEDIATE` / `COMMIT` transactions.
- **Match list uses DOM virtual scrolling** (`useVirtualScroll` composable): rows are `position: absolute` with `transform: translateY()`, a `.vlist-spacer` sets scrollable height, and a scroll handler computes the visible slice reactively from `scrollTop`. `ROW_HEIGHT = 104` (96 px card + 8 px gap).
- **CSS GPU compositing**: `filter: brightness()` replaced with `::after` overlays, `backdrop-filter: blur()` removed, progress bar uses `transform: scaleX()` / `translateX()` instead of `width`/`left`. All component styles use `<style scoped>`; only CSS custom properties, reset, fonts, and shared utilities remain in `assets/style.css`.
- **Settings charts use Apache ECharts via `vue-echarts`** (`packages/gui/src/charts/register.ts` + `AccountShareChart.vue`). Register chart types once in `register.ts`; build pure options in `library-stats.ts` (or future `charts/*-option.ts`); render with `<VChart autoresize />`. **Do not** call `echarts.init` / module-level chart singletons — Vue owns mount/unmount (tab `v-if` and modal close). Center totals stay as sibling DOM overlays, not series labels.
- **Event markers use DOM rendering only.** `CANVAS_MARKER_THRESHOLD` is set to `Infinity` in `player-event-markers.ts`, permanently disabling the canvas rendering path. The 4px-tall canvas clipped all dot rendering outside its bounds and produced visual inconsistencies vs DOM markers. If canvas mode is re-enabled (by lowering the threshold), the canvas CSS must be extended (e.g. `top: -45px; bottom: -30px`) and `renderCanvasMarkers` must derive `trackY` from CSS `top` offset, not `rect.height / 2`.
- Tooltips and floating overlays use `packages/gui/src/composables/useFloating.ts` (`@floating-ui/dom`), a shared positioning utility with cursor-aware alignment and edge flips. The global `.tooltip` element lives on `document.body` with a `.floating-arrow` indicator. **Tooltip wiring** is in `App.vue` via delegated `mouseover`/`mouseout`/`mousemove` listeners that read `[data-tip]` attributes and invoke the `useTooltip()` composable. Components set `data-tip` on their DOM elements; no custom directive or per-component binding is needed. **Do NOT create the tooltip element lazily** — it must be pre-created in `onMounted` so its first `computePosition` call reads correct `offsetWidth`/`offsetHeight`. Also force synchronous layout (`void el.offsetWidth`) after setting `textContent` and use `strategy: 'fixed'` in `computePosition` (the tooltip is `position: fixed` on body).
- **Pure logic files** live in `packages/gui/src/utils/` (event-state-machine, match-events, filters, weapons, player-state, etc.) — copied verbatim from the pre-Vue codebase with zero logic changes.
- **App layout** uses CSS Grid: `TopBar` (header), 4-column `.panes` (AccountSidebar / FilterRail / RouterView / DetailView). Player, settings, boot overlay, and toast are Teleported to body or `#player-host`.
- **AccountSidebar** has a fixed `.pane-foot` at the bottom with a settings button (gear icon + "设置") and app version (`vX.Y.Z`, from `packages/gui/src/utils/version.ts`). Settings modal includes an `关于` tab with version info.
- **Match-list header** (`HomeView` `.pane-head-right`) hosts the refresh/scan button; `TopBar` right side is intentionally empty. Both the sidebar settings button and the match-list refresh button use the same compact bordered style (24 px tall, matching the filter toggle).
- **Windows installer is NSIS-only**, customized via `src-tauri/installer.nsi` (a fork of the upstream `tauri-apps/tauri` tauri-bundler template). `tauri.conf.json` `bundle.windows.nsis.template` points at it; the sidecar files `src-tauri/utils.nsh` and `src-tauri/FileAssociation.nsh` must be kept alongside or `makensis` will fail. `installMode: perMachine` requires `RequestExecutionLevel admin` and a UAC prompt. The custom template only changes the uninstaller confirm page (adds one "保留本地用户配置" checkbox via `MUI_PAGE_CUSTOMFUNCTION_SHOW`); the install-side pages stay upstream-default. The custom cleanup path is `${WUI_DATA_DIR} = $LOCALAPPDATA\wonderful-ui` (hyphen, lowercase) — **not** the bundle id — because that's where the Rust code actually writes (`src-tauri/src/library/db.rs:12`, `app_log.rs:41`, `lib.rs:385`). When upgrading the upstream template, reapply the `; WUI:` marked changes in `installer.nsi`.
- **Bundle identifier is `app.local.wonderfului`** (was `local.wonderfului.app` until v0.1.3). The old id triggered Tauri 2's "ends with `.app`" warning and would conflict with macOS app bundles. Changing it is a one-line edit in `tauri.conf.json`; everything else uses `{{bundle_id}}` template substitution. **User impact**: existing users' WebView2 `localStorage` (volume, filters, scan mode) lives under `%LOCALAPPDATA%\<old-id>\EBWebView` and does not migrate — they re-set those prefs once on the first run after upgrade. Worth a one-liner in release notes when this changes again.

More detail: `docs/ARCHITECTURE.md`.

## Kill-Point Events (2026-06-22)

`videos[i].rounds[].round_clips[].clip_events[]` carries one kill/death event per row. Parsed by both the TS and Rust parsers (TS: `packages/parser/src/model.ts:EventItem`; Rust: `src-tauri/src/parser/model.rs:EventItem`).

- `event_type` observed: `"kill"` (击杀集锦 / 高光时刻) and `"death"` (死亡集锦).
- All time and duration fields are milliseconds, but event timestamp semantics are state-specific. `击杀集锦` / `死亡集锦` montage events use `event_sTime` directly as the video timestamp. Moment videos (三杀时刻 / 四杀时刻 / etc.) use `clip_sTime + event_sTime`.
- There is no universal `max(round_sTime, clip_sTime) + event_sTime` formula. It double-counts observed montage events.
- `event_ext` carries rich Valorant shot metadata (`KillerPlayerName`, `KilledPlayerName`, `AgentName`, `WeaponSkinName`, `GetShotRolePart` 0=body/1=head/2=leg, `KillerIsMe`, `KilledIsMe`, `AssistNum`).
- Visible UI events must pass the shared event state machine (`packages/gui/src/utils/event-state-machine.ts`, mirrored by `src-tauri/src/library/events.rs`): `EventName=Shot`, `EventTime` inside the match window, `AgentName` matching the current match agent, killer/victim names present, local-player flags present, shot part present, and video/event type compatible.
- Incomplete but shot-like rows are **quarantined**, not displayed. Unsupported or contradictory rows are **rejected**. Neither category may produce event-list rows or progress-bar markers.
- ACLOS records the same wall-clock kill event under multiple highlight videos for one match (e.g. an event appears in both 击杀集锦 and 三杀时刻). The event list dedupes accepted visible events on `(EventTime, victim)` for kills and `(EventTime, killer)` for deaths in `normalizeMatchEvents`. Do not dedupe inside a single video — that data is already clean.
- If the dedup identity name is missing, do not merge solely by `EventTime` second. Fall back to a composite key using normalized names, weapon, and primary video-time bucket so unrelated same-second rows are preserved.
- ACLOS highlights can include the **whole team's** kills (all marked `KillerIsMe=1`). The state machine requires explicit local flags for visible rows, but per-match K/D shown in any UI must still come from `m.stats.*`, not from the event count. The list modal uses stats for the header counts and shows events as a playback index.
- Event playback uses a separate `seekMs`; under the state machine it equals the accepted state's exact video timestamp. `normalizeMatchEvents` keeps the best playable duplicate: kills prefer `击杀集锦`, deaths prefer `死亡集锦`.
- Event row click and progress-bar dot click both apply a 2 s pre-roll (`EVENT_PREROLL_MS` in `event-time.ts`, via `playbackSeekMsForVideo`). The player seeks to `event_time - 2 s` (clamped >= 0) so the user sees the kill/death happen instead of the post-frame. Dot positions on the bar stay at the exact event time for visual reference.
- Weapon skin paths like `LugerPistol_Ashen_PrimaryAsset.Default__LugerPistol_Ashen_PrimaryAsset_C` are normalised in `packages/gui/src/utils/weapons.ts`. Weapon codes are mapped by `WEAPON_CN`; skin Chinese names come from the committed local dump `packages/gui/src/utils/generated/valorant-skins.zh-CN.ts`, refreshed with `bun run update:skins`. Runtime GUI code must not fetch Valorant-API.

## Reference Docs

- `docs/ACLOS_FORMAT.md` - WonderfulDb paths, format notes, snapshot nicknames, parser field semantics, rounds/clips/events.
- `docs/ARCHITECTURE.md` - runtime shape, Tauri commands, scaling plan, dev/test workflow, repo layout.
- `docs/FRONTEND_CONVENTIONS.md` - stable DOM rendering, account sentinel, match/detail layout, asset cache, player rules, fonts/icons, event interaction flow.
- `docs/AGENT_WORKFLOW.md` - standard agent loops for features, bug fixes, refactors, optional PRs, manual checks, and GitHub Actions releases. Includes the hard default: no remote push without an explicit user request.
- `docs/UPDATER.md` - in-app self-update system (tauri-plugin-updater + GitHub Releases latest.json, signing keys, UpdateModal UI spec).
- `DESIGN.md` - product visual system and UI constraints.
- `PRODUCT.md` - product intent and user-facing behavior.

Before changing parser behavior, read `docs/ACLOS_FORMAT.md`.
Before changing app structure or build workflow, read `docs/ARCHITECTURE.md`.
Before changing GUI layout, DOM refresh, CSS, icons, player, or tooltips, read `docs/FRONTEND_CONVENTIONS.md` plus `DESIGN.md`.
Before preparing an external PR, manual GitHub check, or release, read `docs/AGENT_WORKFLOW.md` plus `VERSIONING.md`. Version consistency is verified in CI via `scripts/check-versions.ts` — add new version-bearing files to both `check-versions.ts` and `version-bump.ts`. Never push `main`/tags unless the user explicitly asks.
Before touching the updater (tauri.conf updater block, signing keys, release.yml latest.json, UpdateModal), read `docs/UPDATER.md`. The signing pubkey in `tauri.conf.json` must stay paired with the `TAURI_SIGNING_PRIVATE_KEY` GitHub secret; the private key lives only at `~/.tauri/wonderfului.key` (never in repo).

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

- **NSIS uninstaller data cleanup is custom, NOT upstream-default.** The upstream `installer.nsi` cleans `%LOCALAPPDATA%\<BUNDLEID>` (which is `%LOCALAPPDATA%\app.local.wonderfului` in this project) and would miss the actual SQLite / logs / assets directory (`wonderful-ui\`, hyphenated, lowercase). Our `un.RemoveAppData` (in `src-tauri/installer.nsi`) targets `${WUI_DATA_DIR}` explicitly. If you ever re-sync the NSIS template with upstream, **this custom cleanup logic is the first thing to reapply** — without it, uninstall leaves `library.db` and the asset cache on disk regardless of the user's "保留本地用户配置" choice. ACLOS / Valorant / Riot / Vanguard paths must NEVER be referenced in `un.RemoveAppData`; the existing comment block enumerates the hard constraints.
- **NSIS rebuild must run on Windows.** The Release workflow (`windows-latest`) handles this; locally you must run `bun run build` from a Windows host to surface `makensis` errors. macOS / Linux cannot compile the NSIS template.
- **Custom NSIS checkbox geometry is fixed.** `un.ConfirmShow` uses `y=100, h=25, w=400` (the upstream `DeleteAppDataCheckbox` defaults). Do not increase `h` to fit longer text — `__NSD_CheckBox_STYLE` wraps multi-byte characters vertically instead of expanding horizontally, producing a single-character column. If the label needs more room, shorten the `wuiKeepUserData` LangString, don't grow the control.

## Verification Commands

Run the smallest relevant set:

```bash
# Version consistency check (useful before release)
bun run scripts/check-versions.ts

# TS parser unit tests
bun test packages/parser

# GUI pure-logic tests (utils/*, excludes component tests)
bun test packages/gui

# All non-component tests
bun run test

# Rust parser unit tests
cargo test --release --manifest-path src-tauri/Cargo.toml --lib

# Vue component smoke tests (requires vitest)
bun run --cwd packages/gui test:components

# Player state machine tests (subset)
bun test packages/gui/test/player-state.test.ts

# TS parser CLI sanity
bun run packages/parser/cli.ts scan 4807045517549591240
```

For doc-only changes, at minimum verify Markdown links and review `git diff`.

## Highest-Risk Pitfalls

- ACLOS can hold `WonderfulDb` open while writing; torn reads are possible if ACLOS is running.
- Keep direct WonderfulDb reads isolated to `library::scraper`; command handlers and GUI-facing load paths should go through SQLite.
- **`scan_shell` background scrape race:** `scan_shell` returns immediately with the existing SQLite library view, then spawns a background thread to refresh from WonderfulDb. On first launch the local library is empty, so the frontend must NOT reveal the main UI until the background scrape settles — otherwise the user sees a flash of empty "还没有高光". Subscribe to `wui://scrape_summary` **before** calling `scan_shell`; Tauri events are not buffered, so subscribing after the command returns may miss the event. `runBoot()` in `App.vue` sets `account.scraping = true` before `scanShell()` and waits for `scrape_summary` (with a 30 s safety timeout) before calling `loadLibrary()` a second time and revealing the 3-pane shell.
- Incremental scan skips only unchanged accounts with no previous parse error; full scan is available from the refresh-button mode setting and as a direct settings-modal maintenance action.
- `snapshot<openid>` is optional and must not block highlight loading.
- `ALL_ACCOUNTS = '__all__'` is a synthetic sentinel, not a real account.
- Frontend uses a stable DOM skeleton; do not rebuild all of `#app` for normal state changes.
- Component-owned global listeners must be disposed when their owner leaves the DOM.
- Match videos group by `video_type`, not by array position or duration.
- User-facing hero/map/mode labels should come from `career.*` when available.
- Rust `VideoItem.video_is_processing` must serialize as `video_isProcessing`.
- Date range end dates are inclusive through `23:59:59.999` local time.
- Icons come from @iconify/vue (Phosphor set), via the shared `WIcon.vue` wrapper (`packages/gui/src/components/common/WIcon.vue`). Do not use Unicode symbol glyphs for controls.
- Chinese UI labels must use MiSans / `--font-sans`, not JetBrains Mono.
- Built-in video player lives in `#player-host`, outside `#app`.
- Player z-index (1200) is above event modal z-index (1100) so the list modal stays visible behind the player when the user clicks a row.
- Event-list modal dedup happens in `normalizeMatchEvents` (TS), not in the parser — the parser faithfully returns what ACLOS wrote; the UI collapses duplicates for the user's per-match view after the event state machine accepts visible rows. The dedup key normalizes player names (strips `#tag`, folds case) and buckets `EventTime` to the second for tolerance. Events missing required state-machine evidence are quarantined and are not deduped into UI rows.
- `KillerIsMe=1` is unreliable in ACLOS highlight videos (often marks the whole team's kills as "me"). Never derive a per-match kill/death count from the event list — use `m.stats.*` instead. Visible kill rows require `KillerIsMe=1` and `KilledIsMe=0`; visible death rows require `KilledIsMe=1` and `KillerIsMe=0`; missing flags quarantine the row. **The filtered event count is still not a reliable K/D tally**.
- **Cross-match event filtering:** ACLOS highlight videos (especially 击杀集锦) can stitch kills from multiple matches. The shared state machine requires `event_ext.AgentName` to be present and match `m.agent.agent_name`; missing or mismatching agent evidence prevents UI exposure. This is a heuristic — if the same agent was played in multiple matches, cross-match events with the same agent name may slip through.
- **Snapshot achievements** (MVP/SVP badge + filter) come from `snapshot<openid>`, not the main WonderfulDb file. Coverage is partial (early ACLOS builds didn't write `match`-type records). The badge silently hides when data is missing. **Never aggregate** snapshot data — only filter by it.
- **Virtual scroll layout**: match rows are `position: absolute` siblings of `.vlist-spacer` inside `.match-list` (`position: relative`). Do not nest rows inside a separate wrapper — it pushes them below the spacer. `ROW_HEIGHT` (104) must account for card `min-height` (96) + visual gap (8). Changing `.match-row` padding or `min-height` requires adjusting `ROW_HEIGHT`.
- **Player state machine**: PlayerHost.vue uses a single `PlayerState` ref (`loading`/`playing`/`paused`/`buffering`/`ended`/`error`), not ad-hoc booleans. Do NOT reintroduce `isBuffering`, `isInitialLoad`, `wasPlayingBeforeBuffering`, or `pendingSeekCount`. All visual flags (`showLoading`, `showFrameStepper`, etc.) are computed from state.
- **Player video element lifecycle**: `onTimeUpdate`, `onLoadedMeta`, and `onPlay` must null-guard `videoRef.value`. The `<video>` element is behind `v-if="player.isOpen"` — when the player closes, the element unmounts but `timeupdate` events can still fire, crashing on `null.duration`. All three event handlers now return early when `videoRef.value` is null.
- **Buffering timer lifecycle**: `waiting` while `playing` starts a 300 ms debounce timer before entering `buffering`. The timer MUST be cleared in `onCanPlay`, `onPlay`, `onPause`, `onEnded`, `onError`, `doClose`, and `watch(player.isOpen)` (reopen). Failure to clear the timer causes stale `buffering` state that locks the loading overlay.
- **Seek visual prevention**: Fast seeks should not flash a spinner. CSS-only fix via `.player-video { background-color: #000 }` — the video element's own background covers the frame gap during seek. `onSeeking` does NOT show the loading overlay; it only records `stateBeforeSeek` + `lastSeekTime` for buffering recovery.
- **Controls click propagation**: `.player-controls` div has `@click.stop` to prevent clicks on the controls bar (volume slider, progress track, time text, gaps) from bubbling to `.player-stage`'s `togglePlay`. Individual buttons also have `@click.stop`. `.player-frame-stepper` parent must NOT have `@click.stop` (blocks click-to-resume).
- **Progress bar reactivity**: `lastBufferedPct` is a `ref` (not `let`) so `bufferedStyle` recomputes. Thumb positioning uses `left: X%` (relative to parent track), not `translate(X%)` (relative to element's own 8 px width). `.player-event-markers` uses `.closest('.player-event-marker')` check in `onMouseDown` instead of `@mousedown.stop` to avoid blocking track seek.
- **Loading overlay visibility**: Uses `opacity: 0; pointer-events: none` (not `display: none`) so the element stays in the render tree. Initial load shows poster + darken + spinner. Buffering shows poster only (no darken, no spinner) in `dim-overlay` mode, or full spinner in slow-buffering mode.
- **Player right-click menu**: `PlayerHost.vue` + `utils/context-menu.ts`. Close via document `mousedown` capture + `e.button === 0` (never `click` — right-click race). Listeners bound once (`ctxMenuListenersBound`). Escape closes the **menu first**, not the player. Teleport to `fullscreenElement` or `body` so the menu is visible in fullscreen. Clamp position with `placeMenuNearCursor`. Exit: `v-show` + `is-closing` + `animationend` name filter + 200 ms safety. Toast errors for play/reveal/copy like the toolbar.
- **OS-spawn fire-and-forget**: `reveal_in_explorer` and `reveal_logs_dir` in `src-tauri/src/lib.rs` must use `Command::spawn()` with `Stdio::null()`, never `.status()`. The previous `.status()` call blocked the Tauri command thread until the outer `cmd.exe` / `explorer.exe` finished initializing (Explorer + DWM handshake ≈ 300–800 ms), which surfaced as a visible UI freeze on right-click menu close. `explorer.exe` exits with code 0 or 1 in `/select` mode regardless of success; treat `spawn() == Ok(())` + pre-spawn `Path::exists()` as success.
- **`play_video` uses native Win32**: `src-tauri/src/os_shell.rs::shell_open` calls `ShellExecuteW` directly via the `windows` crate (0.61, deduped with Tauri's transitive dep). Do **not** route this through `cmd /c start ""` — the `cmd.exe` process layer + `start` builtin lookup is exactly the ~300–800 ms right-click menu lag we already fixed. `ShellExecuteW` is in-process and the same API Explorer uses. The `play_video_missing_file_returns_error` test pins the Chinese error message format.
- **Never use Windows `IDataTransferManagerInterop` / UWP Share Sheet for "share to other app" flows.** The path looks clean in docs (`RoGetActivationFactory` cast to `IDataTransferManagerInterop`, AUMID, `run_on_main_thread` for STA), but in practice we hit: (1) `0x80040154 REGDB_E_CLASSNOTREG` because the CLSID looks COM-registered but is actually a WinRT runtime class; (2) Win11 "重试 我们无法为您显示所有共享方法" overlay that hides every third-party target (LocalSend, OneDrive, etc.); (3) AUMID must be set on the **main thread** during `app.setup()` and the entire call chain must run STA. **We abandoned this in 2026-06-23** in favor of our own "快传" HTTP+QR flow (`src-tauri/src/share_server.rs` + `ShareModal.vue`) — no UWP, no AUMID, zero third-party protocol implementation. The `SharePlatform` interface in `packages/gui/src/share/` is kept as a **framework only** (no real platform implementations) so future add-ons plug in without touching the player UI.
- **"下载完成" must correspond to a successful `req.respond()`, not a GET request arrival.** `tiny_http::Response::from_file`'s `respond()` is a blocking call — it streams the entire file to the socket and only returns `Ok(())` when the file is fully sent (or fails with BrokenPipe if the client disconnected early). Move `downloads.fetch_add(1) + emit("wui://share_downloaded")` to **after** `respond()` returns `Ok(())`. WeChat scanning a URL only previews without downloading → `respond()` errors mid-stream → count stays 0 → UI keeps "等待扫码" + progress bar indeterminate. This is intentional and matches user expectation: "下载完成" must be a real download completion, not "URL was opened".
- **Share modal lifecycle = server lifecycle.** The modal owns the embedded HTTP server: `onMounted` → `share.start()`, `onUnmounted` → `share.stop()`. **Do NOT auto-close the modal on first download** (we tried, removed it). The user controls when to close. The only auto-shutdown is a 3-minute idle timeout in Rust (safety net for forgotten modals). All three close paths — `×` button, `Escape` key (capture-phase keydown), backdrop click — route through `emit('close')` → Vue unmounts → `onUnmounted` fires `share.stop()`. Test the race: if the user presses Esc AND taps the backdrop simultaneously, exactly one `share.stop()` is called.
- **`share.stop()` must be idempotent.** Multiple close paths can race — Esc + backdrop + × at the same time. The Rust `stop_server` function must check the inner state and only call `stop_tx.send(())` if a server is actually running. Otherwise a stale close will send a signal to a non-existent thread (harmless) but the user can see a phantom "已停止" toast.
- **Client → Rust logging via `log_event`.** Frontend must NOT write directly to `console.log` and call it a day. Use `clientLog('info' | 'warn' | 'error', 'share-modal', message)` from `packages/gui/src/utils/client-log.ts`. It forwards to Rust `log_event` → `app_log` → `wonderful-ui.log`. The helper auto-detects Tauri runtime: in browser / happy-dom (no `window.__TAURI_INTERNALS__`), it falls back to `console.*` so unit tests don't throw. Always include the scope tag in the second arg — Rust uses it for filtering.

Details for these pitfalls are in `docs/ACLOS_FORMAT.md` and `docs/FRONTEND_CONVENTIONS.md`.

## Documentation Maintenance

- Keep `AGENTS.md` as the short entry point.
- Add agent execution, optional PR, manual check, and release workflow facts to `docs/AGENT_WORKFLOW.md`.
- Add durable parser facts to `docs/ACLOS_FORMAT.md`.
- Add architecture, workflow, or performance facts to `docs/ARCHITECTURE.md`.
- Add GUI implementation conventions to `docs/FRONTEND_CONVENTIONS.md`.
- If a note is not needed by most future agents before editing, keep it out of `AGENTS.md` and link to it instead.
