# Update UI Dev Simulator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** DEV-only console API + optional localStorage boot hook so `bun run dev` can exercise UpdateModal without real releases.

**Architecture:** Extend `useUpdateStore` with a `debugSimulate` flag, fake download timer, and debug state helpers. Mount `window.__WUI_DEBUG_UPDATE__` from `utils/update-debug.ts` only when `import.meta.env.DEV`. Production never mounts the API or honors simulate localStorage.

**Tech Stack:** Vue 3, Pinia, Vitest + @pinia/testing, Vite `import.meta.env.DEV`

## Global Constraints

- Gate all simulator surface on `import.meta.env.DEV`
- Never call `downloadAndInstall` / `relaunch` on fake path
- Do not modify `tauri.conf.json` endpoints / pubkey / insecure flags
- `bun run scripts/check-versions.ts` must stay green
- Match existing UpdateModal / store patterns; no About-page buttons

---

### Task 1: Store debug simulate + fake download + tests

**Files:**
- Modify: `packages/gui/src/stores/update.ts`
- Modify: `packages/gui/test/UpdateModal.component.test.ts`

**Interfaces:**
- Produces: `debugSimulate: Ref<boolean>`, `debugAvailable(opts?)`, `debugUptodate()`, `debugError(kind)`, `debugDownloading(opts?)`, `debugInstalling()`, `debugProgress(downloaded, total)`, `playFakeDownload()`, `debugReset()`; `startUpdate`/`retry` honor `debugSimulate`

- [ ] **Step 1: Add failing tests** for debug play never calling check/relaunch; check-error retry becomes available under debug

- [ ] **Step 2: Implement store debug helpers + playFakeDownload (~1.5–2s, clear timer on reset)**

- [ ] **Step 3: Branch startUpdate/retry when debugSimulate**

- [ ] **Step 4: Run component tests — expect PASS**

```bash
bun run --cwd packages/gui test:components -- UpdateModal
```

- [ ] **Step 5: Commit** `feat(gui): add update store debug simulate path`

---

### Task 2: installUpdateDebug + App.vue + docs

**Files:**
- Create: `packages/gui/src/utils/update-debug.ts`
- Modify: `packages/gui/src/App.vue`
- Modify: `docs/UPDATER.md`

**Interfaces:**
- Consumes: store debug methods from Task 1
- Produces: `installUpdateDebug(getStore)`, `window.__WUI_DEBUG_UPDATE__`, boot skip real silent check when `wui:debug.simulateUpdate=1`

- [ ] **Step 1: implement update-debug.ts (no-op when !DEV)**

- [ ] **Step 2: wire App.vue onMounted + runBoot silent-check branch**

- [ ] **Step 3: document in UPDATER.md**

- [ ] **Step 4: run tests + check-versions**

```bash
bun run --cwd packages/gui test:components -- UpdateModal
bun run scripts/check-versions.ts
```

- [ ] **Step 5: Commit** `feat(gui): mount DEV update UI debug console API`

---

## Success criteria

- Console `__WUI_DEBUG_UPDATE__.available()` / `.play()` works under `bun run dev`
- Production path: no API when `!import.meta.env.DEV`
- Existing UpdateModal tests still pass; new debug tests pass
)
