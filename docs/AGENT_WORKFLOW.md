# Agent Workflow

Last organized: 2026-06-20.

This document is the operating manual for agents maintaining WonderfulUI.
`AGENTS.md` is still the short high-priority entry point; use this file when
you need the full workflow for feature work, bug fixes, refactors, and
releases.

## Ground Rules

Every change must preserve the project safety boundary:

- Do not modify game, Riot, Vanguard, or anti-cheat files.
- Do not start, inject into, or attach to Valorant, Riot Client, ACE, or
  Vanguard processes.
- Treat ACLOS `WonderfulDb` and `snapshot<openid>` files as read-only source
  data.
- Keep production paths portable; do not commit user-specific absolute paths.

Work from the current worktree, not memory. Start each task with:

```bash
git status --short --branch
```

If the worktree is dirty, identify which changes are already present and do
not revert them unless the user explicitly asks.

## Choose The Right Context

Read the smallest context set that matches the task.

| Task type | Required context |
|---|---|
| Parser behavior, ACLOS fields, event semantics | `AGENTS.md`, `docs/ACLOS_FORMAT.md` |
| Tauri commands, SQLite library, build workflow | `AGENTS.md`, `docs/ARCHITECTURE.md` |
| GUI layout, DOM refresh, icons, CSS, player, tooltips | `AGENTS.md`, `docs/FRONTEND_CONVENTIONS.md`, `DESIGN.md` |
| Product wording or user-facing behavior | `AGENTS.md`, `PRODUCT.md`, `DESIGN.md` |
| Version bump or release | `AGENTS.md`, `VERSIONING.md`, this file |
| Contribution or PR hygiene | `AGENTS.md`, `CONTRIBUTING.md`, this file |

If a fact is durable and likely to matter to future edits, update the matching
doc in the same PR.

## Standard Change Loop

Use this loop for new features, bug fixes, UI polish, and refactors:

```text
1. Inspect -> verify: read status, relevant docs, nearby code, existing tests
2. Reproduce or specify -> verify: failing test, visible symptom, or concrete acceptance criteria
3. Implement surgically -> verify: changed lines map to the request
4. Run checks -> verify: smallest relevant set first, then broader checks before PR
5. Review diff -> verify: no generated files, unrelated cleanup, secrets, or user-specific paths
6. Open PR -> verify: GitHub CI succeeds before merge
```

Prefer fixing the root cause over patching symptoms. If the bug involves
parser or event timing behavior, add or update tests before changing the
implementation.

## Feature Work

For a new feature:

1. Confirm the user-facing behavior and non-goals.
2. Identify the owning layer:
   - parser model / reader
   - SQLite library / scraper
   - Tauri command
   - GUI state/rendering
   - release/documentation
3. Add the smallest test that proves the new behavior.
4. Implement through existing boundaries. Do not bypass SQLite library loading
   by parsing WonderfulDb directly in command handlers or GUI code.
5. Update docs if the feature changes architecture, GUI conventions, release
   behavior, or ACLOS facts.

Useful checks:

```bash
bun run typecheck
bun run test
cargo test --release --manifest-path src-tauri/Cargo.toml --lib
```

Use `bun run build` only when the feature affects Tauri config, bundling,
release behavior, or runtime integration.

## Bug Fixes

For a bug:

1. Read the exact error or reproduce the UI/runtime symptom.
2. Trace where the bad value or behavior enters the system.
3. Compare with a nearby working path.
4. Add a regression test when the behavior is testable.
5. Fix one root cause at a time.
6. Re-run the failing command first, then the relevant wider checks.

Do not infer K/D, event visibility, or playback timing from filtered event
counts. The state machine and `m.stats.*` rules in `AGENTS.md` are the source
of truth.

## Refactors And File Splits

Refactor only when it reduces real complexity or is needed for the requested
change.

Good low-risk splits:

- Pulling a self-contained GUI component out of `app.ts`.
- Moving shared DOM or formatting helpers into a focused module.
- Isolating tests around an existing behavior before changing it.

Avoid:

- Moving parser schema files without an ACLOS-version reason.
- Rebuilding the stable DOM skeleton in `app.ts`.
- Broad CSS rewrites while fixing a narrow UI issue.
- Removing dead code you did not make unless it is part of a verified warning
  or requested cleanup.

After a refactor, run at least:

```bash
bun run typecheck
bun run test
```

Run Rust tests too when Rust or IPC-facing shapes changed.

## GitHub Flow

`main` must stay releasable.

1. Work on a topic branch, usually `codex/<description>` for agent work.
2. Push the branch.
3. Open a Pull Request into `main`.
4. Wait for `.github/workflows/ci.yml` to pass on the PR.
5. Merge only after CI is green.

The PR CI workflow runs on `windows-latest` for pull requests targeting
`main`. It first detects changed areas and skips irrelevant heavy checks:

```bash
# Frontend / TypeScript / parser changes
bun install --frozen-lockfile
bun run typecheck
bun run test

# Rust / Tauri changes
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Workflow changes run both frontend and Rust checks so CI edits validate their
own behavior. Docs-only PRs may pass after checkout and path detection without
running either toolchain.

CI does not run again automatically on the post-merge `main` push. This keeps
normal PR merges from paying for the same full Windows/Tauri build twice. If a
manual confirmation of `main` is needed, start the CI workflow from GitHub
Actions. The manual CI trigger has a `full-build` option for running
`bun run build`; release tags still run the full release workflow
independently.

If CI fails, inspect the failing step logs before changing code. Fix the root
cause on the branch, push again, and let CI re-run.

## Release Workflow

Releases are produced by GitHub Actions from tags. Do not upload local builds
as the official release artifacts.

### Normal Release

1. Start from a clean branch off `main`.
2. Pick the semver bump from `VERSIONING.md`.
3. Run the version script:

```bash
bun run version:patch
# or
bun run version:minor
# or
bun run version:major
```

The script reads `src-tauri/tauri.conf.json`, updates version files, commits
`chore(release): vX.Y.Z`, and creates tag `vX.Y.Z`. It stages the whole
worktree, so use it only when the release branch contains exactly the intended
release changes.

4. Push the release branch and open a PR.
5. Wait for CI to pass.
6. Merge the PR into `main`.
7. Ensure the tag points at the merged `main` commit. If the tag was created
   before PR merge, move or recreate it intentionally before pushing.
8. Push the tag:

```bash
git push origin vX.Y.Z
```

`.github/workflows/release.yml` then runs the full validation/build sequence,
uploads the bundle artifact, and creates the GitHub Release.

### Manual 0.1.0-Style Release

Use this when the version files are already correct and only the tag is
missing:

```bash
git checkout main
git pull --ff-only
git status --short --branch
git tag -a vX.Y.Z -m "WonderfulUI X.Y.Z"
git push origin vX.Y.Z
```

Then watch the release workflow:

```bash
gh run list --workflow Release --limit 5
gh run watch <run-id> --interval 10 --exit-status
gh release view vX.Y.Z --json tagName,isDraft,isPrerelease,url,assets
```

A completed release must have:

- release workflow conclusion `success`
- a non-draft, non-prerelease GitHub Release unless intentionally marked
  otherwise
- `WonderfulUI_*_x64-setup.exe`
- `WonderfulUI_*_x64_en-US.msi`

## Local Verification Matrix

Choose the smallest set while iterating, but run the full relevant set before
opening or merging release-impacting PRs.

| Change | Minimum verification |
|---|---|
| Docs only | `git diff --check`, review links in diff |
| GUI TypeScript/CSS | `bun run typecheck`, `bun run test` |
| Parser TypeScript | `bun test packages/parser`, `bun run typecheck` |
| Rust parser/library/Tauri commands | `cargo test --manifest-path src-tauri/Cargo.toml --lib` |
| IPC shape shared by Rust and GUI | `bun run typecheck`, `bun run test`, Rust lib tests |
| Tauri config, packaging, release workflow | full CI command set plus `bun run build` |

`bun run build` produces local Windows bundles under:

```text
target/release/bundle/
```

Local bundles are useful for validation. Official release assets come from
GitHub Actions.

## Documentation Maintenance

Keep documentation layered:

- `AGENTS.md`: short rules, safety boundaries, current architecture, and links.
- `docs/ACLOS_FORMAT.md`: parser facts and ACLOS data semantics.
- `docs/ARCHITECTURE.md`: runtime, IPC, SQLite, build, and scaling facts.
- `docs/FRONTEND_CONVENTIONS.md`: GUI rendering, CSS, icons, player, tooltips.
- `docs/AGENT_WORKFLOW.md`: how agents should execute, verify, PR, and release.
- `CONTRIBUTING.md`: contributor-facing short version of branch, test, and
  release expectations.
- `VERSIONING.md`: semver and version-file rules.

If a new workflow becomes standard, update this file and link to the exact
workflow or command that proves it.
