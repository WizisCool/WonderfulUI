# Frontend Conventions

Last organized: 2026-06-21.

This document holds GUI implementation conventions that are too detailed for `AGENTS.md`. Follow `DESIGN.md` and `PRODUCT.md` first for product and visual intent.

## Rendering Model

- The app uses a stable DOM skeleton.
- `app.ts` builds `.app`, `.topbar`, `.panes`, and the pane containers once after load.
- State changes use targeted refresh helpers for accounts, filters, match list, and detail.
- Do not reintroduce `root.innerHTML = ''` or whole-`#app` rebuilds for ordinary interactions.
- If a scrollable subtree must be rebuilt, preserve that subtree's `scrollTop`.

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

- Use `packages/gui/src/render-pulse.ts` when a user-triggered CSS animation
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
- Account drag sorting uses SortableJS on `.account-sortable-list` with `.account-grip` as the handle, not custom pointer math. Keep `__all__` outside that sortable container and fixed at the top, persist only real account ids, and use Sortable's forced fallback path in WebView2 so the dragged clone follows the pointer reliably. Style `chosen` / `ghost` / `drag` / `fallback` classes so users see both the grabbed row and its drop position while neighboring rows animate out of the way. Respect `prefers-reduced-motion`.

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
- One shared `.tooltip` is mounted on `document.body`, positioned via `@floating-ui/dom` (`packages/gui/src/floating.ts`).
- Show delay is `TOOLTIP_DELAY_MS`, currently 800 ms.
- Hide on `mouseleave`, `blur`, or window scroll (repositions rather than hiding on scroll when visible).
- **Smart placement**: floating-ui chooses the best side (top/bottom/left/right) based on viewport space.
- **Cursor tracking**: mousemove inside the target updates the tooltip's horizontal anchor to the mouse X. The tooltip does not follow vertically — keeps element-bound feel.
- **Arrow**: a `.floating-arrow` div (8×8 rotated square) is appended to the tooltip, positioned on the edge facing the anchor.
- **Entrance**: 80ms `cubic-bezier(0.16, 1, 0.3, 1)` scale+opacity (`@keyframes tooltip-in`). Hides with 50ms opacity transition.
- Respects `prefers-reduced-motion: reduce` (animation collapsed).
- **Event placement for markers**: when the progress track is near the viewport top (`MARKER_OVERHEAD_PX` threshold), markers flip to the `bottom` of the track with reversed stems.
- Color tokens: `--marker-kill`, `--marker-death`, `--marker-kill-bg`, `--marker-death-bg` etc. in `:root`.

## Settings Modal

- The top-right refresh icon is the fast path: it calls `scrape_library` with the user's saved refresh-button mode.
- The top-right settings icon opens a centered settings modal, not a side drawer.
- The settings modal exposes `扫描模式` as a two-option segmented control: `增量扫描` / `全量扫描`.
- The direct full scan action lives in the settings modal under `扫描设置` and calls `scrape_library` with `mode: "full"`.
- The `资料库` tab starts with `资料库概览`: three summary cells (`视频` / `对局` / `账户`) plus an ECharts donut chart showing per-account video-count share. It is a library composition view, not a storage/disk-usage view.
- The `资料库概览` chart is mounted by `packages/gui/src/library-stats.ts` into `ACCOUNT_VIDEO_CHART_HOST_ID`. Dispose the chart when the settings tab leaves `资料库` or the modal closes; do not leave hidden canvas instances around.
- Known handoff (2026-06-21): the ECharts donut hover tooltip can visually flicker during continuous mouse movement. Prefer official ECharts tooltip/emphasis/graphic options over custom tooltip implementations, click-only fallbacks, or disabling hover wholesale. Current investigation found that putting the fixed center total in the pie `series.label` makes it participate in slice hover state; keep fixed center totals in a static ECharts `graphic` layer instead. HTML tooltip placement over or near the donut may also interfere with hover hit testing; evaluate official `tooltip.position`, `confine`, and `renderMode` options without requiring Browser Skill-only workflows.
- Do not show recent scan history, "open library directory", or a manual refresh button in `资料库概览`. Scan history belongs in logs, and the top-right refresh button/settings full-scan action are the scan controls.
- Keep the settings modal as a scalable settings center: left section navigation, right content area, grouped setting rows.
- Do not keep placeholder-only settings pages. Only visible tabs should expose working functionality. Current tabs are `资料库` and `日志`.
- The `日志` tab reads from Tauri `get_log_status` and opens the WonderfulUI log directory through `reveal_logs_dir`; frontend code must not read arbitrary local files directly.
- The `日志` tab shows one app-owned log file only. Do not expose automatic maintenance as a user setting; it is backend behavior.
- Do not show the full absolute log path as primary UI. Show the log filename/status and rely on `打开目录` for filesystem location.
- The log preview should present timestamps in a human-readable local format and stay pinned to the latest lines after refresh.
- Settings tab changes replace only the internal nav/content regions. Do not remount the backdrop or modal on tab switch; open/close animation belongs only to the modal lifecycle.
- Keep the modal at a fixed desktop size so page changes do not resize the window. Small viewports may clamp via max-width/max-height.
- Escape and backdrop click close the modal; Tab focus must stay inside it while open.
- Settings modal z-index is 1300, above event modals (1100) and the player (1200). Toasts sit above it so scan feedback remains visible.
- Settings modal motion should stay quiet: short backdrop fade plus subtle translate/scale on the modal. Keep open/close around 120-170 ms and respect `prefers-reduced-motion`.

## Date Range Picker

- Date-range picker UI lives in `packages/gui/src/date-picker.ts` and is styled by the `.dr-*` block in `packages/gui/src/style.css`.
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

If a new scrollable surface is added, include it in the same scrollbar selector block in `style.css`.

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

Icons come from lucide, not Unicode codepoints.

- Import named icons such as `Play` or `Settings`.
- Use `createElement(icon, { width, height })` to create real SVG nodes.
- The `el()` helper treats string children as text, not HTML. Passing an SVG string renders literal markup.

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

- `player.ts` exports `openPlayer(video, onClose, seekMs?)` and `closePlayer()`. The optional `seekMs` is a millisecond offset into the video used when jumping to a specific event from the event list.
- `#player-host` is a sibling of `#app` in `index.html`.
- `app.ts` tracks `selectedVideo`.
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

Context menu:

- Fixed-position custom `.player-context-menu`.
- Items:
  - 在系统播放器中打开
  - 在资源管理器中打开
  - 复制视频路径
- Remove menu on outside click or Escape.

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

- **Stat card** (`app.ts:eventStatCell`): always shown in the detail pane.
  Shows total event count once rounds are loaded; spinner while loading.
  Becomes a `disabled` button if the match has no events.
- **List modal** (`event-list-modal.ts`): shows all kill/death events for the
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
- **Player** (`player.ts`): clicking a list row calls
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
- The event list dedupes across videos for the user's per-match view, but the
  progress bar is scoped to the currently playing video. It keeps accepted
  moment-video events visible even when the list's best playable duplicate is
  the montage video.
- Within one video, if ACLOS repeats the same accepted wall-clock shot in
  multiple clip rows, render one marker for that event. This is a display
  dedupe only; the parser still returns the raw rows.
- Default marker appearance is a compact small dot with a stem, not a visible
  lucide icon. The icon expands only on hover or keyboard focus. This keeps
  timelines readable while preserving the clickable target and tooltip.
- Marker stems must visually connect the dot to the progress track: start with
  a slight overlap under the dot and end with a slight overlap into the track.
  When multiple markers collide, later markers stack upward and lengthen their
  stems so all dots remain visible and connected.

The list modal **stays open** behind the player (player z-index 1200 >
list 1100). When the player closes, the list re-appears in its original
state — the user can click another row to watch a different event.

The single-event detail modal that used to live at
`packages/gui/src/event-modal.ts` was removed (2026-06-19). All event
metadata is now visible inline in the list modal rows: type chip, player
name, weapon (via `weaponNameOnly`), headshot / assist badges. No nested
detail modal — the row is the unit of detail.

## Weapons Module

`packages/gui/src/weapons.ts` is the single source of truth for weapon
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
  `packages/gui/src/generated/valorant-skins.zh-CN.ts`, generated from
  `https://valorant-api.com/v1/weapons/skins?language=zh-CN`.
- Refresh the dump with `bun run update:skins`. Runtime GUI code must use
  the committed dump only; do not fetch Valorant-API while the app is
  running.

When new weapon codes appear in ACLOS data, add them to `WEAPON_CN` —
do not write ad-hoc label logic in the player or modal code.
