# WonderfulUI Architecture

Last organized: 2026-06-20.

WonderfulUI is an offline parser and desktop GUI for ACLOS Tencent "无畏时刻" highlights. Users can browse Valorant highlight metadata and videos without launching Valorant, WeGame, Riot Client, or Vanguard.

## Current Shape

- Runtime: Bun 1.3.14 for CLI and tests, WebView2 V8 for GUI.
- Shell: Tauri 2.
- Frontend: Vite + native TypeScript / DOM APIs, no framework.
- Parser: Rust in-process inside the Tauri shell.
- Library store: bundled SQLite via `rusqlite` at `%LOCALAPPDATA%\wonderful-ui\library.db`.
- TS parser: retained for CLI and Bun unit tests.
- Build: `cargo tauri build` / `bunx tauri build`, no sidecar parser executable.
- Git: single repository, main branch, no pre-commit hook.

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
- `src-tauri/src/library/model.rs` - library-facing IPC aliases. It currently reuses parser shapes so the frontend does not need a migration.

Tauri command handlers should not directly parse WonderfulDb files. They should refresh or read the SQLite library.
The scraper persists two layers for each match: full `matches.raw_json` as the authoritative replay/audit payload, and deduped normalized rows in `events` for fast lookup, migration, and future library views. Do not drop raw event trees just because `events` exists.
Account display overrides and drag order live in SQLite `account_preferences`. They are local WonderfulUI preferences and must not be written back to ACLOS `snapshot<openid>` or WonderfulDb files.

## Tauri Commands

Defined in `src-tauri/src/lib.rs`:

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
  - Missing or unknown `mode` defaults to `incremental`. The GUI stores a refresh-button scan mode (`incremental` or `full`) and passes it from the top-right refresh button. The settings modal's direct full scan action passes `mode: "full"`.
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
  - Uses the system default player through `cmd /c start "" <path>`.
  - Does not launch Riot Client or Valorant.
- `reveal_in_explorer(path)`
  - Uses `explorer /select,"<path>"`.
  - Kept separate from playback for player context-menu actions.
  - `explorer.exe` exit code after `/select` is unreliable (it forks a new
    process and returns immediately with code 0 or 1). Success is judged by
    spawn success + file existence, not exit code. See `lib.rs` for details.
- `cache_hero_image(url)` (legacy thin wrapper around `cache_asset`)
- `cache_asset(kind, url)` — unified asset cache supporting `hero_image`, `map_image`, `game_mode_icon`
- `cache_assets(entries)` — batch variant, returns `url → local_path` map for bulk pre-warm
  - Caches remote assets into `%LOCALAPPDATA%\wonderful-ui\assets\{kind}\`.
  - First scan may download played-agent icons, map covers, and mode icons; later scans should hit cache.

## IPC Shape

```text
WebView (packages/gui)
    invoke scan_all
        -> Tauri (src-tauri/src/lib.rs)
            -> library::scraper refreshes SQLite from WonderfulDb
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

- Sequential scans become the first likely wall: 40 x 20 ms is around 800 ms.
- Memory is acceptable around 1 GB of matches, but streaming or paging may matter at 100x.
- The old walls, raw IPC, Web Crypto throughput, and command-layer
  WonderfulDb re-parse on detail open are already gone.

If users actually hit 10x:

1. Parallelize the scraper with `rayon` only if sequential source refresh shows up in profiling.
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

Use the release loop only when validating a shipped build:

```bash
bunx tauri build
# or
bun run build
```

Release build bundles MSI, NSIS, and standalone exe and commonly takes 60-90 seconds.

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
│   └── gui/          # Tauri frontend
│       ├── public/
│       │   └── fonts/misans/
│       └── src/
│           ├── fonts.css
│           ├── style.css
│           ├── main.ts
│           ├── app.ts
│           ├── player.ts
│           ├── event-list-modal.ts
│           ├── weapons.ts
│           ├── filters.ts
│           ├── filter-engine.ts
│           ├── filter-bar.ts
│           └── date-picker.ts
├── docs/
└── tools/
    └── extract-schema/
```
