# Frontend Conventions

Last organized: 2026-06-22.

This document holds GUI implementation conventions that are too detailed for `AGENTS.md`. Follow `DESIGN.md` and `PRODUCT.md` first for product and visual intent.

## Rendering Model

- The app uses a stable DOM skeleton.
- `App.vue` builds `.app`, `.topbar`, `.panes`, and the pane containers once after load. State management is driven by 6 Pinia stores (`account`, `filter`, `detail`, `player`, `settings`, `ui`) and vue-router (`createMemoryHistory`).
- State changes are driven by reactive Pinia stores, not manual DOM helpers.
- Do not reintroduce `root.innerHTML = ''` or whole-`#app` rebuilds for ordinary interactions.
- If a scrollable subtree must be rebuilt, preserve that subtree's `scrollTop`.
- **Match list uses DOM virtual scrolling** (`useVirtualScroll` composable in `packages/gui/src/composables/useVirtualScroll.ts`): rows are `position: absolute` with `transform: translateY()`, a `.vlist-spacer` sets scrollable height, and a rAF-batched scroll handler rebuilds only the visible slice. `ROW_HEIGHT = 104` (96 px card + 8 px gap). Do not nest rows inside a separate wrapper — append them as direct siblings of the spacer inside `.match-list` (`position: relative`).
- Match rows lose their `display: flex` column layout in virtual scroll mode — spacing is controlled by `ROW_HEIGHT`. Changing `.match-row` `min-height` or `padding` requires adjusting `ROW_HEIGHT`.

### Desktop shortcuts (Windows habits)

Global shell shortcuts live in `utils/app-shortcuts.ts` + `composables/useAppShortcuts.ts` (mounted from `App.vue`). Keep pure matching unit-tested.

| Shortcut | Action |
|----------|--------|
| `Ctrl+W` | Close top UI layer (update → share → settings → player); if none, close the window |
| `Ctrl+Q` | Close the window |
| `Ctrl+,` | Open settings |
| `Ctrl+F` | Focus topbar search |
| `F5` / `Ctrl+R` | Library refresh (scan mode from settings); **not** webview reload |
| `Ctrl+Shift+R` | Not intercepted (devtools hard reload) |
| `F12` | DevTools (not intercepted) |
| `Alt+F4` | OS closes window |

While update is downloading/installing, `Ctrl+W` is a no-op (do not dismiss install). Layer Esc handlers stay component-owned.

**Close animation:** `Ctrl+W` / `Ctrl+Q` must not hard-clear layer state. Prefer `clickLayerCloseButton` on the real × control (player `doClose`, settings `setOpen(false)`, update `dismiss`, share close). Player fallback is `player.requestClose()` → `doClose()`, never `player.close()` from shortcuts.

### Match list selection + context menu

- **Toggle select:** left-click a selected row clears selection after a short delay (`selectMatch(null)` + route `home`); click another row selects it. **Double-click** shows detail only (does not open kill-montage player; cancels pending deselect). **Escape** also clears selection when no higher modal/menu is open.
- **Detail video cards:** double-click plays the video; right-click →「在资源管理器中打开」via `reveal_in_explorer` on that video's `video_src`.
- **Context menu** (Teleport body, `placeMenuNearCursor`, same dismiss rules as player menu):
  - Right-click **any match row** → select that row first (if needed), then only「打开对局文件夹」(`reveal_in_explorer` on `firstMatchVideoPath`).
  - Right-click **blank / empty list** → only「扫描资料库」(same as header refresh / current scan mode).
  - Outside left mousedown closes menu and arms click-through guard so that click does not toggle select.

### Match listbox keyboard / a11y (do not re-break)

The middle-column match list is a real **ARIA listbox** using the **`aria-activedescendant` pattern only**. Pure helpers live in `packages/gui/src/utils/match-listbox.ts` (unit-tested); HomeView wires them.

Hard rules:

1. **Focus stays on `.match-list`** (`tabindex="0"`). Never call `el.focus()` on a `MatchCard` / option. Virtual scroll unmounts off-screen rows; focusing a row will lose keyboard control when it leaves the buffer.
2. **Do not mix roving tabindex with activedescendant.** Options always have `tabindex="-1"`. The active option is tracked by `focusedId` and exposed as `aria-activedescendant={matchOptionId(focusedId)}` **only while the listbox is focused**.
3. **Every option needs a stable DOM `id`** via `matchOptionId(matches_id)` so activedescendant resolves. Do not invent ad-hoc ids in the component.
4. **Selection ≠ keyboard active.** `.is-selected` = detail selection (accent border only). `.is-focused` = keyboard-active ring, gated by **keyboard modality** (set on arrow/home/end/page; cleared on pointerdown/blur). Mouse click must **not** paint `.is-focused` — stacking an ink/pink ring on the accent border looked like a UI bug (double chrome).
5. **Do not seed `focusedId` to the first row on mount.** Start `null`. Reconcile with `reconcileFocusedId` when the filtered list changes (keep previous if still present, else selected match, else null).
6. **Enter / Space on the listbox activate `focusedId`.** Click also sets `focusedId` and re-focuses the listbox so arrows keep working.
7. Navigation math (arrows, Home/End, PageUp/Down, scroll reveal) must go through `nextListboxIndex` / `scrollTopToRevealIndex` — extend those helpers + their unit tests rather than inlining more switch cases in HomeView.

Regression suite: `packages/gui/test/match-listbox.test.ts` (pure) + `HomeView.component.test.ts` “listbox a11y” block.
- **First-run gate.** `App.vue` probes the ACLOS WonderfulDb directory via the `aclos_status` Tauri command at boot. When `dirExists` or `hasAccounts` is false, `App.vue` renders `OnboardingView` instead of the 3-pane shell (top bar, panes, settings modal all suppressed). The onboarding view exposes a "重新检测" button that re-runs the probe via the same `aclosStatus` store ref. The normal empty states inside `AccountSidebar` / `HomeView` / `DetailView` only render in the edge case where ACLOS exists but is empty (e.g. user logged in but has no matches yet) — they point at ACLOS as the data source rather than dumping raw paths.

Whole-app rebuilds break input focus, date-picker anchors, scroll position, and replay/player state.

## Tauri Adapter and Browser Debug

- Frontend code must import `invoke`, `convertFileSrc`, and `listen` from
  `packages/gui/src/tauri-adapter.ts`, not directly from `@tauri-apps/api/*`.
- In the Tauri shell, the adapter delegates to real Tauri APIs.
- In a normal browser, or when the URL includes `?debug=1`, the adapter serves
  a fixed browser-debug fixture for accounts, matches, library stats, logs,
  asset cache calls, and safe fake video paths.
- Use `bun run dev:browser` and open `http://localhost:1420/?debug=1` for
  Browser Skill UI debugging. This path is for DOM/CSS/canvas/motion bugs; it
  does not validate parser behavior, SQLite scraping, or real ACLOS data.
- If a new Tauri command is consumed by the GUI, add a mock branch to the
  adapter or make the caller degrade gracefully in browser debug mode.

## Animation Compatibility

- `@vueuse/motion` (v-motion directive, MotionPlugin) is used for entrance animations in the settings modal. Directed, staggered animations in non-primary surfaces are acceptable; do not use motion directives on main workflow elements.
- Use `packages/gui/src/utils/render-pulse.ts` when a user-triggered CSS animation
  or transition must run next to a static canvas surface. This keeps WebView2
  painting for the short duration of the motion without leaving a permanent
  animation loop active.
- Keep calls at interaction boundaries such as opening/closing overlays,
  changing chart modes, and restarting filtered-list motion. Do not scatter
  ad hoc `requestAnimationFrame` loops through component code.

## Component Listeners

Component-owned `document` or `window` listeners must be disposed when their owner leaves the DOM.

Use the pattern from `date-picker.ts`:

- Register the listener while mounted.
- Use a `MutationObserver` or equivalent ownership check.
- Remove resize, scroll, key, or document listeners when the trigger/root is removed.

## Account Sentinel

`ALL_ACCOUNTS = '__all__'` is a synthetic sentinel, not a real account.

- The account list renders it as `全部` with a separator.
- `matchesForAccount()` returns full unfiltered `state.data.matches` for this sentinel.
- Any code that iterates real accounts or filters by `openID` must skip or special-case the sentinel.
- It is fixed at the top of the account pane. Drag sorting and manual rename apply only to real accounts.
- Manual account display names come from SQLite `account_preferences.custom_name` (`customName` over IPC) and override snapshot nick/tag only in WonderfulUI.
- Account drag sorting uses SortableJS on `.account-sortable-list` with `.account-grip` as the handle, not custom pointer math. Keep `__all__` outside that sortable container and fixed at the top, persist only real account ids, and use Sortable's forced fallback path in WebView2 so the dragged clone follows the pointer reliably. Style `chosen` / `ghost` / `drag` / `fallback` classes so users see both the grabbed row and its drop position while neighboring rows animate out of the way.

## Match and Detail Semantics

- Middle column title is `对局列表`, not `高光时刻`.
- `高光时刻` is still correct inside the detail pane for moment-card groups.
- Date-range end dates are inclusive through the selected day using `23:59:59.999` local time.
- `matchRow` third line is `视频 × N`, not the first video name.
- Match id is debug-only; expose it through tooltip text, not primary row layout.

Match row layout:

- Left column: 3 lines (hero, map, KDA) evenly stacked.
  - Line 1: **agent** (13px, `--w-medium`), usually `career.hero_name`.
  - Line 2: **map** (12px, `var(--ink-3)`), usually `career.map_name`.
  - Line 3: **KDA** (12px, `var(--ink-2)`, `--w-medium`), format `kills/deaths/assists`.
- Right column: 3 chips stacked, each aligned to the three left lines.
  - Line 1: **result pill** (`W 13:9` / `L 7:13`), colored with `--win`/`--loss`.
  - Line 2: **mode chip** (`竞技模式` / `极速模式`), pill with game-mode icon.
  - Line 3: **video chip** (`▶ × N`), same pill style as mode chip.
- Footer: **time + account label** (11px, `var(--ink-3)`), below the three lines.
- `match-meta` uses `gap: 2px` between lines; footer has `margin-top: 2px`.
- Video chip (`match-video-chip`) is a rounded pill matching `.match-mode` style
  (10px, `--surface-2` background, `--border-soft` border, 999px radius).
- Cover is 88×72; total row height is approximately 80px.

MVP/SVP badge:

- Small pill at top-left of the cover (`.cover-badge`, z-1, `pointer-events: none`).
- Shows `MVP` (gold background, `Crown` icon) or `SVP` (magenta-purple, `Medal` icon).
- Only rendered when `snapshot<openid>` has `ss_achieve_type === "mvp" | "svp"`.
- Never shown as placeholder; silently absent when data is missing.
- Sourced from `parseSnapshotDbBuffer` → `AccountSnapshot.achievements[]`, folded
  into `matchAchievements` Map keyed by `matches_id` after `scan_all`.

Detail stats layout:

- 3 x 2 card grid.
- Row 1: 击杀 / 死亡 / 助攻.
- Row 2: KDA / 得分 in a `stat-row2` sub-grid.
- `kdaRatio(m)` computes `(kills + assists) / deaths` to two decimal places.
- Stat tones:
  - 击杀: `--win`
  - 死亡: `--loss`
  - 助攻: `--warn`
  - KDA: win when `>= 1.5`, loss when `<= 0.8`, otherwise neutral
  - 得分: neutral

## Video Cards

- Detail pane montage cards and moment cards share structure and CSS.
- `.montage-card` and `.moment-card` are both `position: relative`.
- Play buttons share the `.btn-play` styling.
- Card title text should ellipsize.
- The original `videos[0].video_poster` is used for detail video cards.
- Match rows use map image + hero head icon instead of video poster.

Moment grouping:

- `MONTAGE_TYPES = { 击杀集锦, 死亡集锦 }`.
- Every other `video_type` is a moment type.
- New ACLOS moment types should automatically appear as filter chips.

## Visual Source Fields

Use `career.*` for most UI text and images:

- `career.hero_name`
- `career.map_name`
- `career.game_mode`
- `career.hero_image`
- `career.map_image`
- `career.game_mode_icon`

Fallbacks are documented in `docs/ACLOS_FORMAT.md`.

## Asset Cache

Remote career assets (hero heads, map splash art, game-mode icons) are lazily
cached in a unified system, not bundled.

- Frontend collects unique `career.hero_image`, `career.map_image`, and
  `career.game_mode_icon` URLs after `scan_all`, then calls `cache_assets`
  in a single bulk invocation.
- Rust stores files in `%LOCALAPPDATA%\wonderful-ui\assets\{kind}\`,
  keyed by SHA256 of each URL. SQLite `assets` table tracks every entry.
- Frontend maps remote URLs to local paths with a shared `assetPathCache`
  `Map<string, string>`, serving them through `convertFileSrc`.
- After the async cache batch completes, visible panes refresh so
  placeholders turn into images.
- `cache_hero_image` is retained as a thin wrapper around `cache_asset`
  for backward compatibility.

Known CDN quirk: Miks `29.png` can be 4 MB because the CDN returns a
2048×2048 image.

## Tooltips

Account list uses a custom tooltip, not native `title=`.

- Use `data-tip` attribute with `\n` for multi-line; CSS uses `white-space: pre-line`.
- One shared `.tooltip` is mounted on `document.body`, positioned via `@floating-ui/dom` (`packages/gui/src/composables/useFloating.ts`).
- **Wiring is in `App.vue`**: delegated `mouseover`/`mouseout`/`mousemove` listeners on `document` read `[data-tip]` attributes and invoke `useTooltip()`. Components only set `data-tip` on their DOM elements; no directive or per-component binding required.
- **First-show alignment**: create the tooltip element in `onMounted` (not lazily). Before first `computePosition`, apply `.is-measuring` (laid out, no animation transform), force layout (`offsetWidth`), await `document.fonts.ready` if fonts are still loading, then place. After becoming visible, re-place on a double `rAF`. Track cursor X during the 800ms delay via `trackCursor` so reveal uses the latest mouse X, not the stale `mouseover` coordinate.
- `relatedTarget` checks prevent re-triggering when the mouse moves between descendants of the same `[data-tip]` element.
- Show delay is `TOOLTIP_DELAY_MS`, currently 800 ms.
- Hide on `mouseleave`, `blur`, or window scroll (repositions rather than hiding on scroll when visible).
- **Smart placement**: floating-ui chooses the best side (top/bottom/left/right) based on viewport space.
- **Cursor tracking**: mousemove inside the target updates the tooltip's horizontal anchor to the mouse X. The tooltip does not follow vertically — keeps element-bound feel.
- **Arrow**: a `.floating-arrow` div (8×8 rotated square) is appended to the tooltip, positioned on the edge facing the anchor.
- **Entrance**: 80ms `cubic-bezier(0.16, 1, 0.3, 1)` scale+opacity (`@keyframes tooltip-in`). Hides with 50ms opacity transition.
- **Event placement for markers**: when the progress track is near the viewport top (`MARKER_OVERHEAD_PX` threshold), markers flip to the `bottom` of the track with reversed stems.
- Color tokens: `--marker-kill`, `--marker-death`, `--marker-kill-bg`, `--marker-death-bg` etc. in `:root`.

## Settings Modal

- The match-list header refresh icon is the fast path: it calls `scrape_library` with the user's saved refresh-button mode.
- The sidebar-bottom settings button opens a centered settings modal, not a side drawer.
- The settings modal exposes `扫描模式` as a two-option segmented control: `增量扫描` / `全量扫描`.
- The direct full scan action lives in the settings modal under `扫描设置` and calls `scrape_library` with `mode: "full"`.
- The `资料库` tab starts with `资料库概览`: three summary cells (`视频` / `对局` / `账户`) plus a donut chart of per-account share. It is a library composition view, not a storage/disk-usage view.
- **Settings charts stack:** Apache ECharts + `vue-echarts` (not hand-rolled SVG, not imperative `echarts.init` singletons).
  - Register modules once in `packages/gui/src/charts/register.ts` (pie/bar/line + grid/tooltip/legend/dataset/dataZoom already registered for future settings widgets).
  - Pure option builders live next to data helpers (`buildAccountShareChartOption` in `library-stats.ts`). Keep them free of DOM instances so `bun test` can cover them.
  - UI shell: `AccountShareChart.vue` — `<VChart autoresize :option="…" />` with a **sibling** center overlay for totals (never pie `series.label`, which joins hover state).
  - Tab switches / modal close unmount the component; `vue-echarts` disposes the instance. Do not reintroduce module-level chart handles.
  - Prefer extending ECharts options (bar for scan history, line for trends) over adding a second chart library.
  - **Pie motion:** quiet enter (`animationType: 'expansion'`, ~480ms) + short hover state (~180ms). Subtle `emphasis.scale` is OK with **`scaleSize ≤ 4`** if tooltip stays `pointer-events:none`, `enterable: false`, short `transitionDuration`, and tip parked off the wedge. Sibling dim: `focus: 'self'` + `blur.opacity ≈ 0.55`. Keep center totals as Vue overlay (keyed on metric for a soft re-fade).
  - **Canvas color space:** ECharts draws with Canvas2D. Do **not** pass `oklch(...)`, `color-mix(...)`, or unresolved CSS variables into `option.color` / `itemStyle`. WebView2 may paint those as transparent (huge “missing” slice that still tooltips). Use hex/rgb palette (`CHART_PALETTE`) and canvas-safe token resolution.
- Do not show recent scan history, "open library directory", or a manual refresh button in `资料库概览`. Scan history belongs in logs, and the match-list header refresh button / settings full-scan action are the scan controls.
- Keep the settings modal as a scalable settings center: left section navigation, right content area, grouped setting rows.
- Do not keep placeholder-only settings pages. Only visible tabs should expose working functionality. Current tabs are `资料库`, `日志`, and `关于`.
- The `日志` tab reads from Tauri `get_log_status` and opens the WonderfulUI log directory through `reveal_logs_dir`; frontend code must not read arbitrary local files directly.
- The `日志` tab shows one app-owned log file only. Do not expose automatic maintenance as a user setting; it is backend behavior.
- Do not show the full absolute log path as primary UI. Show the log filename/status and rely on `打开目录` for filesystem location.
- The log preview should present timestamps in a human-readable local format and stay pinned to the latest lines after refresh.
- Settings tab changes replace only the internal nav/content regions. Do not remount the backdrop or modal on tab switch; open/close animation belongs only to the modal lifecycle.
- Keep the modal at a fixed desktop size so page changes do not resize the window. Small viewports may clamp via max-width/max-height.
- Escape and backdrop click close the modal; Tab focus must stay inside it while open.
- Settings modal z-index is 1300, above event modals (1100) and the player (1200). Toasts sit above it so scan feedback remains visible.
- Settings modal motion should stay quiet: short backdrop fade plus subtle translate/scale on the modal. Keep open/close around 120-170 ms.

## Share ("快传") Modal

- **Abstract platform layer** at `packages/gui/src/utils/share/`: `SharePlatform` interface, registry map, `openShareMenu` / `listAvailablePlatforms`. Each platform is one self-contained module under `platforms/`. Currently only `win32-share-sheet` (placeholder; production platform is the in-app `lan-qr` flow which doesn't go through the share abstract — see below).
- **Production share path = LAN QR ("快传")**: instead of the `SharePlatform` interface, the player toolbar's `share` event opens `ShareModal` directly. Rust side runs an embedded `tiny_http` server (see ARCHITECTURE.md). The modal owns the server lifecycle — server starts on `onMounted`, stops on `onUnmounted` (so closing × / Esc / backdrop all guarantee the port is released).
- **Modal layout (极简)**: title `快传` + 240×240 QR (Rust-rendered circles, `EcLevel::H`, click-to-copy) + a single status row `<size> · <dot><status text>` + 6 px progress bar matching `.boot-progress` (indeterminate shimmer while waiting, `scaleX(0→1)` on completion). No "复制链接" button — the QR is the button.
- **Status states** (Rust-side event `wui://share_downloaded` is the only source of truth):
  - `downloadCount === 0` → gray dot, "等待扫码", progress bar indeterminate shimmer
  - `downloadCount >= 1` → red dot (with same pulse animation but wider halo), "下载完成", progress bar `scaleX(1)`
  - The dot is red **only after** `req.respond()` returns `Ok(())` — i.e. after the file actually streamed to the client. WeChat scanning a URL that only previews without downloading does NOT trigger the "下载完成" state (BrokenPipe mid-stream → `respond()` errors → count stays 0). This is by design.
- **Server lifecycle**:
  - Modal `onMounted` → `share.start(videoPath)` → Rust starts HTTP server
  - Modal `onUnmounted` → `share.stop()` → Rust stops server
  - 3-minute idle timeout is the **only** auto-shutdown path (safety net for "user opened modal then forgot"). NOT "close after first download" — the user controls when to close.
- **Close paths** (all route to `share.stop()` via `onUnmounted`):
  - Click the `×` in the top-right corner
  - Press `Escape` (capture-phase keydown listener, `preventDefault` + `stopPropagation` so it doesn't conflict with PlayerHost's own Esc handling)
  - Click the backdrop (outside the card)
- **Client logging**: all key transitions call `clientLog(level, 'share-modal', message)` which forwards to Rust `log_event` → `app_log` → `wonderful-ui.log`. Browser / test environments fall back to `console.*` automatically (no `invoke` thrown on missing Tauri runtime).
- **Animation vocabulary** (must match Settings modal):
  - Backdrop: `oklch(0 0 0 / 0.66)`, `150ms ease-out` in / `120ms ease-in` out
  - Card: `170ms cubic-bezier(0.16, 1, 0.3, 1)`, `scale(0.96→1) translateY(8→0)` in; reverse on close
  - Status dot pulse: `1.2s ease-in-out infinite`, keyframe drives both `box-shadow` halo size and `transform: scale()` for a subtle breathing effect
  - Progress bar shimmer: `1.6s cubic-bezier(0.4, 0, 0.2, 1) infinite`, `translateX(-100% → 250%)` — never animates `width`
  - Motion is app-owned (not gated on OS `prefers-reduced-motion`)

## Date Range Picker

- Date-range picker UI lives in `packages/gui/src/utils/date-picker.ts` (pure logic) with a Vue wrapper in `packages/gui/src/components/match/DateRangePicker.vue`, styled by the `.dr-*` block in `packages/gui/src/assets/style.css`.
- It is a filter-rail control, not a modal or standalone calendar card. Keep it visually aligned with filter chips and numeric inputs: low elevation, token colors, no decorative shadow, no red top border.
- Date clicks update an internal draft only. The applied filter must change only when the user clicks `完成`.
- The trigger clear button may clear the already-applied date filter immediately. The popover `清除` button clears only the draft until `完成` is clicked.
- Selecting a single date and then clicking `完成` applies that one day as both start and end; the end timestamp remains inclusive through `23:59:59.999` local time.
- Calendar day numbers must be real child elements above range backgrounds. Do not place raw text directly under `.dr-day` if the day uses pseudo-element range fills.

## Scrollbars

Dark themed scrollbars must be applied to the actual scroll container.

Known scrollable surfaces:

- `.match-list`
- `.account-list`
- `.detail-scroll`
- `.detail-videos`
- `.settings-content`

If a new scrollable surface is added, include it in the same scrollbar selector block in `assets/style.css`.

## Text, Fonts, and Icons

- The UI uses MiSans from `dsrkafuu/misans`.
- Font files live under `packages/gui/public/fonts/misans/`.
- `packages/gui/src/fonts.css` owns `@font-face`.
- Use font-weight tokens:
  - `--w-medium: 380`
  - `--w-semibold: 520`
  - `--w-bold: 630`
- Do not use raw `500` / `600` unless there is a specific reason.

Chinese UI labels must use `--font-sans`, not `--font-mono`.

Known labels that must stay sans:

- `.match-map`
- `.match-mode`
- `.match-account`
- `.match-result-pill`
- `.pane-sub`
- `.moment-chip`

Only pure Latin / digit / symbol elements should use `--font-mono`, such as `.match-time`, `.match-kda`, and `.match-sep-dot`.

Icons come from @iconify/vue (Phosphor set), via the shared `WIcon` wrapper at `packages/gui/src/components/common/WIcon.vue`.

- Import `WIcon` from `../common/WIcon.vue` (or appropriate relative path).
- Usage: `<WIcon icon="ph:play" :size="16" />` where `icon` is the full @iconify icon name and `size` maps to `width`/`height`.
- Do NOT import raw lucide icons or use `createElement()` for SVG icons.
- **Offline bundle (required for Tauri):** `main.ts` calls `registerAppIcons()` which loads a Phosphor subset from `packages/gui/src/icons/ph-local.ts` via `addCollection`. Without this, late-mounted UI (player controls, 快传 modal) fetches `api.iconify.design` and shows empty boxes when offline. When adding a new `ph:*` icon, append its name to `scripts/extract-ph-icons.mjs` and run `bun run --cwd packages/gui icons:extract`.
- 快传 brand icon is always `SHARE_ICON` (`ph:share-network`) from `packages/gui/src/share/icons.ts`.
- Do NOT use Unicode symbol glyphs for controls.

Brand lockup:

- The topbar brand uses `packages/gui/src/assets/logo.svg` as a 36 px app logo, not a text-only `W` glyph.
- Keep the logo and wordmark as one lockup: `.brand` gap is 8 px, with `Wonderful` in primary ink and `UI` in the red accent.
- The same SVG is the browser favicon; Tauri bundle icons are generated from the same visual mark.

## Match Cover

The match-row cover is map image + hero head icon:

- 88 x 72 cover.
- `career.map_image` is the full-bleed background.
- `career.hero_image` is a 36 px circular badge at bottom-right.
- Use a radial gradient under the badge so the icon feels anchored.
- Badge shadows should be warm-tinted, not pure black.

Preferred shadow tint: hue around 30, chroma around 0.01.

## Player Portal

The built-in video player lives in `#player-host`, not inside `#app`.

- Player state is managed by `stores/player.ts` (Pinia store) and rendered by `components/player/PlayerHost.vue`. The store exposes `openPlayer(video, onClose, seekMs?)` and `closePlayer()` actions. The optional `seekMs` is a millisecond offset into the video used when jumping to a specific event from the event list.
- `#player-host` is a sibling of `#app` in `index.html`.
- The player store (`stores/player.ts`) tracks `selectedVideo`.
- Targeted refresh helpers return early while a video is selected.
- Do not manage player state inside the normal app refresh flow.
- The player `.player-backdrop` sits at z-index 1200, above the event-list modal (1100) — so jumping from the list leaves the list visible behind the player and re-shows when the player closes.

Player visual rules:

- No `backdrop-filter: blur()` on the backdrop.
- No modal `box-shadow`.
- Controls bar uses a gradient overlay, not backdrop blur.
- `ctrl-btn` is the player icon button class; keep it distinct from `.iconbtn`.

Player controls:

- Auto-hide after 3 seconds.
- Cancel auto-hide on pause, hover, or ended.
- Toggle visibility with `.is-hidden`.
- Keyboard handler uses capture phase: `document.addEventListener('keydown', handler, true)`.
- Escape first exits fullscreen, second closes the modal.
- Fullscreen is requested on `.player-modal`, not on the `<video>` element.
- Exit fullscreen before removing the player from DOM.

Player state machine:

- Player runtime state is a single `PlayerState` (`loading` / `playing` / `paused` / `buffering` / `ended` / `error`) in `PlayerHost.vue`; avoid reintroducing overlapping booleans such as `isBuffering` or `isInitialLoad`.
- Visual flags (`showLoading`, `showSpinner`, `showFrameStepper`, `showReplay`, `controlsPlaying`) are derived from state plus `bufferingMode`.
- `waiting` while `playing` starts a 300 ms debounce before entering `buffering`; `canplay`, `play`, `pause`, `ended`, `error`, close, and reopening must clear that pending timer.
- If `canplay` arrives before the debounce fires, keep the current state and cancel pending buffering. Do not let a stale timer switch the player into `buffering` afterward.
- `seeking` records `lastSeekTime` and the pre-seek state but does not directly show loading. Fast local/NAS seeks should not flash a spinner or overlay.
- `bufferingMode` is `dim-overlay` for seek-triggered waits and `spinner` for natural playback stalls.
- Reset `lastBufferedPct` and `bufferingMode` whenever a new video opens so a previous video's buffered bar or loading mode cannot animate into the next video.

Progress bar:

- Thumb positioning uses `left: X%` (relative to parent track), not `translate(calc(X% - 50%), -50%)` — CSS `translate()` percentages are relative to the element's own 8 px width, which collapses the offset to near zero.
- `lastBufferedPct` must be a `ref`; a plain `let` is invisible to Vue's reactivity and the buffered bar will never update.
- Event marker container uses `.closest('.player-event-marker, .player-event-markers.is-canvas')` check in `onMouseDown` instead of `@mousedown.stop`. Adding `@mousedown.stop` on the container breaks track-seeking in canvas mode because `.is-canvas` has `pointer-events: auto`.
- `CANVAS_MARKER_THRESHOLD = Infinity` (permanently disables canvas mode; see AGENTS.md for rationale).

Controls click propagation:

- `.player-controls` has `@click.stop` to prevent clicks on the controls bar (volume slider, progress track, time text, gaps between buttons) from bubbling to `.player-stage`'s `togglePlay`.
- Individual controls buttons have their own `@click.stop`.

Frame stepper (top-left expand dock):

- Shown only while `state === 'paused'` (via `deriveUI.showFrameStepper`).
- **Single top-left dock** matching player chrome (`oklch(0 0 0 / 0.45)` like `.player-close-top`, `ctrl-btn` children). Not in the control bar (layout shift); not edge carets / center cluster / skip icons (those read as prev/next track).
- **Default collapsed.** Toggle is `ph:film-strip` +「逐帧」. Expand reveals mono `−1` / `+1` in the same shell via `grid-template-columns: 0fr→1fr` + opacity (no remount). Default closed resets each player open / when leaving pause.
- Hold `−1`/`+1` (pointerdown ≥320ms) continuous frame-step **paced by `seeked`** (never flood `currentTime` before the previous seek settles). Cap ~15 Hz; intentional target time accumulates so async lag does not skip/double frames. UI `currentTime` updates only on seeked during hold.
- **No keyboard race:** step buttons are `tabindex="-1"` and blur on pointerdown (Space must not activate them). Any player hotkey calls `stopFrameHold()` before handling so pointer hold never stacks with J/K/Space/arrows.
- Keyboard J/K works whether expanded or collapsed. `@pointerdown.stop` so stage play-toggle is not fired.

Loading overlay:

- Visibility uses `opacity: 0; pointer-events: none` instead of `display: none`. The element stays in the render tree so showing it during seek is instantaneous (no layout flash).
- Seek-induced frame gaps are covered by `.player-video { background-color: #000 }`, not by the loading overlay. No JS timing involved.

Context menu (`PlayerHost.vue` + pure helpers in `utils/context-menu.ts`):

- Fixed-position `.player-context-menu`, **Teleported** to `document.fullscreenElement` when fullscreen, otherwise `body` (menu must not stay a sibling of the fullscreen modal — it would be invisible).
- Grouped with separators (no section titles): 系统播放器 · 资源管理器 / 复制路径 · **截图 ▸** · 快传.
- **截图** flyout: 复制到剪贴板 / 保存为 PNG… — nested absolute panel, edge-overlap with root (not a floating card). Flip left when overflowing. Close on leave parent+flyout, hover other root items, Esc (flyout first).
- Screenshot (Windows only): `capture_video_frame(path, timeMs)` → MF SourceReader → PNG. Clipboard: `ClipboardItem`. Save: dialog + `plugin-fs`.
- Screenshot UX (copy/save): real `paused` + stage freeze canvas (HW video collapsed) → progress overlay → native capture → resume if was playing. Hold blocks autoplay/hotkeys; pins scrubber.
- Player video: `convertFileSrc` (asset protocol).
- Failures toast like the toolbar (`play_video` / `reveal_in_explorer` / clipboard / screenshot).
- Position via `placeMenuNearCursor` (flip + clamp to viewport). Re-measure after open (`offsetWidth/Height`). Submenu geometry helper: `placeSubmenu`.
- Close on: left mousedown outside, Escape (**menu first**, not the player), scroll, resize, fullscreenchange, video change, player close.
- **Dismiss ≠ activate (click-through):** OS menus and major players treat the left-click that closes a context menu as dismiss-only. After outside `mousedown` closes the menu, arm a one-shot capture `click` killer + a short `suppressStageClickUntil` window so `.player-stage` does **not** `togglePlay` on that same gesture. Esc/scroll/resize closes do not need the guard.
- **Animation**: `player-ctxmenu-in` 160 ms / `player-ctxmenu-out` 120 ms; `v-show` + `is-closing`; `animationend` filtered by `animationName === 'player-ctxmenu-out'`; 200 ms safety timeout.
- **Outside-click contract**: document `mousedown` capture + `e.button === 0` only (never `click` — right-click race). Bind/unbind via a single `ctxMenuListenersBound` flag (idempotent; re-open must not stack listeners).
- Light a11y: `role="menu"` / `menuitem`, focus first item on open, ↑↓/Home/End move focus.
- Pure geometry tests: `packages/gui/test/context-menu.test.ts`.

Volume:

- Track `preMuteVol`.
- Persist keys: `wui:player.vol` and `wui:player.muted`.
- Volume slider fill uses `var(--ink-2)`, not `var(--accent)`.

## Event Interaction Flow

The detail pane shows a 3rd stat cell "事件 N" (beside KDA / 得分). Clicking
it opens the per-match event list. The flow is **3 steps**, layered:

```
[Detail pane]                [List modal]                 [Player]
                click                                click row
  事件 14  ───────────────►  击杀 N · 阵亡 N  ──────►   openPlayer(
  (stat card)                  (table)                     video,
                                                            seekMs)
```

- **Stat card** (DetailView.vue): always shown in the detail pane.
  Shows total event count once rounds are loaded; spinner while loading.
  Becomes a `disabled` button if the match has no events.
- **List modal** (`EventListModal.vue`): shows all kill/death events for the
  match, sorted by `timeMs`. Header shows the **real** K/D from `m.stats.*`
  (not the event count — ACLOS highlights can include team kills, so the
  count is misleading). `normalizeMatchEvents` first runs each raw clip event
  through `event-state-machine.ts`; only accepted `montage` and `moment`
  states are visible. Quarantined or rejected rows must not produce list rows
  or progress-bar markers. The list is deduped on `(EventTime, victim)` /
  `(EventTime, killer)` to drop ACLOS's cross-video duplicates. Dedup must
  keep the best playable occurrence, not simply the first occurrence. Kills
  prefer `击杀集锦`; deaths prefer `死亡集锦`. When the victim/killer identity
  used for dedup is missing, `normalizeMatchEvents` falls back to a
  conservative composite key rather than merging every event in the same
  second.
- **Player** (`stores/player.ts` + `PlayerHost.vue`): clicking a list row calls
  `playVideoWithRounds(video, match, seekMs)` which ensures rounds are
  loaded and seeks the video to the accepted event state's millisecond
  offset. Montage videos use `event_sTime` directly; moment videos use
  `clip_sTime + event_sTime`. Do not recompute older
  `max(round_sTime, clip_sTime) + event_sTime` logic. Row click and
  progress-bar dot click both rewind `EVENT_PREROLL_MS` (2 s) before the
  event (`playbackSeekMsForVideo`), so users see the kill/death happen rather
  than the post-frame. The dot position on the bar stays at the exact event
  time for visual reference.

Progress-bar markers:

- Markers are presentation-only artifacts produced after the shared state
  machine accepts an event. `eventMarkersForVideo` must call
  `resolveClipEventState`; do not add a second event-validity state machine
  in the player or marker code.
- **DOM-only rendering**: `CANVAS_MARKER_THRESHOLD = Infinity` so markers always
  use DOM-based rendering (`.player-event-marker` divs with pseudo-elements).
  Canvas code (`renderCanvasMarkers`) is retained for future use if the threshold
  is lowered, but is unreachable in normal operation. See AGENTS.md for the
  historical rationale.
- The event list dedupes across videos for the user's per-match view, but the
  progress bar is scoped to the currently playing video. It keeps accepted
  moment-video events visible even when the list's best playable duplicate is
  the montage video.
- Within one video, if ACLOS repeats the same accepted wall-clock shot in
  multiple clip rows, render one marker for that event. This is a display
  dedupe only; the parser still returns the raw rows.
- Default marker appearance is a compact small dot with a stem, not a visible
  Phosphor icon. The icon expands only on hover or keyboard focus. This keeps
  timelines readable while preserving the clickable target and tooltip.
- Marker stems must visually connect the dot to the progress track: slight
  overlap under the dot, tip stops at the track top edge (no cut into the
  4px fill). When markers collide, later ones stack upward and lengthen stems.

The list modal **stays open** behind the player (player z-index 1200 >
list 1100). When the player closes, the list re-appears in its original
state — the user can click another row to watch a different event.

The single-event detail modal that used to live at
`packages/gui/src/event-modal.ts` was removed (2026-06-19). All event
metadata is now visible inline in the list modal rows: type chip, player
name, weapon (via `weaponNameOnly`), headshot / assist badges. No nested
detail modal — the row is the unit of detail.

## Weapons Module

`packages/gui/src/utils/weapons.ts` is the single source of truth for weapon
display names.

- `weaponNameOnly(path)` → "鬼魅" / "狂徒" / etc.
- `weaponLabel(path)` → "鬼魅 · 盖亚的复仇" / "狂徒 · 无畏契约GO！第二卷" (with skin)
- `WEAPON_CN` table maps ACLOS internal codes (`LugerPistol`, `AK`,
  `MP5`, `RevolverPistol`, …) to Valorant Chinese names.
- Weapon code parsing uses the longest known prefix. This matters for
  multi-part codes such as `AssaultRifle_ACR` (幻影) and
  `AssaultRifle_Burst` (獠犬), which must not be truncated to
  `AssaultRifle`.
- Skin names come from the committed local dump
  `packages/gui/src/utils/generated/valorant-skins.zh-CN.ts`, generated from
  `https://valorant-api.com/v1/weapons/skins?language=zh-CN`.
- Refresh the dump with `bun run update:skins`. Runtime GUI code must use
  the committed dump only; do not fetch Valorant-API while the app is
  running.

When new weapon codes appear in ACLOS data, add them to `WEAPON_CN` —
do not write ad-hoc label logic in the player or modal code.
