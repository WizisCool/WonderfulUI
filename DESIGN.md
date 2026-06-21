---
name: WonderfulUI
description: Offline Valorant highlights browser — dark, private, native-feeling.
colors:
  signal-red: oklch(0.62 0.21 25)
  signal-red-bright: oklch(0.68 0.22 25)
  ember: oklch(0.30 0.06 25)
  ash-white: oklch(0.98 0.01 25)
  bunker: oklch(0.16 0.012 30)
  panel: oklch(0.19 0.012 30)
  panel-raised: oklch(0.22 0.014 30)
  panel-top: oklch(0.25 0.014 30)
  line: oklch(0.30 0.014 30)
  line-faint: oklch(0.26 0.012 30)
  field-white: oklch(0.94 0.01 30)
  dispatch-gray: oklch(0.78 0.012 30)
  intel-gray: oklch(0.58 0.014 30)
  shadow-gray: oklch(0.40 0.012 30)
  victory: oklch(0.72 0.16 145)
  victory-dim: oklch(0.28 0.06 145)
  defeat: oklch(0.66 0.18 25)
  defeat-dim: oklch(0.28 0.08 25)
  alert: oklch(0.78 0.14 75)
typography:
  body:
    fontFamily: "MiSans, MiSansLatin, Inter, system-ui, sans-serif"
    fontSize: 14px
    fontWeight: 330
    lineHeight: 1.5
  label:
    fontFamily: "MiSans, MiSansLatin, Inter, system-ui, sans-serif"
    fontSize: 13px
    fontWeight: 380
  mono:
    fontFamily: "JetBrains Mono, Cascadia Code, Consolas, Menlo, monospace"
    fontSize: 12px
    fontWeight: 450
rounded:
  sm: "3px"
  md: "6px"
  lg: "8px"
  xl: "10px"
  full: "999px"
spacing:
  gap: "4px"
  pad: "16px"
components:
  button-primary:
    backgroundColor: "{colors.signal-red}"
    textColor: "{colors.ash-white}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
    typography: label
  button-primary-hover:
    backgroundColor: "{colors.signal-red-bright}"
  button-ghost:
    backgroundColor: transparent
    textColor: "{colors.dispatch-gray}"
    rounded: "{rounded.md}"
    padding: "4px 10px"
  button-ghost-hover:
    backgroundColor: "{colors.panel-top}"
    textColor: "{colors.field-white}"
  chip:
    backgroundColor: "{colors.panel-raised}"
    textColor: "{colors.dispatch-gray}"
    rounded: "{rounded.full}"
    padding: "1px 7px"
  chip-active:
    backgroundColor: "{colors.ember}"
    textColor: "{colors.signal-red}"
  card:
    backgroundColor: "{colors.panel-raised}"
    rounded: "{rounded.md}"
    padding: "6px 8px 8px"
  card-hover:
    backgroundColor: "{colors.panel-raised}"
  stat-cell:
    backgroundColor: "{colors.panel-raised}"
    rounded: "{rounded.xl}"
    padding: "10px 6px"
  input:
    backgroundColor: "{colors.bunker}"
    textColor: "{colors.field-white}"
    rounded: "{rounded.md}"
    padding: "6px 10px"
---

# Design System: WonderfulUI

## 1. Overview

**Creative North Star: "The Battle Archive"**

WonderfulUI is a private Valorant highlights library. It feels like opening a personal dossier after the match: cool, composed, no fanfare. Every pixel serves the task of finding and replaying a moment — not decorating it.

The palette is deep warm dark, tinted a few degrees toward red. A single saturated accent (Signal Red, the Valorant red) marks selection, focus, and primary action. It appears on less than 8% of the surface; its rarity is the point. Neutral layers carry the structure: four surface depths distinguished purely by lightness, no shadows. The result reads as a dark-room archive, not a dashboard.

This system explicitly rejects AI-SaaS clichés (purple-blue gradients, glassmorphism defaults, hero-metric templates), Windows Explorer utilitarianism (gray panels, 8px grids, sharp borders), and Steam/Epic marketplace patterns (purchase buttons, ratings, wishlists). It also rejects decorative motion: transitions are short (80–100 ms), convey only state change, and collapse to instant under `prefers-reduced-motion`.

**Key Characteristics:**
- Dark warm-gray foundation with a single Valorant-red accent at ≤8% surface coverage.
- Flat tonal depth: four surface layers defined by lightness alone, no drop shadows on cards.
- Components feel tactile and confident — hover shifts are immediate (80 ms), focus rings are assertive (2px accent glow), every interactive surface responds without ambiguity.
- MiSans for Chinese/Latin body, JetBrains Mono for data (KDA, timestamps, pixel values). One type color per role.
- Native affordances only: OS scrollbars themed to the dark palette. Video playback uses the built-in WebView2 player with minimal modal chrome (tonal layers, no glassmorphism, no shadow). System player remains a right-click fallback.

## 2. Colors

A restrained warm-dark palette with one saturated anchor. All neutrals are tinted toward hue 30 (warm red-orange) at chroma 0.012–0.014 — enough to read as warm, not enough to read as brown.

### Primary
- **Signal Red** (oklch(0.62 0.21 25)): The sole accent. Used on the primary button, selected border, active chip, focus ring, and the brand logo underline / "UI" wordmark accent. Never used as decoration or at full saturation on inactive elements.
- **Signal Red Bright** (oklch(0.68 0.22 25)): Hover state for the accent. Lifted lightness and chroma by 0.06 / 0.01.
- **Ember** (oklch(0.30 0.06 25)): Muted accent background. Active chips, error toast backgrounds. Carries the red hue at low luminance so the accent reads forward.
- **Ash White** (oklch(0.98 0.01 25)): Text on accent backgrounds. Near-white, faintly warm.

### Neutral
- **Bunker** (oklch(0.16 0.012 30)): Page background. The deepest layer. Used on `body`, empty cover placeholders, search input background.
- **Panel** (oklch(0.19 0.012 30)): Primary surface. Panes, topbar, match rows at rest.
- **Panel Raised** (oklch(0.22 0.014 30)): Elevated surface. Hover states, selected rows, inactive chips, stat cells, montage/moment cards.
- **Panel Top** (oklch(0.25 0.014 30)): Highest surface. Toasts, tooltips, ghost button hover.
- **Line** (oklch(0.30 0.014 30)): Strong border. Pane dividers, toast border, tooltip border.
- **Line Faint** (oklch(0.26 0.012 30)): Soft border. Card edges, section dividers, input border, chip border.

### Ink
- **Field White** (oklch(0.94 0.01 30)): Primary text. Body, headings, selected labels. Contrast ≥7:1 against Bunker.
- **Dispatch Gray** (oklch(0.78 0.012 30)): Secondary text. Subtitles, descriptions, ghost button text, inactive chip text. Contrast ≥5.5:1.
- **Intel Gray** (oklch(0.58 0.014 30)): Tertiary/muted text. Placeholders, timestamps, icon-only metadata, empty states. Contrast ≥4.5:1.
- **Shadow Gray** (oklch(0.40 0.012 30)): Most muted. Separator dots, scrollbar thumbs, row dividers.

### Semantic
- **Victory** (oklch(0.72 0.16 145)): Win indicators. Green, color-blind differentiable from Defeat. Text color on win pills.
- **Victory Dim** (oklch(0.28 0.06 145)): Win pill/stat background.
- **Defeat** (oklch(0.66 0.18 25)): Loss indicators. Red, color-blind differentiable from Victory. Text color on loss pills.
- **Defeat Dim** (oklch(0.28 0.08 25)): Loss pill/stat background.
- **Alert** (oklch(0.78 0.14 75)): Warning/amber. Error account counts, assist stat coloring.

### Named Rules
**The One Accent Rule.** Signal Red appears on ≤8% of any given screen. It marks exactly one thing per context: the selected item, the primary action, the focused input. Two red elements on screen means one of them is lying.

**The Warm-Neutral Rule.** Every neutral in the system (Bunker through Panel Top, Line through Shadow Gray) carries hue 30 at chroma 0.01–0.015. Pure gray (chroma 0) is prohibited — it reads as cold and foreign against the warm-tinted accent.

**The Semantic Pairing Rule.** Win/Loss are always delivered as icon + color together, never color alone. The W/L letter shape in the result pill provides a color-blind-safe fallback.

## 3. Typography

**Body Font:** MiSans (variable, SC subset) for Chinese; MiSansLatin (static weights) for Latin/diacritics. Fallback: Inter → system-ui → PingFang SC → Microsoft YaHei → sans-serif.
**Mono Font:** JetBrains Mono → Cascadia Code → Consolas → Menlo → monospace.

**Character:** MiSans is a geometric humanist sans with a tall x-height and open apertures, designed for UI density. Paired with JetBrains Mono for data — the contrast between the rounded MiSans forms and the angular mono numerals creates a clear information hierarchy without a second display family. No serif, no display/body pairing. One family is enough.

**Weight tokens** are non-standard (380 / 520 / 630) to match MiSans's finer weight gradation. Never use raw CSS weight numbers (400, 500, 600) — they snap to the wrong nearest MiSans weight.

### Hierarchy
- **Headline** (Semibold, 20px, 1.2): Detail pane agent name. Only one per screen.
- **Title** (Bold, 16px, 1.5): Brand name in topbar, empty-state titles, section headings.
- **Body** (Regular/330, 14px, 1.5): Body text, match row agent, match video name. Base size. Max line length 65–75ch for prose; unrestrained for data rows.
- **Label** (Medium/380, 13px, 1.5): Pane titles, button text, account names, stat labels.
- **Data** (Semibold/450, 12px, 1.5): KDA, timestamps, video metadata, result scores. JetBrains Mono.
- **Caption** (Regular, 11–12px, 1.5): Filter chips, account sub-labels, section metadata. Sans or mono depending on content.

### Named Rules
**The One-Family Rule.** MiSans carries every heading, label, button, and body. JetBrains Mono is reserved for data (numbers, timestamps, codes). Never introduce a third family.

**The Weight Token Rule.** Use `var(--w-medium)` (380), `var(--w-semibold)` (520), `var(--w-bold)` (630). Never write `font-weight: 400` or `font-weight: 500` — MiSans has no weight at those stops.

## 4. Elevation

Flat tonal layering. Depth is conveyed through background lightness alone: Bunker (L 0.16) → Panel (L 0.19) → Panel Raised (L 0.22) → Panel Top (L 0.25). Each step is a ~0.03 L increment — perceptible without being harsh. No drop shadows on cards, rows, or panes.

Two exceptions carry minimal shadows for practical legibility in the z-index layer above all content:
- **Toast** (box-shadow: `0 6px 20px oklch(0 0 0 / 0.4)`) — bottom-center notification, z-index 100.
- **Tooltip** (box-shadow: `0 4px 14px oklch(0 0 0 / 0.45)`) — fixed-position hover tooltip, z-index 9999.

Both shadows use pure black at 40–45% opacity — no color cast, so they read as depth, not as a second light source.

### Named Rules
**The Flat-By-Default Rule.** Surfaces are distinguished by tonal value at rest. Shadows appear only when a surface floats above all content (tooltip, toast) and must be visually separated from the page. Cards, rows, and dropdowns never use box-shadow.

## 5. Components

### Buttons
- **Shape:** Rounded at 6px (`--radius`). Icon buttons are 32×32px squares with the same radius.
- **Primary:** Signal Red background, Ash White text, 6px 12px padding. Used for the single most important action on screen. Hover lifts to Signal Red Bright. Transition: 80ms ease-out on background.
- **Ghost/Play:** Transparent background, Dispatch Gray text, 4px 10px padding. Used for secondary actions and video play buttons. Hover: Panel Top background, Field White text. Transition: 80ms ease-out.
- **Icon Button:** 32×32px, Dispatch Gray icon via Phosphor SVG (WIcon). Hover: Panel Raised background, Field White icon. Used for toolbar actions (settings). Transition: 100ms ease-out.
- **Focus:** Every button gets `outline: 2px solid Signal Red, outline-offset: 2px, border-radius: 4px` on `:focus-visible`.

### Chips
- **Style:** Pill-shaped (border-radius 999px), Panel Raised background, 1px Line Faint border, Dispatch Gray text. 1px 7px padding for list chips (mode), 4px 10px for filter chips (moments).
- **Active state:** Ember background, Signal Red border and text. Used for selected filter and the current match list filter.
- **Mode chip variant:** Inline-flex with a 12×12px mode icon (loaded from ACLOS CDN) sitting left of the text. On icon load failure, the `<img>` self-removes and the chip degrades to text-only.

### Cards
- **Corner Style:** 6px radius (`--radius`) for match rows and video cards. 8px radius for stat cells. 4px radius for cover thumbnails.
- **Background:** Panel for match rows at rest; Panel Raised on hover/select. Panel Raised for montage/moment cards.
- **Border:** 1px Line Faint border. On selection, border shifts to Signal Red.
- **Internal Padding:** Match row: 8px with 12px gap between cover and meta. Montage/moment cards: cover (16:9 aspect-ratio) followed by 6px 8px 8px info block.

### Match Row
Three-line layout inside a 96px-min-height card:
- Line 1: Agent name (left) + W/L result pill (right), space-between.
- Line 2: KDA (mono) · Map name (sans) (left) + Mode chip (right).
- Line 3: Video name × count (left) + Time · Account label (right).
- Left cover thumbnail: 88×72px, 4px radius, object-fit cover. Falls back to a single-letter placeholder on image load error.
- Selection: Panel Raised background + Signal Red left border (2px on `.account`, 1px full border on `.match-row`).

### Stat Grid
3×2 card grid inside the detail pane:
- Row 1: Kills / Deaths / Assists (3 equal columns).
- Row 2: KDA ratio / Score (2 equal columns spanning full width).
- Each cell: Panel Raised background, 8px radius, 1px Line Faint border, 10px 6px padding. Vertical stack: icon (14px Phosphor SVG via WIcon) → value (18px mono semibold) → label (11px caption).
- Semantic coloring: kills/win = Victory green, deaths/loss = Defeat red, assists = Alert amber. KDA ratio is dynamic (≥1.5 green, ≤0.8 red, else neutral).

### Navigation
No conventional nav. The app is three fixed panes in a CSS Grid:
- Left (220px): Account list — vertical scroll, selected account gets 2px Signal Red left border.
- Center (1fr): Match list — vertical scroll, 4px gap between rows.
- Right (360px): Detail pane — header fixed at top, sections scroll below.

Topbar (56px) spans the full width: 36px SVG app logo + "WonderfulUI" wordmark (left, 8px lockup gap, red "UI" accent), search input (center), settings icon button (right).

### Tooltip
Custom fixed-position tooltip replacing native `title=` bubbles:
- Panel Top background, Line border, 6px radius, 6px 10px padding.
- Field White + Dispatch Gray text at 12px, `white-space: pre-line` for multi-line hints.
- Box-shadow: `0 4px 14px oklch(0 0 0 / 0.45)` (one of two permitted shadows).
- 800ms hover delay before appearing; hidden instantly on mouseleave/blur/scroll.
- **Smart positioning** via `@floating-ui/dom`: flipped to the best available side (top/bottom/left/right) with viewport edge detection.
- **Cursor tracking**: the tooltip's horizontal axis tracks the mouse X inside the target, so it feels connected without jittery full tracking.
- **Arrow indicator**: 8×8 ⬥ on the edge facing the anchor, matching background and border.
- **Entrance**: 80ms `cubic-bezier(0.16, 1, 0.3, 1)` scale(0.96→1) with opacity fade; collapses to instant under `prefers-reduced-motion: reduce`.

### Toast
Bottom-center notification bar:
- Panel Top background, Line border, 6px radius, 10px 16px padding, 13px Field White text.
- Box-shadow: `0 6px 20px oklch(0 0 0 / 0.4)`.
- Error variant: Ember background, Signal Red border.
- Fixed position, z-index 100, auto-dismisses after 4 seconds.

### Input
- Search field: Bunker background, 1px Line Faint border, 6px radius, 6px 10px padding, 13px Field White text.
- Placeholder: Intel Gray.
- Focus: Border shifts to Signal Red, no outline override (the border-color change is the affordance).
- Width: 100% up to 480px max-width, centered in the topbar.

### SettingsModal

The SettingsModal is the one non-player modal exception: settings are a
low-frequency, app-level maintenance surface, not part of the match browsing
flow. It must stay visually quiet and native to the app shell.

**Shape:** Centered modal, max ~660px wide, Panel background, 1px Line border,
8-10px radius, no shadow and no blur. The backdrop blocks the app below it,
but should not make the dialog feel like a separate product.

**Layout:** A compact left section nav and right grouped setting rows. The
match-list header refresh action uses the saved refresh-button mode. Settings expose
that mode as `增量扫描` / `全量扫描`. The direct full scan maintenance action
also lives here and should use a restrained outline/ghost button, not a full
red primary button.

**Motion:** 120-170ms fade/translate/scale only. The effect should make the
modal feel responsive, not decorative. Collapse to near-instant under
`prefers-reduced-motion`.

**Z-axis:** Above event modals and the player; toasts remain above settings so
scan feedback is visible.

### PlayerModal (built-in video player)

The PlayerModal is the primary justified modal — video playback requires focused viewing, unobtrusive controls, and cursor-aware features (right-click context menu). It replaces the system default player as the primary playback path while keeping the system player accessible via right-click fallback.

**Shape:** 16:9 modal centered on an opaque 70% black backdrop. Max 80vw × 80vh. Panel Top (`--surface-3`) background, 1px Line border, 10px (`--radius-lg`) radius. **No box-shadow, no backdrop-filter blur.** Entrance: 260ms ease-out opacity + scale(0.96→1); exit: 140ms ease-in reverse. Both collapse to instant under `prefers-reduced-motion`.

**Stage:** 16:9 video container. `<video>` element uses `object-fit: fill` to stretch 4:3 ACLOS source (1440×1080 @ 60 fps H.264) to fill the 16:9 frame.

**Controls bar:** Absolute bottom, gradient overlay (opaque at bottom, transparent at top). 3s auto-hide when playing (YouTube-style); always visible when paused or on hover. Fade transition: 200ms ease-out on opacity; collapsed to ≤1ms under `prefers-reduced-motion`.

**Control row (left to right):** Play/Pause (32x32 icon button) - Progress bar (Panel background, Signal Red fill, 8px thumb) - Time display (JetBrains Mono 12px) - Volume (32x32 icon button + 60x4px slider, localStorage-persisted) - Explorer button (32x32) - Share placeholder (disabled) - Fullscreen (32x32 icon button, Maximize2/Minimize2).

**Fullscreen:** `requestFullscreen()` on the modal. 100vw x 100vh, black background, no border/radius. Controls + keyboard preserved. Enter/exit via button, F key, or Esc (Esc exits fullscreen first; second Esc closes).

**Close:** X button 32x32 absolute at top-right. Clicking the backdrop also closes the player.

**States:** loading / playing / paused / ended (last frame + replay icon) / error. Auto-plays on open.

**Interaction:** Click video = play/pause. Click backdrop = close. Right-click = context menu.

**Keyboard:** Space/K, Arrows, J/L, Up/Down for volume, M for mute, F toggles fullscreen, Esc exits fullscreen then closes modal.

**Volume memory:** Persisted across sessions via localStorage.

## 6. Do's and Don'ts

### Do:
- **Do** use Signal Red for exactly one thing per surface: the selected item, the primary action, or the focused input.
- **Do** convey depth through tonal layers (Bunker → Panel → Panel Raised → Panel Top). Shadows only on tooltips and toasts.
- **Do** deliver win/loss as icon + color together. The W/L letter in the result pill is the color-blind-safe fallback.
- **Do** use 80–100ms ease-out transitions for state changes. No choreography, no staggered reveals.
- **Do** collapse all motion to ≤1ms under `prefers-reduced-motion: reduce`.
- **Do** use MiSans for all UI text; JetBrains Mono for KDA, timestamps, and codes.
- **Do** keep line length ≤75ch for prose. Data rows and tables may run wider.
- **Do** respect the weight tokens: `var(--w-medium)` (380), `var(--w-semibold)` (520), `var(--w-bold)` (630).
- **Do** use real match data as cover images. Never gradient placeholders or abstract illustrations.
- **Do** use the built-in WebView2 player for primary video playback (H.264 1440×1080 60 fps, hardware-accelerated). Keep the system default player accessible via right-click context menu as a fallback.

### Don't:
- **Don't** use AI-flavored SaaS defaults: purple-blue gradients, glassmorphism as decoration, hero-metric templates, gradient text.
- **Don't** use Windows Explorer utilitarianism: gray panels, 8px mechanical grids, sharp square borders.
- **Don't** use Steam/Epic marketplace patterns: purchase buttons, star ratings, wishlist icons.
- **Don't** use decorative motion: page transitions, hover ripples, staggered entrance animations.
- **Don't** use glassmorphism (`backdrop-filter: blur()`) except on the play-button overlay and resolution chip — and even there, only when it genuinely enhances the video-cover context.
- **Don't** use pure gray (chroma 0). Every neutral carries 0.01–0.015 chroma toward hue 30.
- **Don't** use border-left or border-right greater than 1px as a colored accent stripe. The 2px left border on `.account.is-selected` is the sole delibereate exception — it signals the active account in a scrollable list.
- **Don't** introduce a third font family. MiSans + JetBrains Mono is the ceiling.
- **Don't** use shadow on cards, rows, dropdowns, or panes. Shadows are reserved for tooltips and toasts only.
- **Don't** gate content behind entrance animations. Every surface must render in its final state on first paint. The settings modal `资料库概览` stats cards use a subtle staggered entrance (via @vueuse/motion) as an intentional exception — the modal itself already animates in, and the staggered cards reinforce the data-dashboard nature of that surface without blocking any primary workflow.
- **Don't** use modals for anything except the settings center, the video player (PlayerModal), and irreversible destructive actions (video deletion). Exhaust inline and progressive-disclosure alternatives first.
