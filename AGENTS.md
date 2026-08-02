# AGENTS.md

This is the short, authoritative entry point for agents and maintainers. Read it
before editing; follow the linked document that owns the detail instead of
copying rules into a second checklist.

## Product contract

WonderfulUI is a Windows x64 desktop app for organizing and replaying a player's
existing Valorant highlights. It is a personal highlight library, not an ACLOS
parser product, recorder, cloud service, or generic framework.

The current stack is Tauri 2 + Vue 3 + Pinia + Rust + bundled SQLite. Bun is
pinned to 1.3.14 and Rust to 1.88.0. The published Windows artifact is an NSIS
installer (`*_x64-setup.exe`); there is no MSI or portable package.

## Non-negotiable boundaries

- Treat ACLOS `WonderfulDb`, `snapshot<openid>`, and copied identity-cache inputs
  as read-only. Never modify ACLOS, Riot, WeGame, Valorant, Vanguard, or game
  installation files.
- Do not start, inject into, or attach to the game, Riot Client, ACLOS, ACE, or
  Vanguard processes.
- Do not hard-code a user's absolute path, openid, nickname, tag, match id, NAS
  location, or video inventory into production logic or docs.
- Do not add or promise deletion, editing, export, backup, directory selection,
  portable running, cloud sync, or other behavior that is not in the current
  implementation.
- For documentation work, do not change business logic, IPC, database,
  dependencies, build configuration, workflows, CSS, or interaction behavior.
  Allowed source changes are limited to existing user-facing copy, documentation
  links, or comments with no runtime effect.
- Never use `git reset --hard`, force-push, or overwrite a dirty worktree. Do not
  stash or delete user changes to make a task easier to isolate.

## Source and network facts

- The GUI reads the default ACLOS location derived from the user profile:
  `%USERPROFILE%\AppData\Roaming\ACLOS\WonderfulDb`. There is currently no
  user-selectable source directory.
- The app has no telemetry, account sync, or background upload path in the
  current implementation.
- Production startup checks GitHub Releases `latest.json` for updates after the
  main UI is revealed.
- User-triggered “快传” starts a temporary HTTP server on `22357/TCP` for a
  registered local video. It is a LAN transfer flow, not cloud upload.
- Core library browsing uses the local SQLite index and bundled display assets;
  never describe the whole app as completely offline or never-connected.

## Context map

| Work | Read first |
|---|---|
| Product/user wording | `PRODUCT.md`, `DESIGN.md`, `README.md` |
| ACLOS fields and event semantics | `docs/ACLOS_FORMAT.md` |
| Rust/Tauri/SQLite/IPC/build facts | `docs/ARCHITECTURE.md` |
| Vue rendering, player, filters, a11y | `docs/FRONTEND_CONVENTIONS.md` |
| Updater, signing, NSIS, latest.json | `docs/UPDATER.md`, `VERSIONING.md` |
| Branches, checks, commits, releases | `docs/AGENT_WORKFLOW.md`, `CONTRIBUTING.md` |
| User recovery paths | `docs/TROUBLESHOOTING.md` |

## Change loop

1. Run `git status --short --branch` and identify the exact scope.
2. Read the owning context and current code/config before making a claim.
3. Make the smallest change that satisfies the request; do not refactor nearby
   code while editing copy or docs.
4. Run checks appropriate to the changed surface, then `git diff --check`.
5. Review links, paths, secrets, generated files, and platform claims in the
   final diff. Search the repository for deleted paths and old product wording.
6. Stage explicit paths and use small, independently understandable commits.
   Push or open a PR only when the user asks for that publish flow.

## Verification boundary

Browser debug (`bun run dev:browser`), type checking, Bun/Vitest tests, and a
Vite build can provide macOS/local evidence. They do not prove Windows WebView2
behavior, NSIS installation/update, Windows firewall/UAC, Media Foundation
frame capture, or a real ACLOS scan. Report those boundaries explicitly.

For a GUI copy change, use the relevant set:

```bash
bun install --frozen-lockfile
bun run typecheck
bun run test:all
bun run assets:check
bun run --cwd packages/gui build
```

For Markdown-only work, at minimum run `git diff --check` and a repository-wide
relative-link check. Never run `bun run version:*` during ordinary maintenance;
those scripts change versions, commit, tag, and push a release.
