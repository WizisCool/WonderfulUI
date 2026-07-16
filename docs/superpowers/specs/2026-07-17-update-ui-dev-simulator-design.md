# Update UI Dev Simulator

**Date:** 2026-07-17  
**Status:** Approved for planning  
**Scope:** DEV-only simulation of in-app updater UI for `bun run dev` / `tauri dev`

## Goal

When the running app is already the latest GitHub Release version, still allow developers to exercise:

1. Silent “update available” path (sidebar badge + toast, no auto-open modal)
2. Manual modal states: `available` / `checking` / `downloading` / `installing` / `error` / `uptodate`
3. Download progress with known `total` and indeterminate (`total === 0`)
4. Clicking **立即更新** runs a **fake** progress sequence without real download, install, or relaunch

Workflow stays the usual `bun run dev` loop — no version bump, no local `latest.json` server, no signing.

## Non-goals

- Real endpoint / signature / NSIS install integration testing (still covered by `docs/UPDATER.md` local-server notes)
- About-page permanent UI buttons
- Changing production `plugins.updater.endpoints` or pubkey
- Auto-closing the modal or calling `relaunch()` after fake install
- Browser-only debug runtime (`?debug=1`) as the primary target (nice-to-have if free; Tauri `bun run dev` is required)

## Hard constraint: production / CI correctness

These are non-negotiable:

| Rule | Mechanism |
|------|-----------|
| Zero behavior in release builds | All simulator code gated on `import.meta.env.DEV` (Vite); production `tauri build` / CI release must not mount APIs or read debug localStorage |
| No conf pollution | Do **not** change `src-tauri/tauri.conf.json` endpoints, `dangerousInsecureTransportProtocol`, or pubkey |
| CI version gate stays green | `bun run scripts/check-versions.ts` must continue to pass without special cases for this feature |
| No secret / key usage | Fake path never touches signing keys or GitHub tokens |
| No accidental relaunch | Fake `startUpdate` must never call `downloadAndInstall` or `relaunch` |
| Tree / runtime safety | Prefer a small `installUpdateDebug()` that no-ops when `!import.meta.env.DEV`; avoid leaving `window.__WUI_DEBUG_UPDATE__` in production bundles if easy (at minimum must be inert) |

Release verification (implementation plan must include):

```text
bun run scripts/check-versions.ts   → pass
# production-oriented build path already used by CI (e.g. bun run build / tauri build step)
# smoke: production GUI must not define window.__WUI_DEBUG_UPDATE__ or honor wui:debug.simulateUpdate
```

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| Primary entry | DEV boot always `debugAvailable({ silent: true })` — no localStorage |
| Optional console | `window.__WUI_DEBUG_UPDATE__` for play / error / reset |
| About-page button | No |
| Fake download | In-store timer / rAF; ~1.5–2 s; then `installing` + toast `[dev] 模拟完成，已跳过 relaunch` |
| Gate | `import.meta.env.DEV` only |
| Real plugin | Still used when not in debug simulation; simulator does not replace global `check()` forever unless a simulate flag is active |

## Console API

Mounted only in DEV:

```ts
window.__WUI_DEBUG_UPDATE__ = {
  /** status=available, badge=true; silent=true → toast only; silent=false → open modal */
  available(opts?: { version?: string; body?: string; silent?: boolean }): void
  uptodate(): void
  error(kind: 'check' | 'download'): void
  /** Enter downloading; total default large number; total=0 → indeterminate UI */
  downloading(opts?: { total?: number; downloaded?: number }): void
  installing(): void
  progress(downloaded: number, total: number): void
  /** available → fake download → installing; skip relaunch */
  play(): void
  /** idle; clear badge, modal, update, error, progress */
  reset(): void
}
```

Defaults for `available()`:

- `version`: `'9.9.9'`
- `body`: short Chinese notes suitable for modal rendering
- `silent`: `false` (open modal) for explicit console calls; boot localStorage path uses `silent: true`

## Store behavior

File: `packages/gui/src/stores/update.ts` (+ optional thin helper `packages/gui/src/utils/update-debug.ts`).

### Simulation flag

- When any debug API forces a simulated update path, set an internal `debugSimulate` (or equivalent) so the next `startUpdate()` / `retry()` (download branch) uses `playFakeDownload()` instead of plugin calls.
- `reset()` clears the flag and returns to normal plugin-backed `checkForUpdate`.
- Real `checkForUpdate(false/true)` while not in fake play remains plugin-backed (so “已是最新版本” still works for real checks).

### `playFakeDownload()`

1. If status is check-error without package info, behave like production: re-run check path is N/A for pure UI; `error('check')` retry may re-enter `error` or call real check — prefer: in debug, `retry` after `error('check')` can re-call `available()` or real check; simplest lock: **download errors → fake play; check errors → set available with fake package so UI can continue**, or re-`error('check')`.  
   **Locked simplest rule:**  
   - `errorKind === 'check'` → `retry()` sets a fake `available` + opens modal (no network).  
   - `errorKind === 'download'` or normal CTA → `playFakeDownload()`.
2. `status = downloading`, `modalOpen = true`, reset progress.
3. Animate progress for ~1.5–2 s:
   - Mode A: `total > 0` → pct rises to ~100
   - Mode B: if last `downloading({ total: 0 })` or play option — keep `total === 0` and bump `downloaded` only (indeterminate shimmer)
4. `status = installing`
5. Toast: `[dev] 模拟完成，已跳过 relaunch`
6. Do not call `relaunch()`, do not clear `update` immediately (user can dismiss), `badge` may clear on “install finished” to match production install success path (`badge = false` after successful downloadAndInstall).

### Boot hook

- After main UI is revealed (same window as existing silent `checkForUpdate(true)` in `App.vue`), if DEV and `localStorage wui:debug.simulateUpdate === '1'`, call silent `available` **instead of or after** real silent check.
- **Locked:** if simulate flag is on, **skip** real silent check (avoids toast race “已是最新” vs “发现新版本”). Manual “检查更新” still hits real plugin unless debug flag remains and we intercept — **locked:** localStorage flag only affects boot silent path; console `play`/`available` force simulation for subsequent install; manual about-page check stays real unless user called `available()` which sets `debugSimulate`.

## File plan

| File | Change |
|------|--------|
| `packages/gui/src/utils/update-debug.ts` | `installUpdateDebug(getStore)` — mount API, localStorage helper; no-op when `!import.meta.env.DEV` |
| `packages/gui/src/stores/update.ts` | Export helpers or accept external state sets; `playFakeDownload`; debug-aware `startUpdate`/`retry` |
| `packages/gui/src/App.vue` | Call `installUpdateDebug(() => useUpdateStore())` once on mount (DEV-safe) |
| `docs/UPDATER.md` | Short “DEV UI 调试” section pointing at console API + localStorage |
| Tests | Unit/component: fake play reaches `installing` without calling mocked `check`/`relaunch`; DEV guard smoke if practical |

## Usage (developer)

```bash
bun run dev
```

DevTools console:

```js
__WUI_DEBUG_UPDATE__.available()           // open modal
__WUI_DEBUG_UPDATE__.available({ silent: true })
__WUI_DEBUG_UPDATE__.play()                // fake download
__WUI_DEBUG_UPDATE__.downloading({ total: 0 })
__WUI_DEBUG_UPDATE__.error('download')
__WUI_DEBUG_UPDATE__.reset()
```

Optional persistence:

```js
localStorage.setItem('wui:debug.simulateUpdate', '1')  // next boot: badge + toast
localStorage.removeItem('wui:debug.simulateUpdate')
```

## Testing

1. Component / store tests (vitest): set simulated available → `startUpdate` → status `installing`; assert `downloadAndInstall` / `relaunch` mocks **not** called when `debugSimulate`.
2. Manual: `bun run dev` + console API through all states.
3. CI gate: `check-versions.ts` unchanged pass; no `tauri.conf` diff.
4. Production guard: with `import.meta.env.DEV === false`, `installUpdateDebug` is no-op; no global, no localStorage read for simulate on boot.

## Risks

| Risk | Mitigation |
|------|------------|
| Debug code ships and fakes updates for users | DEV-only gate + CI/prod smoke expectation |
| Silent boot double-toast with real check | Skip real silent check when simulate localStorage set |
| Fake play stuck if timer not cleared | Clear interval/rAF on `reset` / unmount |
| Confusing “已是最新” after fake available | Document that about-page check is still real unless after `available()` sets simulate for install only |

## Success criteria

- [ ] Developer can open and walk update UI with only `bun run dev` + console
- [ ] `play()` never relaunches the app
- [ ] Production / GitHub release build path does not expose or honor the simulator
- [ ] `check-versions` and existing UpdateModal tests remain green
)
