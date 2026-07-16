# WonderfulUI Architecture

Last organized: 2026-06-22.

WonderfulUI is an offline parser and desktop GUI for ACLOS Tencent "无畏时刻" highlights. Users can browse Valorant highlight metadata and videos without launching Valorant, WeGame, Riot Client, or Vanguard.

## Current Shape

- Runtime: Bun 1.3.14 for CLI and tests, WebView2 V8 for GUI.
- Shell: Tauri 2.
- Frontend: Vue 3 (`<script setup lang="ts">`) with Pinia state management, vue-router (`createMemoryHistory`), and Vite HMR.
- Browser debug runtime: `bun run dev:browser` starts the GUI Vite app only,
  letting agents open `http://localhost:1420/?debug=1` in a normal browser.
  The frontend falls back to mock Tauri commands through
  `packages/gui/src/tauri-adapter.ts`, so UI surfaces can be inspected with
  browser tooling without reading ACLOS or launching the Tauri shell.
- Parser: Rust in-process inside the Tauri shell.
- Library store: bundled SQLite via `rusqlite` at `%LOCALAPPDATA%\wonderful-ui\library.db` in **WAL mode**.
- App logs: `%LOCALAPPDATA%\wonderful-ui\logs\wonderful-ui.log`, a single Tauri-managed file with automatic compaction.
- TS parser: retained for CLI and Bun unit tests.
- **Test infrastructure**: two runners.
  - `bun:test` for pure-logic utility tests (118 cases, `packages/gui/test/*.test.ts` and `packages/parser/tests/*.test.ts`).
  - `vitest` + `@vue/test-utils` + `happy-dom` for Vue component smoke tests (42 cases, `packages/gui/test/*.component.test.ts`). vitest handles `.vue` SFC compilation via `@vitejs/plugin-vue`; Bun cannot process `.vue` imports natively. Pinia stores are injected via `createTestingPinia` with initial state.
- Build: `cargo tauri build` / `bunx tauri build`, no sidecar parser executable.
- Git: single repository, main branch, no pre-commit hook.
- **Scraper parallelism**: account files are parsed in parallel via `rayon`, then written to SQLite sequentially in per-account `BEGIN IMMEDIATE` / `COMMIT` transactions.
- **Frontend virtual scrolling**: match list renders only visible + buffer rows (~12 DOM nodes instead of hundreds), using `position: absolute` + `transform: translateY()` with a `.vlist-spacer` for scrollable height and rAF-batched scroll handler.
- **In-app updater** (since v0.1.5): `tauri-plugin-updater` + `tauri-plugin-process` are default features. The GUI calls `check()` / `downloadAndInstall()` / `relaunch()` only through `packages/gui/src/stores/update.ts`. Manifest is GitHub Releases `latest.json` (signed NSIS setup). Details: `docs/UPDATER.md`.
- **Screenshot** (player context menu, Windows only): Tauri `capture_video_frame` (`src-tauri/src/frame_capture.rs`) uses Media Editing `GetThumbnailAsync` at `time_ms`, returns PNG base64. No frontend canvas path. Save: `plugin-dialog` + `plugin-fs`. Clipboard: `ClipboardItem`.
- **In-app player media:** playback uses Tauri **asset** protocol (`convertFileSrc`) for progressive Range streaming.
- **CI caches**: Release tags restore Bun + Rust release-profile caches warmed on `main` by `.github/workflows/cache-warm.yml` (GHA only shares default-branch caches with tags). See `docs/AGENT_WORKFLOW.md` § Release build speed.

## Parser Layout

- `src-tauri/src/parser/` - Rust parser used by GUI.
  - `hex.rs`
  - `crypto.rs`
  - `model.rs`
  - `reader.rs`
- `packages/parser/` - TS parser and CLI.
- Rust parser crates: `aes`, `cbc`, `sha2`, `hex`; no OpenSSL dependency.
- The Rust and TS parsers should stay byte-for-byte aligned on fixture output.

## Library Layout

- `src-tauri/src/library/db.rs` - SQLite path resolution, schema migration, library view loading, and full-match lookup from stored `raw_json`.
- `src-tauri/src/library/events.rs` - Rust mirror of the visible-event state machine for kill/death filtering, dedup keys, playback seek offsets, and SQL event rows.
- `src-tauri/src/library/scraper.rs` - read-only ACLOS WonderfulDb source adapter. This is the only production layer that calls `parser::parse_wonderful_db` / `parser::parse_snapshot_db`.
- `src-tauri/src/library/aclos_identity.rs` - account nick/#tag from ACLOS Chromium Local Storage LevelDB (`ACLOS_USER_ROLES_INFO`, `acloshighlight_user_<openid>` via `rusty-leveldb`), then snapshot, then log harvest. Achievements remain snapshot-only.
- `src-tauri/src/library/model.rs` - library-facing IPC aliases. It currently reuses parser shapes so the frontend does not need a migration.

Tauri command handlers should not directly parse WonderfulDb files. They should refresh or read the SQLite library.
The scraper persists two layers for each match: full `matches.raw_json` as the authoritative replay/audit payload, and deduped normalized rows in `events` for fast lookup, migration, and future library views. Do not drop raw event trees just because `events` exists.
Account display overrides and drag order live in SQLite `account_preferences`. They are local WonderfulUI preferences and must not be written back to ACLOS `snapshot<openid>` or WonderfulDb files.

## Tauri Commands

Defined in `src-tauri/src/lib.rs`:

- `aclos_status(dir?: string) -> AclosStatusPayload`
  - **Read-only** probe of the ACLOS WonderfulDb directory. Returns
    `{ dir, dirExists, hasAccounts }` so the GUI can route the user to the
    first-run / onboarding screen without paying the cost of `scan_shell`.
  - `dirExists` is true when the directory is on disk.
  - `hasAccounts` is true when the directory contains at least one
    non-hidden, non-snapshot, non-index file (mirrors the rule ACLOS
    uses to enumerate account files).
  - Does not create, modify, or touch the directory.
  - The frontend calls this at boot, before `scan_shell`, in
    `App.vue -> runBoot()`.
- `scan_shell(dir?: string) -> ScanShellPayload`
  - Opens the local SQLite library and returns the existing account shell
    immediately so startup can render without waiting for a full source scan.
  - Spawns the WonderfulDb source refresh in the background and streams
    `wui://phase` / per-account progress events to the boot progress UI.
  - The frontend follows with `load_library()` after startup progress to read
    the current rounds-stripped library view from SQLite.
- `scan_all(dir?: string) -> LoadResult`
  - Opens the local SQLite library.
  - Runs the WonderfulDb source adapter in **incremental** mode against `dir` (default `%USERPROFILE%\AppData\Roaming\ACLOS\WonderfulDb`).
  - Loads the library view from SQLite.
  - Per-account source failures are persisted on `accounts[].error`.
  - If startup source refresh fails but SQLite already has accounts or matches, returns the existing library view. If the library is empty, the source error is returned.
  - **Strips `rounds` from every match before sending** (via
    `strip_match_rounds`) so the bulk payload stays at ~50 KB / account
    instead of ~6 MB. Use `get_match_rounds` to fetch the rest on demand.
- `scrape_library(dir?: string, trigger?: string, mode?: "incremental" | "full") -> LoadResult`
  - Manually refreshes the local SQLite library from the configured WonderfulDb source, then returns the same library view as `scan_all`.
  - Missing or unknown `mode` defaults to `incremental`. The GUI stores a refresh-button scan mode (`incremental` or `full`) and passes it from the match-list header refresh button. The settings modal's direct full scan action passes `mode: "full"`.
  - Manual source failures return an error so the user gets explicit feedback.
- `load_library() -> LoadResult`
  - Returns the current SQLite library view without reading WonderfulDb.
- `get_match_rounds(openid: String, match_id: String) -> MatchRecord`
  - Reads `matches.raw_json` from SQLite and returns the single match
    identified by `match_id`, with the full `rounds` tree attached. Called
    by the GUI when the user opens a match detail (lazy load).
- `save_account_order(openids: string[])`
  - Persists the left account pane's user-defined order in SQLite `account_preferences`.
  - The synthetic `__all__` account is not stored; it always renders at the top.
- `rename_account(openid: string, customName?: string)`
  - Persists a WonderfulUI-local account display name override.
  - Empty/null clears the override and falls back to snapshot nickname/tag.
- `play_video(path)`
  - Uses **Win32 `ShellExecuteW`** directly (in-process Win32 call, no
    `cmd.exe`, no `cmd /c start` parsing). It is the same API Explorer and
    the taskbar "Open" button use internally, so the call returns in
    milliseconds after handing the file off to the shell.
  - Wrapped in `src-tauri/src/os_shell.rs` behind `#[cfg(windows)]`; the
    non-Windows stub returns an error. Pre-call `Path::exists()` guards
    both the user-friendly Chinese error and the unit test.
  - The previous `cmd /c start "" <path>` path added a process layer
    (cmd parsing + conhost + `start` builtin lookup) that took ~300–800 ms
    per click, which surfaced as right-click menu close lag. `ShellExecuteW`
    removes that cost entirely.
  - Does not launch Riot Client or Valorant.
- `reveal_in_explorer(path)`
  - Uses `explorer.exe /select,<path>` directly (no `cmd /c` wrapper).
  - **Fire-and-forget** for the same reason as `play_video` — `.status()` on
    `explorer /select` blocked the Tauri command thread until the new Explorer
    window finished initializing.
  - Kept separate from playback for player context-menu actions.
  - `explorer.exe` exit code after `/select` is unreliable (it forks a new
    process and returns immediately with code 0 or 1). Success is judged by
    spawn success + file existence, not exit code. See `lib.rs` for details.
- `get_log_status() -> LogStatus`
  - Returns the WonderfulUI log directory, current log file metadata, and a bounded tail preview from `wonderful-ui.log` for the settings `日志` tab.
- `reveal_logs_dir()`
  - Opens `%LOCALAPPDATA%\wonderful-ui\logs` in Explorer so users can attach logs to future bug reports.
- `start_share_server(path) -> ShareServerInfo`
  - Starts a 1-shot HTTP server on a free local port (49152-65535), generates a
    256-bit URL-safe token, returns `{ port, token, url, lanIp, qrSvg, videoName, videoSize, startedAtUnix }`.
  - The QR SVG is generated Rust-side using **circle modules** (not rectangles)
    with `EcLevel::H` (30% recovery) and a 4-module quiet zone for iPhone
    / Android native scanner compatibility.
  - Token is the only auth — request path MUST start with `/w/<token>` and the
    `Host` header MUST match `localhost` / `127.0.0.1` / the detected LAN IP
    (DNS-rebinding guard).
  - Server lifetime is **driven by the frontend** (modal mounted → up, modal
    unmounted → down). Rust holds the running server state in a
    `tauri::State<ShareServerState>` registered via `.manage()` on the
    builder. A **3-minute idle timeout** is the only auto-shutdown path —
    covers "user opened modal then forgot about it" without a port leak.
- `stop_share_server()` — explicit shutdown; sends stop signal to the server
  thread which exits cleanly. Frontend calls this on modal close.
- `share_server_status() -> ShareServerStatus` — `{ running, info, downloadCount, lastError }`
- `log_event(level, scope, message)` — generic log forwarder so the frontend
  can write structured logs that end up in `wonderful-ui.log` next to Rust
  logs. Browser / test environments fall back to `console.*` without
  throwing on `invoke`.
- `get_library_stats() -> LibraryStats`
  - Reads the local SQLite library and app-owned cache/log metadata to feed the settings `资料库概览`.
  - The GUI currently visualizes per-account video counts from this payload; storage byte fields remain backend diagnostics, not primary UI.
- `cache_hero_image(url)` (legacy thin wrapper around `cache_asset`)
- `cache_asset(kind, url)` — unified asset cache supporting `hero_image`, `map_image`, `game_mode_icon`
- `cache_assets(entries)` — batch variant, returns `url → local_path` map for bulk pre-warm
  - Caches remote assets into `%LOCALAPPDATA%\wonderful-ui\assets\{kind}\`.
  - First scan may download played-agent icons, map covers, and mode icons; later scans should hit cache.

## IPC Shape

```text
WebView (packages/gui)
    invoke scan_shell
        -> Tauri (src-tauri/src/lib.rs)
            -> library::db loads existing account shell
            -> background scraper refreshes SQLite from WonderfulDb
    <- account shell + streamed progress events

WebView (packages/gui)
    invoke load_library
        -> Tauri (src-tauri/src/lib.rs)
            -> library::db loads the library view
    <- library matches JSON (rounds stripped)

WebView (packages/gui)
    invoke scrape_library
        -> Tauri (src-tauri/src/lib.rs)
            -> library::scraper refreshes SQLite from WonderfulDb
            -> library::db loads the library view
    <- library matches JSON (rounds stripped)

WebView (packages/gui)
    invoke load_library
        -> Tauri (src-tauri/src/lib.rs)
            -> library::db loads the library view
    <- library matches JSON (rounds stripped)

WebView (packages/gui)
    invoke get_match_rounds(openid, match_id)
        -> Tauri (src-tauri/src/lib.rs)
            -> library::db reads matches.raw_json from SQLite
    <- single MatchRecord (with rounds)
```

The WebView receives library match JSON, not raw WonderfulDb bytes. This
keeps IPC small and avoids Web Crypto work inside the frontend. WonderfulDb
reads are isolated to the scraper source adapter. The bulk `scan_all` /
`scrape_library` / `load_library` payload is rounds-stripped; round / clip /
event data is fetched on demand via `get_match_rounds` when the user opens
a match.

During a scrape, `library::events::normalize_match_events` writes deduped
accepted kill/death rows into SQLite `events`. Rejected or quarantined raw
events are not written to this visible index; they remain inside
`matches.raw_json` for audit and replay. The frontend still computes its
current modal rows from the lazily loaded full match so playback has the exact
source video object, but the SQL index is now available for future
count/search/export work without reparsing WonderfulDb.

## Scrape Modes

The scraper stores per-account source metadata in SQLite:

- main WonderfulDb file size + mtime
- optional `snapshot<openid>` file size + mtime
- last parse error

Incremental mode skips an account only when the main file and snapshot
metadata are unchanged and the previous parse completed without an account
error. Accounts with `parse_error` are retried even if the file metadata is
unchanged, because ACLOS can produce torn reads while writing. Full mode
ignores freshness metadata and reparses every account file.

## Diagnostics Logs

WonderfulUI keeps app-owned diagnostic logs under
`%LOCALAPPDATA%\wonderful-ui\logs\`. Logs are for post-release support and
bug triage, not for analytics or gameplay telemetry.

- Current file: `wonderful-ui.log`.
- Retention: one file only. When the log grows past its size limit, the app automatically keeps the newest tail and drops older content.
- Logged scope: app startup, library load/scan requests, on-demand round loads,
  cache failures, and log-directory access.
- Do not log raw WonderfulDb payloads, raw match JSON, clip/event trees, or
  broad video path inventories.
- Do not read from or write to Riot, VALORANT, Vanguard, WeGame, or ACLOS game
  install directories as part of logging.
- Future bug-report export should bundle these app logs plus version/build
  metadata and a user-reviewed summary; it should not silently upload data.

## Why Plan B

Plan A removed the 98 MB Bun-compiled sidecar and parsed in the WebView via Web Crypto, but raw account bytes still crossed IPC.

Plan B moved parsing into Rust inside Tauri:

- IPC shrank from raw bytes around 10 MB per account to parsed JSON around 50 KB per account.
- AES work moved out of Web Crypto.
- Rust AES is roughly 10x faster for the AES step on the local test set.
- Release builds no longer need a parser sidecar.

## Scaling Plan

Current startup refresh rough cost after Plan B + SQLite library, using
around 10 MB raw / 60 matches per account:

```text
std::fs::read                ~5 ms
AES-256-CBC decrypt (Rust)   ~10 ms
JSON parse + model build     ~5 ms
SQLite upsert raw_json       small local write cost
load_library_view            SQLite read + JSON decode
strip_match_rounds           <1 ms after view decode
IPC matches JSON (~50 KB)    ~1 ms / account
```

When the user opens a match detail, `get_match_rounds` loads the stored
full match `raw_json` from SQLite and returns one match with full rounds
(~135 KB serialized). It does not re-read WonderfulDb.

At 10x data, around 100 MB raw / 600 matches / account and 40 accounts:

- Sequential scans are no longer the wall: `rayon` parallelizes account parsing across cores.
- Transactions (`BEGIN IMMEDIATE` / `COMMIT`) batch SQLite writes per account, reducing fsync from hundreds per account to one.
- Memory is acceptable around 1 GB of matches, but streaming or paging may matter at 100x.
- The old walls, raw IPC, Web Crypto throughput, and command-layer
  WonderfulDb re-parse on detail open are already gone.
- **Frontend scaling**: virtual scrolling limits DOM nodes to ~12 visible rows regardless of match count. GPU composited layers are capped at ~12 (visible rows) + 1 (canvas markers) from previously ~1000+.

If users actually hit 10x:

1. ~~Parallelize the scraper with `rayon`~~ Done (2026-06-21).
2. Add a stronger optional freshness layer such as quick file hashes if mtime/size proves insufficient on user systems.
3. Profile before optimizing the parser itself; disk IO is likely to dominate before Rust AES does.
4. If users open many matches in a session, add an in-memory full-match cache above `get_match_rounds` so back-to-back detail opens skip SQLite JSON decode.

## Development Workflow

Use the dev loop for iteration:

```bash
bunx tauri dev
# or
bun run dev
```

- Starts Vite on `localhost:1420` through `beforeDevCommand`.
- Launches the Tauri shell pointed at the Vite dev URL.
- Frontend changes in `packages/gui/src/*.ts`, CSS, or HTML use Vite HMR and should appear in 1-2 seconds.
- Small Rust changes usually rebuild and relaunch in 3-10 seconds after warmup.
- Config or dependency changes require restarting `tauri dev`.

For browser-only UI debugging:

```bash
bun run dev:browser
```

- Opens the same Vite app on `http://localhost:1420`.
- Visit `http://localhost:1420/?debug=1` from a normal browser or Browser
  Skill. Outside Tauri, the mock runtime is also enabled automatically.
- Browser debug mode serves fixed sample accounts, matches, library stats,
  logs, asset paths, and safe fake video paths under `D:\WonderfulUIDebug\`.
- Use this for DOM/CSS/canvas/motion debugging. It must not become a parser or
  ACLOS data test path; production data access still belongs to Tauri commands.

Use the release loop only when validating a shipped build:

```bash
bunx tauri build
# or
bun run build
```

Release build bundles an NSIS installer and commonly takes 60-90 seconds. The NSIS installer is configured as Simplified Chinese (`SimpChinese`) because the product UI is currently Chinese-only.

## Test Commands

```bash
# TS parser unit tests
bun test packages/parser

# Rust parser unit tests
cargo test --release --manifest-path src-tauri/Cargo.toml --lib

# TS parser CLI sanity
bun run packages/parser/cli.ts scan 4807045517549591240
```

If a GUI fix takes more than around 10 seconds to test, check that you are using `tauri dev`, not `tauri build`.

## Build Artifacts

Gitignored build outputs:

- `target/`
- `src-tauri/target/`
- `node_modules/`
- `out/`
- `dist/`
- `release/`

There should be no active `src-tauri/binaries/wonderful-parser.exe`; the parser is a Rust module inside Tauri. A stale copy in a build output directory can be deleted when cleaning generated artifacts.

## Repo Layout

```text
WonderfulUI/
├── AGENTS.md
├── DESIGN.md
├── PRODUCT.md
├── package.json
├── tsconfig.json
├── bunfig.toml
├── bun.lock
├── Cargo.toml
├── src-tauri/        # Rust + Tauri config + parser
├── packages/
│   ├── parser/       # TS parser lib + CLI
│   │   ├── src/
│   │   │   ├── decoder.ts
│   │   │   ├── crypto.ts
│   │   │   ├── reader.ts
│   │   │   ├── reader-file.ts
│   │   │   ├── model.ts
│   │   │   ├── index.ts
│   │   │   └── schema/_acl-source/  # ACLOS eventDefine.js + helpers
│   │   ├── tests/
│   │   ├── cli.ts
│   │   └── package.json
│   └── gui/          # Tauri frontend (Vue 3)
│       ├── public/
│       │   └── fonts/misans/
│       └── src/
│           ├── assets/
│           │   ├── style.css
│           │   └── logo.svg
│           ├── fonts.css
│           ├── App.vue
│           ├── main.ts
│           ├── tauri-adapter.ts
│           ├── components/
│           │   ├── common/    # WIcon, AccountSidebar, BootOverlay, ToastHost
│           │   ├── event/     # EventRow, EventListModal
│           │   ├── layout/    # TopBar
│           │   ├── match/     # FilterBar, FilterRail, DateRangePicker, MatchCard
│           │   ├── player/    # PlayerHost, PlayerControls, ProgressBar
│           │   └── settings/  # SettingsModal
│           ├── composables/   # useVirtualScroll, useFloating
│           ├── router/
│           ├── stores/        # 6 Pinia stores: account, filter, detail, player, settings, ui
│           ├── utils/         # Pure logic: filters, event-state-machine, weapons, etc.
│           └── views/         # HomeView, DetailView, SettingsView
├── docs/
└── tools/
    └── extract-schema/
```
