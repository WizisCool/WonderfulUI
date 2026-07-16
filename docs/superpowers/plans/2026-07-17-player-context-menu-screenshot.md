# Player Context Menu Screenshot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add video-frame screenshot (clipboard + save PNG) and a multi-level player context menu with a Screenshot flyout.

**Architecture:** Pure frontend capture via `canvas.drawImage(video)` → PNG Blob. Clipboard uses `ClipboardItem`. Save uses `@tauri-apps/plugin-dialog` + `@tauri-apps/plugin-fs`. Context menu gains separators + one flyout submenu.

**Tech Stack:** Vue 3, Tauri 2, plugin-dialog, plugin-fs, bun:test, vitest.

## Global Constraints

- Capture **video frame only** (no chrome/markers).
- PNG only; system Save As for files.
- No ACLOS/game path writes beyond user-chosen save path.
- Match existing player context-menu close/teleport/a11y contracts.
- Spec: `docs/superpowers/specs/2026-07-17-player-context-menu-screenshot-design.md`

---

### Task 1: Tauri dialog + fs plugins

**Files:**
- Modify: `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src-tauri/capabilities/default.json`
- Modify: `packages/gui/package.json` (deps)
- Modify: `docs/ARCHITECTURE.md` (plugin list if present)

- [ ] Add `tauri-plugin-dialog` and `tauri-plugin-fs` to Cargo.toml; `.plugin(init())` in `lib.rs`.
- [ ] Frontend: `@tauri-apps/plugin-dialog` and `@tauri-apps/plugin-fs`.
- [ ] Capabilities: `dialog:allow-save`, `fs:allow-write-file`, fs scope allowing user-writable paths (`$HOME/**`, `$DOWNLOAD/**`, `$DESKTOP/**`, `$DOCUMENT/**`, `$PICTURE/**`, and `**` if required for arbitrary Save As).
- [ ] Commit: `chore: add tauri dialog and fs plugins for screenshot save`

### Task 2: Capture + filename helpers (TDD)

**Files:**
- Create: `packages/gui/src/utils/capture-video-frame.ts`
- Create: `packages/gui/test/capture-video-frame.test.ts`

**Produces:**
- `captureVideoFramePng(video: HTMLVideoElement): Promise<Blob>`
- `defaultScreenshotName(videoPath: string | null | undefined, currentTimeSec: number): string`
- `sanitizeFileStem(name: string): string`

- [ ] Failing tests for name sanitization / mmss formatting / empty dimensions error.
- [ ] Implement helpers.
- [ ] Commit: `feat(gui): capture video frame PNG helper`

### Task 3: Submenu geometry helpers (TDD)

**Files:**
- Modify: `packages/gui/src/utils/context-menu.ts`
- Modify: `packages/gui/test/context-menu.test.ts`

**Produces:**
- `placeSubmenu(parentRect: {x,y,width,height}, submenu: Size, viewport: Size, pad?: number): Point` — prefer right of parent, flip left, clamp.

- [ ] Tests for flip and clamp.
- [ ] Implement.
- [ ] Commit: `feat(gui): placeSubmenu geometry for context flyouts`

### Task 4: Multi-level context menu + screenshot actions

**Files:**
- Modify: `packages/gui/src/components/player/PlayerHost.vue`
- Modify: `packages/gui/scripts/extract-ph-icons.mjs`, `packages/gui/src/icons/ph-local.ts` (camera / caret)
- Modify: `packages/gui/test/PlayerHost.component.test.ts`
- Modify: `docs/FRONTEND_CONVENTIONS.md`

- [ ] Menu model: items + separators + screenshot submenu.
- [ ] Flyout UI, keyboard (→ enter submenu, ← leave, Esc submenu-first).
- [ ] Wire copy (ClipboardItem) + save (dialog + writeFile).
- [ ] Disable screenshot when frame capture impossible.
- [ ] Component tests for labels/separator/screenshot parent.
- [ ] Docs update.
- [ ] Commit: `feat(gui): player context screenshot submenu and multilevel menu`

---

## Spec coverage

| Spec requirement | Task |
|------------------|------|
| Video-frame-only capture | 2, 4 |
| Clipboard PNG | 4 |
| Save As PNG via plugins | 1, 4 |
| Grouped menu + Screenshot flyout | 4 |
| Geometry flip | 3 |
| Tests | 2, 3, 4 |
| Docs | 1, 4 |
