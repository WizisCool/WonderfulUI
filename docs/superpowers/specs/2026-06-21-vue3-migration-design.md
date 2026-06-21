# Vue 3 Migration Design Spec

**Date:** 2026-06-21
**Scope:** Full rewrite of `packages/gui` frontend from vanilla TS/DOM to Vue 3
**Strategy:** Big Bang (new branch, complete rewrite, atomic swap)

---

## 1. Goals

- Replace vanilla `el()`-based DOM manipulation with Vue 3 SFC (`<template>` + `<script setup>` + `<style scoped>`)
- Replace closure-based mutable state with Pinia stores
- Add vue-router with `createMemoryHistory()` for view switching
- **Preserve all current UI visuals, logic, and user-facing behavior without change**
- Zero changes to Tauri command layer, Rust parser, or SQLite library
- Minimal new dependencies (vue, vue-router, pinia, @vitejs/plugin-vue)

## 2. Architecture

### 2.1 Top-Level Layout

```
<App>
├── AccountSidebar.vue    (fixed left, always visible)
├── <RouterView>
│   ├── HomeView.vue       (match list + filter bar)
│   ├── DetailView.vue     (match detail + event list)
│   └── SettingsView.vue   (settings modal)
├── PlayerHost.vue         (fixed, #player-host area, z-index above router)
└── Tooltip.vue            (teleported to <body>, global)
```

### 2.2 Directory Structure

```
packages/gui/src/
├── main.ts
├── App.vue
├── router/
│   └── index.ts
├── stores/
│   ├── account.ts
│   ├── match.ts
│   ├── detail.ts
│   ├── player.ts
│   ├── settings.ts
│   └── ui.ts
├── composables/
│   ├── useScan.ts
│   ├── useVirtualScroll.ts
│   ├── useFloating.ts
│   ├── useTooltip.ts
│   ├── useEventMarkers.ts
│   └── useKeyboard.ts
├── views/
│   ├── HomeView.vue
│   ├── DetailView.vue
│   └── SettingsView.vue
├── components/
│   ├── match/
│   │   ├── MatchList.vue
│   │   ├── MatchCard.vue
│   │   └── FilterBar.vue
│   ├── player/
│   │   ├── PlayerHost.vue
│   │   ├── ProgressBar.vue
│   │   └── PlayerControls.vue
│   ├── event/
│   │   ├── EventListModal.vue
│   │   ├── EventRow.vue
│   │   └── EventMarker.vue
│   ├── common/
│   │   ├── Tooltip.vue
│   │   ├── AccountSidebar.vue
│   │   └── AchievementBadge.vue
│   └── settings/
│       └── SettingsModal.vue
├── utils/                    (copied verbatim from current src/)
│   ├── event-state-machine.ts
│   ├── match-events.ts
│   ├── event-time.ts
│   └── weapons.ts
├── generated/                (copied verbatim)
│   └── valorant-skins.zh-CN.ts
└── assets/
    └── style.css             (CSS custom properties, reset, fonts only)
```

### 2.3 Data Flow

```
Tauri IPC invoke()
    │
    ▼
Pinia Store (single source of truth)
    │  state / getters / actions
    ├──► component <template> (reactive binding)
    ├──► component computed   (derived UI state)
    └──► component watch      (side effects: IPC, canvas, cleanup)
```

Rules:
- All `invoke()` calls go into Pinia **actions**
- All derived state goes into Pinia **getters** or component **computed**
- All DOM side effects go into component **watch** + `nextTick`
- `utils/` pure functions are copied verbatim — no rewrites

## 3. Component Migration Map

| Current File (LOC) | Vue 3 Target |
|---|---|
| `app.ts` (2135) | `App.vue` + 6 Pinia stores + 4 views + ~12 components |
| `player.ts` (898) | `PlayerHost.vue` + `PlayerControls.vue` + `ProgressBar.vue` + `player` store |
| `filter-bar.ts` (686) | `FilterBar.vue` + filter logic in `match` store |
| `event-list-modal.ts` (385) | `EventListModal.vue` + `EventRow.vue` |
| `tooltip.ts` (136) | `Tooltip.vue` + `useTooltip` composable |
| `floating.ts` (68) | `useFloating` composable |
| `event-state-machine.ts` | `utils/event-state-machine.ts` (verbatim) |
| `match-events.ts` | `utils/match-events.ts` (verbatim) |
| `event-time.ts` | `utils/event-time.ts` (verbatim) |
| `weapons.ts` | `utils/weapons.ts` (verbatim) |
| `style.css` (3306) | Split into each component's `<style scoped>` |

## 4. Pinia Stores

### 4.1 `account.ts`
```
state:  accounts[], selectedAccountId, accountLabels, accountOrder, achievements
getters: selectedAccount, accountCount
actions: scanLibrary(dir?), scrapeLibrary(dir?, mode?), loadAccounts(), reorderAccounts(order[])
```

### 4.2 `match.ts`
```
state:  matches[], filteredMatches[], filters, vscrollState, scraping
getters: filteredCount, hasMatches
actions: applyFilters(), setSort(), refreshList()
```

### 4.3 `detail.ts`
```
state:  selectedMatch, rounds[], events[], activeVideoIndex
getters: currentVideo, videoEvents, stats
actions: selectMatch(matchId), fetchRounds(), nextVideo(), prevVideo()
```

### 4.4 `player.ts`
```
state:  videoSrc, playing, currentTime, duration, volume, muted, seeking
getters: progressPct, formattedTime
actions: play(), pause(), seek(ms), setSrc(url), openPlayer(), closePlayer()
```

### 4.5 `settings.ts`
```
state:  dbPath, scanMode, theme, ...
getters: (none)
actions: saveSetting(key, value), loadSettings(), resetSettings()
```

### 4.6 `ui.ts`
```
state:  sidebarOpen, settingsOpen, eventModalOpen, tooltipContent
getters: (none)
actions: toggleSidebar(), openSettings(), closeSettings()
```

## 5. Router

`createMemoryHistory()` — no URL bar interaction.

| Path | Component | Purpose |
|---|---|---|
| `/` | `HomeView.vue` | Match list + sidebar |
| `/match/:id` | `DetailView.vue` | Match detail + event list |
| `/settings` | `SettingsView.vue` | Settings modal overlay |

Player modal uses z-index overlay, not router. Settings may use router or overlay — TBD during implementation.

## 6. Immovable Parts

- Tauri command handlers (Rust)
- `src-tauri/src/library/*` — scraper, events, SQLite
- `src-tauri/src/parser/*` — Rust parser
- `@wonderful-ui/parser` (workspace TS parser)
- `packages/gui/src/generated/valorant-skins.zh-CN.ts` — copied verbatim
- AGENTS.md, docs/*, PRODUCT.md, DESIGN.md — informational docs

## 7. New Dependencies

```json
{
  "vue": "^3.5",
  "vue-router": "^4.4",
  "pinia": "^2.2"
}
```

Dev:
```json
{
  "@vitejs/plugin-vue": "^5.1"
}
```

Existing dependencies retained: `@floating-ui/dom`, `echarts`, `sortablejs`, `fuse.js`, `lucide`, `@zag-js/*`, `@tanstack/table-core`.

## 8. CSS Strategy

- All component styles use `<style scoped>`
- Remaining in `assets/style.css`: `@font-face`, CSS custom properties (`--font-sans`, `--color-*`, `--z-*`), reset/normalize
- No CSS-in-JS, no CSS modules
- Visual output must match current `style.css` pixel-for-pixel

## 9. Verification

- `bun test packages/parser` — must pass (parser unchanged)
- `cargo test --release --manifest-path src-tauri/Cargo.toml --lib` — must pass (Rust unchanged)
- `bun test packages/gui` — test files requiring update for new API surface
- Manual visual spot-check: match list, detail view, player, event modal, settings, tooltips, keyboard shortcuts
