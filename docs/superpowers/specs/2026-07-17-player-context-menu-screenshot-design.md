# Player Context Menu: Screenshot + Multi-Level Menu

**Date:** 2026-07-17  
**Status:** Approved for planning  
**Scope:** WonderfulUI video player right-click menu

## Goal

1. Capture the **current video frame only** (no chrome, markers, controls, or overlays).
2. Offer two destinations: **clipboard** (PNG image) and **save as PNG** via a system save dialog.
3. Upgrade the player context menu to a **grouped multi-level** pattern so screenshot is a flyout, not two flat rows that bloat the root menu.

## Non-goals

- Screenshot of the full player UI or WebView.
- JPEG / WebP / other formats.
- Annotation, crop, or batch export.
- Writing into ACLOS / game directories.
- Automatic cloud upload.

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| Capture content | `<video>` pixels only |
| Formats | PNG only |
| Save UX | System “Save As” dialog |
| Clipboard | Browser `ClipboardItem` with `image/png` (not plugin-clipboard-manager — image support is weaker) |
| Save path | `@tauri-apps/plugin-dialog` + `@tauri-apps/plugin-fs` |
| Menu IA | Grouped with separators; **Screenshot** is the only flyout in v1 |
| Plugins | Official Tauri 2 plugins for dialog + fs only |

## Menu information architecture

Root menu (top → bottom):

```
在系统播放器中打开
────────────────
在资源管理器中打开
复制视频路径
────────────────
截图 ▸
────────────────
快传
```

Screenshot submenu:

```
复制到剪贴板
保存为 PNG…
```

Rules:

- No grey section headers (native OS style: separators only).
- Parent “截图” shows a chevron (`▸` / Phosphor caret); not itself an action.
- Submenu opens on hover **or** keyboard focus + ArrowRight / Enter; closes on ArrowLeft / Escape (submenu first) / leave.
- Flyout prefers right of the parent item; flips left if it would overflow the viewport (or fullscreen element bounds).
- Disabled when capture is impossible (no video element, zero `videoWidth`/`videoHeight`, or known tainted canvas). Existing items keep current `disabled` when path missing.

## Multi-level menu behavior

Extend the existing context menu in `PlayerHost.vue` + `utils/context-menu.ts`:

| Concern | Behavior |
|---------|----------|
| Open / close root | Unchanged: mousedown capture button 0 outside, Esc (menu first), scroll, resize, fullscreenchange, video change, player close |
| Teleport | Still to `fullscreenElement` or `body` |
| Submenu mount | Sibling flyout panel (not nested scroll trap); same visual tokens as root (`.player-context-menu` surface) |
| Focus | Root opens → focus first enabled item; entering submenu focuses first child; leaving returns focus to parent |
| Click-through guard | Unchanged for stage `togglePlay` |
| Animation | Root keeps existing in/out; submenu may use a short opacity/translate (≤120 ms), no layout thrash |

Item model (conceptual):

```ts
type CtxMenuEntry =
  | { kind: 'item'; id: string; label: string; icon?: string; disabled?: boolean; action: () => void | Promise<void> }
  | { kind: 'separator' }
  | { kind: 'submenu'; id: string; label: string; icon?: string; disabled?: boolean; children: CtxMenuEntry[] };
```

## Capture pipeline

### 1. Frame extract (frontend)

Pure helper, e.g. `packages/gui/src/utils/capture-video-frame.ts`:

1. Read `<video>`: require `videoWidth > 0` and `videoHeight > 0`.
2. Create offscreen canvas at native video resolution (not CSS display size).
3. `ctx.drawImage(video, 0, 0, w, h)`.
4. `canvas.toBlob('image/png')` → `Blob`.
5. On SecurityError / empty blob → throw typed error for toast.

Do **not** draw overlays, event markers, or stage chrome.

### 2. Copy to clipboard

```ts
await navigator.clipboard.write([
  new ClipboardItem({ 'image/png': blob }),
]);
```

- Success toast: `已复制截图`
- Failure toast: `复制截图失败` (permission / unsupported)

Close the context menu before or after the async work; prefer close immediately on click so the menu does not stick during clipboard permission UI.

### 3. Save as PNG (plugins)

Dependencies:

- Rust: `tauri-plugin-dialog`, `tauri-plugin-fs`
- Frontend: `@tauri-apps/plugin-dialog`, `@tauri-apps/plugin-fs`
- Capabilities: allow dialog save + fs write for user-chosen path (Tauri 2 capability model; no broad `$HOME/**` unless required by the plugin)

Flow:

1. Build default file name (see below).
2. `save({ defaultPath: name, filters: [{ name: 'PNG', extensions: ['png'] }] })` → path or `null` (cancel).
3. Cancel → no toast (or silent).
4. Convert blob → `Uint8Array`.
5. `writeFile(path, bytes)` via plugin-fs.
6. Success toast: `已保存`
7. Failure toast: `保存截图失败: …`

### Default file name

Prefer:

```
{videoStem}_{mmss}.png
```

- `videoStem`: basename of local video path without extension; if missing, `精彩时刻`.
- `mmss`: floor of `currentTime` as `m:ss` with `:` replaced by `-` for filesystem safety, e.g. `1-05` for 65s → `clip_1-05.png`.

Sanitize Windows-illegal characters in the stem.

## State / edge cases

| Case | UX |
|------|-----|
| Video loading / no dimensions | Submenu parent disabled or children disabled + toast if activated |
| Ended / paused / playing | All allow capture of current decoded frame |
| User cancels Save As | No error toast |
| Fullscreen | Menu + flyout still Teleport into fullscreen element; save dialog is OS-level (OK) |
| Rapid re-entry | Ignore double-clicks while a capture promise is in flight (simple `capturing` flag) |

## Architecture boundaries

| Layer | Responsibility |
|-------|----------------|
| `capture-video-frame.ts` | Pure capture → Blob; unit-testable without Vue |
| `context-menu.ts` | Geometry helpers (existing + submenu flip/clamp) |
| `PlayerHost.vue` | Menu model, flyout UI, wire actions, toasts |
| Tauri plugins | Dialog + fs only; no new custom Rust commands required for v1 |
| Capabilities | Explicit allowlist for dialog/fs |

Do not put capture logic inside Pinia; player-local is enough.

## Testing

1. **Unit:** `capture-video-frame` with a mock video-like object / canvas path where possible; filename sanitizer; submenu placement clamp (extend `context-menu.test.ts`).
2. **Component:** menu renders separators + submenu chevron; disabled when no video; copy/save handlers invoked (mock clipboard + dialog + fs).
3. **Manual:** pause mid-clip → copy → paste into Paint/Discord; save → open PNG; fullscreen open menu + save; cancel save; right-click during loading.

## Docs to update after implementation

- `docs/FRONTEND_CONVENTIONS.md` — context menu section (items list, submenu rules, capture notes).
- `docs/ARCHITECTURE.md` — note dialog/fs plugins if the architecture inventory lists plugins.
- `CLAUDE.md` only if a durable pitfall appears (e.g. capability scope).

## Implementation order (for planning)

1. Add Tauri dialog + fs plugins and capabilities.
2. `capture-video-frame` helper + tests.
3. Refactor context menu item model to support separators + submenu.
4. Flyout UI + keyboard + geometry.
5. Wire copy + save actions + toasts.
6. Component tests + manual checklist.
7. Doc updates.

## Open points (none blocking)

None. Clipboard intentionally uses the Web API; save uses official plugins.
