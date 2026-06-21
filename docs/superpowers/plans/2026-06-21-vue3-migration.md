# Vue 3 Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `packages/gui` from vanilla TS/DOM to Vue 3 with `<script setup lang="ts">` + `<style scoped>`, preserving all UI visuals and logic unchanged.

**Architecture:** Pinia stores as single source of truth, vue-router with `createMemoryHistory()`, all current pure-logic files copied verbatim into `utils/`. CSS splits from one global file into per-component `<style scoped>`, leaving only custom properties + reset + fonts in global.

**Tech Stack:** Vue 3.5, Vue Router 4.4, Pinia 2.2, Vite 5.4, @floating-ui/dom, echarts, sortablejs, fuse.js, lucide

## Global Constraints

- All Tauri `invoke()` calls go into Pinia actions, never directly in components
- `utils/event-state-machine.ts`, `utils/match-events.ts`, `utils/event-time.ts`, `utils/weapons.ts` copied verbatim -- zero logic changes
- `utils/generated/valorant-skins.zh-CN.ts` copied verbatim
- `<style scoped>` for all components; only CSS custom properties, `@font-face`, and reset remain in `assets/style.css`
- Player lives at `#player-host` outside `#app`, with z-index 1200 > event modal 1100
- Virtual scroll same constants: `ROW_HEIGHT = 104`, `ROW_BUFFER = 5`
- Canvas event markers use `CANVAS_MARKER_THRESHOLD = 20`
- All current icons from `lucide` via `createElement`, same usage pattern
- Chinese UI labels use `--font-sans` (MiSans), not JetBrains Mono
- No UI component library -- pure hand-written components
- Zero changes to `src-tauri/`, `@wonderful-ui/parser`, or `AGENTS.md`/`docs/`

---

## Phase 1: Infrastructure Scaffolding

### Task 1.1: Install Vue dependencies

**Files:**
- Modify: `packages/gui/package.json`

**Produces:** Updated package.json with vue, vue-router, pinia, @vitejs/plugin-vue

- [ ] **Step 1: Add Vue dependencies to package.json**

Edit `packages/gui/package.json`, add to `dependencies`:
```json
"lucide-vue-next": "^0.468.0",
"pinia": "^2.2.0",
"vue": "^3.5.0",
"vue-router": "^4.4.0"
```

Add to `devDependencies`:
```json
"@vitejs/plugin-vue": "^5.1.0"
```

- [ ] **Step 2: Install**

Run: `bun install --cwd packages/gui`
Expected: Clean install, no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/gui/package.json packages/gui/bun.lockb 2>/dev/null; git add packages/gui/package-lock.json 2>/dev/null
git commit -m "chore(gui): add vue 3, vue-router, pinia, @vitejs/plugin-vue"
```

### Task 1.2: Configure Vite for Vue

**Files:**
- Modify: `packages/gui/vite.config.ts`

**Consumes:** vue, @vitejs/plugin-vue (Task 1.1)
**Produces:** Vite config with Vue plugin enabled

- [ ] **Step 1: Add Vue plugin to vite.config.ts**

Edit `packages/gui/vite.config.ts`:

```typescript
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [vue()],
  root: '.',
  clearScreen: false,
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@wonderful-ui/parser': resolve(__dirname, '..', 'parser', 'src', 'index.ts'),
    },
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'esnext',
    sourcemap: true,
  },
});
```

- [ ] **Step 2: Verify Vite dev server starts**

Run: `bun run --cwd packages/gui dev` (Ctrl+C after 5s)
Expected: Vite starts on port 1420 without errors.

- [ ] **Step 3: Commit**

```bash
git add packages/gui/vite.config.ts
git commit -m "feat(gui): configure vite with vue plugin and @ alias"
```

### Task 1.3: Update index.html for Vue entry

**Files:**
- Modify: `packages/gui/index.html`
- Create: `packages/gui/src/main.ts`

**Consumes:** Vue plugin (Task 1.2)
**Produces:** Vue app entry point, minimal App.vue showing brand name

- [ ] **Step 1: Set up Vue entry in index.html**

Edit `packages/gui/index.html`:
```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>WonderfulUI</title>
    <link rel="icon" type="image/svg+xml" href="/src/assets/logo.svg" />
    <link rel="stylesheet" href="/src/assets/style.css" />
  </head>
  <body>
    <div id="app"></div>
    <div id="player-host"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: Write the Vue entry point**

Write `packages/gui/src/main.ts`:
```typescript
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { router } from './router';
import App from './App.vue';

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount('#app');
```

- [ ] **Step 3: Write minimal App.vue**

Create `packages/gui/src/App.vue`:
```vue
<template>
  <div class="app">
    <RouterView />
  </div>
</template>

<script setup lang="ts">
import { RouterView } from 'vue-router';
</script>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}
</style>
```

- [ ] **Step 4: Write router skeleton**

Create `packages/gui/src/router/index.ts`:
```typescript
import { createRouter, createMemoryHistory } from 'vue-router';
import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: () => import('../views/HomeView.vue'),
  },
];

export const router = createRouter({
  history: createMemoryHistory(),
  routes,
});
```

- [ ] **Step 5: Write placeholder views for boot**

Create `packages/gui/src/views/HomeView.vue`:
```vue
<template>
  <div class="home-view">
    <h1>WonderfulUI</h1>
    <p>Vue 3 migration — boot checkpoint</p>
  </div>
</template>

<script setup lang="ts">
</script>

<style scoped>
.home-view {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--color-fg);
}
</style>
```

- [ ] **Step 6: Create global CSS file**

Create `packages/gui/src/assets/style.css` (minimal starting point):
```css
@import '../fonts.css';
@import url('https://cdn.jsdelivr.net/npm/misans@4.0.0/lib/Normal/MiSans-Normal.min.css');

:root {
  --font-sans: 'MiSans', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', 'Consolas', monospace;
  --color-bg: #1a1816;
  --color-surface: #242120;
  --color-surface-raised: #2d2a28;
  --color-fg: #e8e4dd;
  --color-fg-muted: #9e968c;
  --color-fg-dim: #6e6860;
  --color-accent: #df4f45;
  --color-accent-dim: #a0362e;
  --color-green: #4caf50;
  --color-yellow: #f0b340;
  --z-player: 1200;
  --z-event-modal: 1100;
  --z-tooltip: 2000;
  --z-settings: 1000;
  --row-h: 96px;
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --gap-xs: 4px;
  --gap-sm: 8px;
  --gap-md: 12px;
  --gap-lg: 16px;
  --gap-xl: 24px;
}

*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html, body {
  height: 100%;
  overflow: hidden;
  background: var(--color-bg);
  color: var(--color-fg);
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  user-select: none;
}

#app {
  height: 100%;
  overflow: hidden;
}

#player-host {
  position: fixed;
  inset: 0;
  z-index: var(--z-player);
  pointer-events: none;
}

#player-host > * {
  pointer-events: auto;
}

a { color: inherit; text-decoration: none; }
button { font: inherit; color: inherit; cursor: pointer; }
input { font: inherit; color: inherit; }
img { display: block; max-width: 100%; }
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--color-fg-dim); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--color-fg-muted); }
```

- [ ] **Step 7: Verify app renders**

Run: `bun run --cwd packages/gui dev` (open browser at http://localhost:1420)
Expected: "WonderfulUI — Vue 3 migration boot checkpoint" visible.

- [ ] **Step 8: Commit**

```bash
git add packages/gui/index.html packages/gui/src/main.ts packages/gui/src/App.vue packages/gui/src/router/index.ts packages/gui/src/views/HomeView.vue packages/gui/src/assets/style.css
git commit -m "feat(gui): vue 3 entry point, router, app shell, global CSS"
```

---

## Phase 2: Utility Files (Copy Verbatim)

### Task 2.1: Copy pure-logic utils into utils/

**Files:**
- Create: `packages/gui/src/utils/event-state-machine.ts`
- Create: `packages/gui/src/utils/match-events.ts`
- Create: `packages/gui/src/utils/event-time.ts`
- Create: `packages/gui/src/utils/weapons.ts`
- Create: `packages/gui/src/utils/filters.ts`
- Create: `packages/gui/src/utils/filter-engine.ts`
- Create: `packages/gui/src/utils/account-preferences.ts`
- Create: `packages/gui/src/utils/dom.ts` (keep `el()` available if anything still needs it)
- Create: `packages/gui/src/utils/generated/valorant-skins.zh-CN.ts`

**Consumes:** Existing files in `src/`
**Produces:** Identical copies under `src/utils/`

- [ ] **Step 1: Copy event-state-machine.ts**

Run:
```powershell
Copy-Item -LiteralPath "packages/gui/src/event-state-machine.ts" -Destination "packages/gui/src/utils/event-state-machine.ts"
```
Adjust import: `./event-time.ts` -> `./event-time.ts` (same dir, no change needed)

- [ ] **Step 2: Copy match-events.ts**

Run:
```powershell
Copy-Item -LiteralPath "packages/gui/src/match-events.ts" -Destination "packages/gui/src/utils/match-events.ts"
```
Adjust imports in copied file: `./weapons.ts` -> `./weapons.ts`, `./event-state-machine.ts` -> `./event-state-machine.ts` (same dir, no change)

- [ ] **Step 3: Copy event-time.ts**

Run:
```powershell
Copy-Item -LiteralPath "packages/gui/src/event-time.ts" -Destination "packages/gui/src/utils/event-time.ts"
```

- [ ] **Step 4: Copy weapons.ts**

Run:
```powershell
Copy-Item -LiteralPath "packages/gui/src/weapons.ts" -Destination "packages/gui/src/utils/weapons.ts"
```

- [ ] **Step 5: Copy filters.ts**

Run:
```powershell
Copy-Item -LiteralPath "packages/gui/src/filters.ts" -Destination "packages/gui/src/utils/filters.ts"
```

- [ ] **Step 6: Copy filter-engine.ts**

Run:
```powershell
Copy-Item -LiteralPath "packages/gui/src/filter-engine.ts" -Destination "packages/gui/src/utils/filter-engine.ts"
```
Edit to fix import:
```
- import { CATEGORY_GETTERS, ... } from './filters.ts';
+ import { CATEGORY_GETTERS, ... } from './filters';
```
(remove `.ts` extension for Vite resolution)

- [ ] **Step 7: Copy account-preferences.ts**

Run:
```powershell
Copy-Item -LiteralPath "packages/gui/src/account-preferences.ts" -Destination "packages/gui/src/utils/account-preferences.ts"
```

- [ ] **Step 8: Copy dom.ts**

Run:
```powershell
Copy-Item -LiteralPath "packages/gui/src/dom.ts" -Destination "packages/gui/src/utils/dom.ts"
```

- [ ] **Step 9: Copy generated skins**

Run:
```powershell
New-Item -ItemType Directory -Force -Path "packages/gui/src/utils/generated"
Copy-Item -LiteralPath "packages/gui/src/generated/valorant-skins.zh-CN.ts" -Destination "packages/gui/src/utils/generated/valorant-skins.zh-CN.ts"
```

- [ ] **Step 10: Copy fonts.css**

Run:
```powershell
Copy-Item -LiteralPath "packages/gui/src/fonts.css" -Destination "packages/gui/src/fonts.css"
```

- [ ] **Step 11: Verify files exist**

Run: `Get-ChildItem -Recurse -Name -Include *.ts "packages/gui/src/utils/"`
Expected: 9 .ts files listed.

- [ ] **Step 12: Commit**

```bash
git add packages/gui/src/utils/ packages/gui/src/fonts.css
git commit -m "feat(gui): copy pure-logic utils verbatim into utils/ directory"
```

### Task 2.2: Copy remaining utility files (not ported to components yet)

**Files:**
- Create: `packages/gui/src/utils/player-event-markers.ts`
- Create: `packages/gui/src/utils/render-pulse.ts`
- Create: `packages/gui/src/utils/library-stats.ts`
- Create: `packages/gui/src/utils/date-picker.ts`
- Create: `packages/gui/src/utils/scan-progress.ts`

**Produces:** Utility files preserved in utils/ for composable components to import

- [ ] **Step 1: Copy player-event-markers.ts**

Run:
```powershell
Copy-Item -LiteralPath "packages/gui/src/player-event-markers.ts" -Destination "packages/gui/src/utils/player-event-markers.ts"
```
This file contains pure canvas math functions (`layoutEventMarkers`, `renderCanvasMarkers`, `CANVAS_MARKER_THRESHOLD`) used by the `useEventMarkers` composable.

- [ ] **Step 2: Copy render-pulse.ts**

Run:
```powershell
Copy-Item -LiteralPath "packages/gui/src/render-pulse.ts" -Destination "packages/gui/src/utils/render-pulse.ts"
```
Small utility for filter motion animation. Keep as-is.

- [ ] **Step 3: Copy library-stats.ts**

Run:
```powershell
Copy-Item -LiteralPath "packages/gui/src/library-stats.ts" -Destination "packages/gui/src/utils/library-stats.ts"
```
Contains `LibraryStats` type, `CHART_METRIC_LABELS`, `fmtBytes`, and `mountAccountVideoChart`. The chart mounting function will be called from `SettingsModal.vue` using `onMounted`. Keep types here.

- [ ] **Step 4: Copy date-picker.ts**

Run:
```powershell
Copy-Item -LiteralPath "packages/gui/src/date-picker.ts" -Destination "packages/gui/src/utils/date-picker.ts"
```
Contains `createDateRangePicker`. Will be used from `FilterBar.vue` or ported into a Vue component. Keep in utils/ for now.

- [ ] **Step 5: Copy scan-progress.ts**

Run:
```powershell
Copy-Item -LiteralPath "packages/gui/src/scan-progress.ts" -Destination "packages/gui/src/utils/scan-progress.ts"
```
Boot/overlay progress indicator. Will be ported into a `BootOverlay.vue` component or used via a composable. Keep original in utils/ for reference.

- [ ] **Step 6: Commit**

```bash
git add packages/gui/src/utils/player-event-markers.ts packages/gui/src/utils/render-pulse.ts packages/gui/src/utils/library-stats.ts packages/gui/src/utils/date-picker.ts packages/gui/src/utils/scan-progress.ts
git commit -m "feat(gui): copy remaining utilities into utils/"
```

---

## Phase 3: Pinia Stores

### Task 3.1: Create account store

**Files:**
- Create: `packages/gui/src/stores/account.ts`

**Consumes:** tauri-adapter.ts (existing), utils/ (Task 2)
**Produces:** `useAccountStore` — manages accounts, scan, achievements

- [ ] **Step 1: Write account store**

Write `packages/gui/src/stores/account.ts`:

```typescript
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { invoke } from '../tauri-adapter.ts';
import { accountDisplayLabel } from '../utils/account-preferences.ts';
import type { MatchRecord } from '@wonderful-ui/parser';

export interface Account {
  openid: string;
  path: string;
  matchCount: number;
  nick?: string;
  tag?: string;
  customName?: string;
  achievements?: { matchesId: string; achvType: string; typeStr: string }[];
  error?: string;
}

export interface LoadResult {
  dir: string;
  accounts: Account[];
  matches: MatchRecord[];
  totalErrors: number;
}

export const ALL_ACCOUNTS = '__all__';

export const useAccountStore = defineStore('account', () => {
  const accounts = ref<Account[]>([]);
  const selectedAccountId = ref<string | null>(null);
  const matches = ref<MatchRecord[]>([]);
  const dir = ref('');
  const totalErrors = ref(0);
  const scraping = ref(false);
  const assetPathCache = ref(new Map<string, string>());
  const loadedMatchIds = ref(new Set<string>());

  const realAccounts = computed(() => accounts.value);

  const accountsForRender = computed(() => {
    if (realAccounts.value.length === 0) return [];
    return [
      { openid: ALL_ACCOUNTS, path: '', matchCount: matches.value.length },
      ...realAccounts.value,
    ] as Account[];
  });

  const accountLabels = computed(() => {
    const unknownIdx = new Map<string, number>();
    let n = 0;
    for (const a of realAccounts.value) {
      if (!a.nick && !a.customName?.trim()) { n++; unknownIdx.set(a.openid, n); }
    }
    const labels = new Map<string, string>();
    for (const a of realAccounts.value) {
      labels.set(a.openid, accountDisplayLabel(a, unknownIdx.get(a.openid)));
    }
    return labels;
  });

  const accountOrder = computed(() => realAccounts.value.map(a => a.openid));

  const matchAchievements = computed(() => {
    const map = new Map<string, { type: 'mvp' | 'svp'; typeStr: string }>();
    for (const a of realAccounts.value) {
      if (a.achievements) {
        for (const achv of a.achievements) {
          if (achv.achvType === 'mvp' || achv.achvType === 'svp') {
            map.set(achv.matchesId, { type: achv.achvType as 'mvp' | 'svp', typeStr: achv.typeStr });
          }
        }
      }
    }
    return map;
  });

  async function scanShell() {
    const shell = await invoke<{ accounts: Account[]; dir: string; totalErrors: number }>('scan_shell');
    accounts.value = shell.accounts;
    dir.value = shell.dir;
    totalErrors.value = shell.totalErrors;
  }

  async function loadLibrary(): Promise<void> {
    const data = await invoke<LoadResult>('load_library');
    accounts.value = data.accounts;
    matches.value = data.matches;
    dir.value = data.dir;
    totalErrors.value = data.totalErrors;
  }

  async function scrapeLibrary(mode: 'incremental' | 'full' = 'incremental'): Promise<LoadResult> {
    scraping.value = true;
    try {
      const fresh = await invoke<LoadResult>('scrape_library', {
        trigger: mode === 'full' ? 'full_manual' : 'manual',
        mode,
      });
      accounts.value = fresh.accounts;
      matches.value = fresh.matches;
      dir.value = fresh.dir;
      totalErrors.value = fresh.totalErrors;
      loadedMatchIds.value.clear();
      return fresh;
    } finally {
      scraping.value = false;
    }
  }

  async function cacheAssets(): Promise<void> {
    const entries: Array<{ kind: string; url: string }> = [];
    const seen = new Set<string>();
    for (const m of matches.value) {
      addAsset(entries, seen, 'hero_image', m.career?.hero_image as string);
      addAsset(entries, seen, 'map_image', m.career?.map_image as string);
      addAsset(entries, seen, 'game_mode_icon', m.career?.game_mode_icon as string);
    }
    if (entries.length === 0) return;
    try {
      const results = await invoke<Record<string, string>>('cache_assets', { entries });
      for (const [url, localPath] of Object.entries(results)) {
        assetPathCache.value.set(url, localPath);
      }
    } catch { /* non-fatal */ }
  }

  function addAsset(entries: Array<{ kind: string; url: string }>, seen: Set<string>, kind: string, url?: string) {
    if (typeof url === 'string' && url && !seen.has(url)) { seen.add(url); entries.push({ kind, url }); }
  }

  function selectAccount(openid: string | null) {
    selectedAccountId.value = openid;
  }

  async function saveAccountOrder(order: string[]): Promise<void> {
    const prev = [...accounts.value];
    try {
      const ordered = applyAccountOrder(accounts.value, order);
      accounts.value = ordered;
      await invoke('save_account_order', { openids: order });
    } catch (e) {
      accounts.value = prev;
      throw e;
    }
  }

  async function renameAccount(openid: string, customName: string | null): Promise<void> {
    const account = accounts.value.find(a => a.openid === openid);
    if (!account) return;
    const prev = account.customName;
    account.customName = customName || undefined;
    try {
      await invoke('rename_account', { openid, customName: customName || null });
    } catch (e) {
      account.customName = prev;
      throw e;
    }
  }

  function applyAccountOrder(list: Account[], order: string[]): Account[] {
    const byId = new Map(list.map(a => [a.openid, a]));
    return order.map(id => byId.get(id)).filter((a): a is Account => !!a);
  }

  return {
    accounts, selectedAccountId, matches, dir, totalErrors, scraping,
    assetPathCache, loadedMatchIds,
    realAccounts, accountsForRender, accountLabels, accountOrder, matchAchievements,
    scanShell, loadLibrary, scrapeLibrary, cacheAssets,
    selectAccount, saveAccountOrder, renameAccount,
  };
});
```

- [ ] **Step 2: Verify store compiles**

Run: `bunx vue-tsc --noEmit --project packages/gui/tsconfig.json 2>&1 | head -5`
Expected: No errors related to this file.

- [ ] **Step 3: Commit**

```bash
git add packages/gui/src/stores/account.ts
git commit -m "feat(gui): add account Pinia store"
```

### Task 3.2: Create filter store

**Files:**
- Create: `packages/gui/src/stores/filter.ts`

**Consumes:** utils/filters.ts, utils/filter-engine.ts (Task 2)
**Produces:** `useFilterStore` — filter state, facet counts, persistence, scope label

- [ ] **Step 1: Write filter store**

Write `packages/gui/src/stores/filter.ts`:

```typescript
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import {
  FilterState, EMPTY_FILTERS, activeFilterCount, activeFilterSummary,
  loadFilters, saveFilters, loadOpen, saveOpen,
  normalizeVisibleFilters,
  CATEGORY_KEYS, RANGE_KEYS, ADVANCED_RANGE_KEYS,
} from '../utils/filters.ts';
import { applyFilters, pruneUnavailableCategories } from '../utils/filter-engine.ts';
import type { MatchRecord } from '@wonderful-ui/parser';
import { ALL_ACCOUNTS } from './account.ts';

export type ScrapeMode = 'incremental' | 'full';

const REFRESH_SCAN_MODE_KEY = 'wui:library.refreshScanMode';

export const useFilterStore = defineStore('filter', () => {
  const filters = ref<FilterState>(normalizeVisibleFilters(loadFilters()));
  const filterBarOpen = ref(loadOpen());
  const refreshScanMode = ref<ScrapeMode>(
    localStorage.getItem(REFRESH_SCAN_MODE_KEY) === 'full' ? 'full' : 'incremental'
  );
  const scrollToKey = ref<string | null>(null);

  const activeCount = computed(() => activeFilterCount(filters.value));
  const summary = computed(() => activeFilterSummary(filters.value));

  function setFilters(patch: Partial<FilterState>) {
    Object.assign(filters.value, patch);
    filters.value = normalizeVisibleFilters(filters.value);
    saveFilters(filters.value);
  }

  function clearFilter(key: string, value?: string) {
    if (key === '__all__') {
      setFilters({ ...EMPTY_FILTERS, query: filters.value.query });
      return;
    }
    if (key === 'query') {
      setFilters({ ...filters.value, query: '' });
      return;
    }
    const catSet = new Set<string>(CATEGORY_KEYS);
    if (catSet.has(key)) {
      const arr = [...filters.value[key as keyof FilterState] as string[]];
      if (value !== undefined) {
        const s = new Set(arr);
        s.delete(value);
        setFilters({ [key]: [...s] });
      }
      return;
    }
    if ((RANGE_KEYS as readonly string[]).includes(key)) {
      setFilters({ [key]: [null, null] });
      return;
    }
  }

  function pruneForScope(matches: MatchRecord[]) {
    const next = normalizeVisibleFilters(pruneUnavailableCategories(matches, filters.value));
    if (next !== filters.value) {
      filters.value = next;
      saveFilters(filters.value);
    }
  }

  function toggleFilterBar() {
    filterBarOpen.value = !filterBarOpen.value;
    saveOpen(filterBarOpen.value);
  }

  function setFilterBarOpen(open: boolean) {
    filterBarOpen.value = open;
    saveOpen(open);
  }

  function setScanMode(mode: ScrapeMode) {
    refreshScanMode.value = mode;
    localStorage.setItem(REFRESH_SCAN_MODE_KEY, mode);
  }

  function focusSection(key: string) {
    scrollToKey.value = key;
  }

  function clearScrollTarget() {
    scrollToKey.value = null;
  }

  function applyToMatches(allMatches: MatchRecord[], accountMatches: MatchRecord[]) {
    return applyFilters(accountMatches, filters.value);
  }

  // Per-account filtered counts for sidebar numbers
  function filteredAccountCounts(matches: MatchRecord[], realAccounts: Array<{ openid: string; error?: string }>) {
    const counts = new Map<string, number>();
    counts.set(ALL_ACCOUNTS, applyFilters(matches, filters.value).length);
    for (const a of realAccounts) {
      if (a.error) { counts.set(a.openid, 0); continue; }
      counts.set(a.openid, applyFilters(matches.filter(m => m.openID === a.openid), filters.value).length);
    }
    return counts;
  }

  return {
    filters, filterBarOpen, refreshScanMode, scrollToKey,
    activeCount, summary,
    setFilters, clearFilter, pruneForScope,
    toggleFilterBar, setFilterBarOpen, setScanMode,
    focusSection, clearScrollTarget,
    applyToMatches, filteredAccountCounts,
  };
});
```

- [ ] **Step 2: Commit**

```bash
git add packages/gui/src/stores/filter.ts
git commit -m "feat(gui): add filter Pinia store"
```

### Task 3.3: Create detail store

**Files:**
- Create: `packages/gui/src/stores/detail.ts`

**Produces:** `useDetailStore` — selected match, moment filter, rounds loading

- [ ] **Step 1: Write detail store**

Write `packages/gui/src/stores/detail.ts`:

```typescript
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { invoke } from '../tauri-adapter.ts';
import type { MatchRecord, VideoItem } from '@wonderful-ui/parser';

export const useDetailStore = defineStore('detail', () => {
  const selectedMatch = ref<MatchRecord | null>(null);
  const momentFilter = ref<string | null>(null);
  const roundsLoaded = ref(false);

  const hasVideo = computed(() => (selectedMatch.value?.videos.length ?? 0) > 0);

  async function fetchRounds(): Promise<void> {
    const m = selectedMatch.value;
    if (!m || roundsLoaded.value) return;
    try {
      const full = await invoke<MatchRecord>('get_match_rounds', {
        openid: m.openID,
        matchId: m.matches_id,
      });
      for (const liveV of m.videos) {
        const fullV = full.videos.find(v => v.video_id === liveV.video_id);
        if (fullV) liveV.rounds = fullV.rounds;
      }
      roundsLoaded.value = true;
    } catch (e) {
      throw e;
    }
  }

  function selectMatch(m: MatchRecord | null) {
    selectedMatch.value = m;
    momentFilter.value = null;
    roundsLoaded.value = false;
  }

  function setMomentFilter(type: string | null) {
    momentFilter.value = momentFilter.value === type ? null : type;
  }

  return {
    selectedMatch, momentFilter, roundsLoaded, hasVideo,
    fetchRounds, selectMatch, setMomentFilter,
  };
});
```

- [ ] **Step 2: Commit**

```bash
git add packages/gui/src/stores/detail.ts
git commit -m "feat(gui): add detail Pinia store"
```

### Task 3.4: Create player store

**Files:**
- Create: `packages/gui/src/stores/player.ts`

**Produces:** `usePlayerStore` — player open/close, video source, seek target

- [ ] **Step 1: Write player store**

Write `packages/gui/src/stores/player.ts`:

```typescript
import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { VideoItem, MatchRecord } from '@wonderful-ui/parser';

export const usePlayerStore = defineStore('player', () => {
  const video = ref<VideoItem | null>(null);
  const matchContext = ref<MatchRecord | null>(null);
  const seekMs = ref<number | undefined>(undefined);
  const isOpen = ref(false);

  function open(v: VideoItem, m?: MatchRecord, seek?: number) {
    video.value = v;
    matchContext.value = m ?? null;
    seekMs.value = seek;
    isOpen.value = true;
  }

  function close() {
    isOpen.value = false;
    video.value = null;
    matchContext.value = null;
    seekMs.value = undefined;
  }

  return { video, matchContext, seekMs, isOpen, open, close };
});
```

- [ ] **Step 2: Commit**

```bash
git add packages/gui/src/stores/player.ts
git commit -m "feat(gui): add player Pinia store"
```

### Task 3.5: Create settings and UI stores

**Files:**
- Create: `packages/gui/src/stores/settings.ts`
- Create: `packages/gui/src/stores/ui.ts`

**Produces:** settings store (library stats, log panel), ui store (tooltip, sidebar)

- [ ] **Step 1: Write settings store**

Write `packages/gui/src/stores/settings.ts`:

```typescript
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { invoke } from '../tauri-adapter.ts';
import type { LibraryStats } from '../utils/library-stats.ts';

export type SettingsTab = 'library' | 'logs';

export interface LogStatus {
  logDir: string; logPath: string; size: number;
  modifiedMs: number; maxBytes: number; latestText: string;
}

export const useSettingsStore = defineStore('settings', () => {
  const isOpen = ref(false);
  const isClosing = ref(false);
  const activeTab = ref<SettingsTab>('library');
  const logLoading = ref(false);
  const logStatus = ref<LogStatus | null>(null);
  const logError = ref<string | null>(null);
  const statsLoading = ref(false);
  const statsData = ref<LibraryStats | null>(null);
  const statsError = ref<string | null>(null);
  const chartMetric = ref<'video' | 'match'>('video');

  function setOpen(open: boolean) {
    if (open) {
      isOpen.value = true;
      isClosing.value = false;
    } else if (isOpen.value) {
      isOpen.value = false;
      isClosing.value = true;
      setTimeout(() => { isClosing.value = false; }, 150);
    }
  }

  function setTab(tab: SettingsTab) { activeTab.value = tab; }
  function setChartMetric(m: 'video' | 'match') { chartMetric.value = m; }

  async function fetchLogs() {
    logLoading.value = true;
    logError.value = null;
    try {
      logStatus.value = await invoke<LogStatus>('get_log_status');
    } catch (e) {
      logError.value = `日志读取失败: ${(e as Error).message ?? String(e)}`;
    } finally {
      logLoading.value = false;
    }
  }

  async function fetchLibraryStats() {
    if (statsLoading.value) return;
    const prev = statsData.value;
    statsLoading.value = true;
    statsError.value = null;
    try {
      statsData.value = await invoke<LibraryStats>('get_library_stats');
    } catch (e) {
      statsData.value = prev;
      statsError.value = `资料库统计失败: ${(e as Error).message ?? String(e)}`;
    } finally {
      statsLoading.value = false;
    }
  }

  return {
    isOpen, isClosing, activeTab, logLoading, logStatus, logError,
    statsLoading, statsData, statsError, chartMetric,
    setOpen, setTab, setChartMetric, fetchLogs, fetchLibraryStats,
  };
});
```

- [ ] **Step 2: Write UI store**

Write `packages/gui/src/stores/ui.ts`:

```typescript
import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useUiStore = defineStore('ui', () => {
  const toastMessage = ref('');
  const toastKind = ref<'ok' | 'error'>('ok');
  const toastVisible = ref(false);
  let toastTimer: number | null = null;

  function showToast(message: string, kind: 'ok' | 'error' = 'ok') {
    if (toastTimer !== null) clearTimeout(toastTimer);
    toastMessage.value = message;
    toastKind.value = kind;
    toastVisible.value = true;
    toastTimer = window.setTimeout(() => {
      toastVisible.value = false;
    }, kind === 'error' ? 6000 : 2500);
  }

  return { toastMessage, toastKind, toastVisible, showToast };
});
```

- [ ] **Step 3: Commit**

```bash
git add packages/gui/src/stores/settings.ts packages/gui/src/stores/ui.ts
git commit -m "feat(gui): add settings and ui Pinia stores"
```

---

## Phase 4: Composables

### Task 4.1: Create all composables

**Files:**
- Create: `packages/gui/src/composables/useFloating.ts`
- Create: `packages/gui/src/composables/useTooltip.ts`
- Create: `packages/gui/src/composables/useKeyboard.ts`
- Create: `packages/gui/src/composables/useVirtualScroll.ts`
- Create: `packages/gui/src/composables/useEventMarkers.ts`

**Consumes:** floating.ts logic, tooltip.ts logic, app.ts keyboard handler, app.ts virtual scroll, player-event-markers.ts

- [ ] **Step 1: Write useFloating composable**

Write `packages/gui/src/composables/useFloating.ts`:

```typescript
import { computePosition, offset, flip, shift, arrow, autoUpdate } from '@floating-ui/dom';
import type { ReferenceElement, FloatingElement, Placement, Middleware, VirtualElement } from '@floating-ui/dom';

export interface FloatingOptions {
  placement?: Placement;
  offset?: number;
  middleware?: Middleware[];
}

export function positionFloating(
  reference: ReferenceElement,
  floating: FloatingElement,
  opts: FloatingOptions = {},
): Promise<void> {
  return computePosition(reference, floating, {
    placement: opts.placement ?? 'top',
    middleware: [
      offset(opts.offset ?? 8),
      flip(),
      shift({ padding: 8 }),
      ...(opts.middleware ?? []),
    ],
  }).then(({ x, y, placement, middlewareData }) => {
    Object.assign(floating.style, { left: `${x}px`, top: `${y}px` });
    const arrowEl = floating.querySelector<HTMLElement>('.floating-arrow');
    if (arrowEl) {
      const arrowData = middlewareData.arrow;
      const staticSide = { top: 'bottom', right: 'left', bottom: 'top', left: 'right' }[placement.split('-')[0]!];
      if (arrowData && staticSide) {
        Object.assign(arrowEl.style, {
          left: arrowData.x != null ? `${arrowData.x}px` : '',
          top: arrowData.y != null ? `${arrowData.y}px` : '',
          [staticSide]: '-4px',
        });
      }
    }
  });
}

export function autoUpdateFloating(
  reference: ReferenceElement,
  floating: FloatingElement,
  opts: FloatingOptions = {},
): () => void {
  return autoUpdate(reference, floating, () => { void positionFloating(reference, floating, opts); });
}

export function createArrow(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'floating-arrow';
  return el;
}

export function referenceAtX(el: HTMLElement, x: number): VirtualElement {
  const rect = el.getBoundingClientRect();
  return {
    getBoundingClientRect() {
      return DOMRect.fromRect({
        x: Math.max(rect.left, Math.min(x, rect.right)),
        y: rect.top,
        width: 0,
        height: rect.height,
      });
    },
  };
}
```

- [ ] **Step 2: Write useTooltip composable**

Write `packages/gui/src/composables/useTooltip.ts`:

```typescript
import { ref, onUnmounted } from 'vue';
import { positionFloating, createArrow, referenceAtX } from './useFloating.ts';

const TOOLTIP_DELAY_MS = 800;

export function useTooltip() {
  const tooltipEl = ref<HTMLElement | null>(null);
  const visible = ref(false);
  const text = ref('');
  let timer: number | null = null;
  let target: HTMLElement | null = null;
  let cursorX = 0;

  function ensureElement(): HTMLElement {
    if (tooltipEl.value) return tooltipEl.value;
    const el = document.createElement('div');
    el.className = 'tooltip';
    el.setAttribute('role', 'tooltip');
    const body = document.createElement('span');
    body.className = 'tooltip-body';
    el.appendChild(body);
    el.appendChild(createArrow());
    document.body.appendChild(el);
    tooltipEl.value = el;
    return el;
  }

  function show(t: HTMLElement, tipText: string, x: number) {
    clearTimer();
    target = t;
    cursorX = x;
    text.value = tipText;
    const el = ensureElement();
    const body = el.querySelector<HTMLElement>('.tooltip-body');
    if (body) body.textContent = tipText;
    visible.value = true;
    el.classList.add('is-visible');
    const ref = referenceAtX(t, x);
    positionFloating(ref, el);
  }

  function schedule(t: HTMLElement, tipText: string, x: number) {
    clearTimer();
    target = t;
    cursorX = x;
    timer = window.setTimeout(() => {
      timer = null;
      show(t, tipText, x);
    }, TOOLTIP_DELAY_MS);
  }

  function reposition(x: number) {
    cursorX = x;
    if (!visible.value || !target || !tooltipEl.value) return;
    const ref = referenceAtX(target, x);
    positionFloating(ref, tooltipEl.value);
  }

  function hide() {
    clearTimer();
    target = null;
    visible.value = false;
    tooltipEl.value?.classList.remove('is-visible');
  }

  function clearTimer() {
    if (timer != null) { clearTimeout(timer); timer = null; }
  }

  onUnmounted(() => {
    clearTimer();
    tooltipEl.value?.remove();
  });

  return { tooltipEl, visible, text, show, schedule, reposition, hide };
}
```

- [ ] **Step 3: Write useKeyboard composable**

Write `packages/gui/src/composables/useKeyboard.ts`:

```typescript
import { onMounted, onUnmounted } from 'vue';

export function useKeyboard(handler: (e: KeyboardEvent) => void) {
  onMounted(() => document.addEventListener('keydown', handler));
  onUnmounted(() => document.removeEventListener('keydown', handler));
}

export function useKeydown(handler: (e: KeyboardEvent) => void, options?: AddEventListenerOptions) {
  onMounted(() => document.addEventListener('keydown', handler, options));
  onUnmounted(() => document.removeEventListener('keydown', handler, options));
}
```

- [ ] **Step 4: Write useVirtualScroll composable**

Write `packages/gui/src/composables/useVirtualScroll.ts`:

```typescript
import { ref, computed, watch, type Ref } from 'vue';
import type { MatchRecord } from '@wonderful-ui/parser';

export const ROW_HEIGHT = 104;
export const ROW_BUFFER = 5;

export function useVirtualScroll(
  matches: Ref<MatchRecord[]>,
  containerRef: Ref<HTMLElement | null>,
) {
  const scrollTop = ref(0);

  const totalHeight = computed(() => matches.value.length * ROW_HEIGHT);

  const visibleRange = computed(() => {
    const start = Math.max(0, Math.floor(scrollTop.value / ROW_HEIGHT) - ROW_BUFFER);
    const end = Math.min(
      matches.value.length,
      Math.ceil((scrollTop.value + 600) / ROW_HEIGHT) + ROW_BUFFER,
    );
    return { start, end };
  });

  const visibleMatches = computed(() => {
    const { start, end } = visibleRange.value;
    return matches.value.slice(start, end).map((m, i) => ({
      match: m,
      index: start + i,
      y: (start + i) * ROW_HEIGHT,
    }));
  });

  function onScroll() {
    const el = containerRef.value;
    if (!el) return;
    scrollTop.value = el.scrollTop;
  }

  function scrollToIndex(index: number) {
    const el = containerRef.value;
    if (el) el.scrollTop = index * ROW_HEIGHT;
  }

  return {
    totalHeight, visibleRange, visibleMatches,
    onScroll, scrollToIndex,
  };
}
```

- [ ] **Step 5: Write useEventMarkers composable**

Write `packages/gui/src/composables/useEventMarkers.ts`:

```typescript
import { ref, watch, type Ref } from 'vue';
import { layoutEventMarkers, renderCanvasMarkers, CANVAS_MARKER_THRESHOLD, type EventMarkerLayout } from '../utils/player-event-markers.ts';
import { eventMarkersForVideo, type EventMarker } from '../utils/match-events.ts';
import type { VideoItem, MatchRecord } from '@wonderful-ui/parser';

export function useEventMarkers(
  video: Ref<VideoItem | null>,
  match: Ref<MatchRecord | null>,
  canvasRef: Ref<HTMLCanvasElement | null>,
) {
  const markers = ref<EventMarker[]>([]);
  const layouts = ref<EventMarkerLayout[]>([]);
  const useCanvas = ref(false);

  function recompute() {
    if (!video.value || !match.value) {
      markers.value = [];
      layouts.value = [];
      return;
    }
    markers.value = eventMarkersForVideo(video.value, match.value);
    useCanvas.value = markers.value.length > CANVAS_MARKER_THRESHOLD;
  }

  function renderLayouts(width: number) {
    if (markers.value.length === 0) { layouts.value = []; return; }
    layouts.value = layoutEventMarkers(markers.value, width);
  }

  function drawCanvas(width: number, height: number) {
    const cvs = canvasRef.value;
    if (!cvs || !useCanvas.value) return;
    const ctx = cvs.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    cvs.width = width * dpr;
    cvs.height = height * dpr;
    cvs.style.width = `${width}px`;
    cvs.style.height = `${height}px`;
    ctx.scale(dpr, dpr);
    renderCanvasMarkers(ctx, layouts.value, width, height);
  }

  watch([video, match], recompute, { immediate: true });

  return { markers, layouts, useCanvas, recompute, renderLayouts, drawCanvas };
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/gui/src/composables/
git commit -m "feat(gui): add floating, tooltip, keyboard, virtual-scroll, event-markers composables"
```

---

## Phase 5: Layout & App Shell

### Task 5.1: Build App.vue with full layout

**Files:**
- Modify: `packages/gui/src/App.vue`
- Create: `packages/gui/src/components/common/ToastHost.vue`
- Create: `packages/gui/src/components/common/BootOverlay.vue`
- Modify: `packages/gui/src/assets/style.css` (add fonts import and CSS custom properties)

**Consumes:** All stores (Phase 3), router (Task 1.3)
**Produces:** Full app shell with sidebar + router-view + tooltips + toast + boot overlay

- [ ] **Step 0 (pre-step): Write BootOverlay.vue**

Port `scan-progress.ts` logic into a Vue component. Mounts during app boot and full scans:
```vue
<template>
  <Transition name="boot-fade">
    <div v-if="visible" class="scan-progress-root" :class="mode">
      <div class="scan-progress">
        <div class="scan-brand"><!-- brand lockup --></div>
        <div class="scan-bar"><div class="scan-bar-fill" :style="{ width: pct + '%' }" /></div>
        <div class="scan-label">{{ label }}</div>
      </div>
    </div>
  </Transition>
</template>
```
Expose `start(mode, opts)`, `update(label, pct)`, `complete()` methods via `defineExpose`. Listen to `wui://phase` and `wui://account_*` Tauri events to advance progress. Keep the `injectManifestDomRefresh` logic for smooth transitions.

- [ ] **Step 1: Write updated App.vue**

Write `packages/gui/src/App.vue`:

```vue
<template>
  <div class="app" :class="{ 'is-filter-open': filter.filterBarOpen }">
    <TopBar />
    <div class="panes">
      <AccountSidebar />
      <FilterRail v-if="filter.filterBarOpen" />
      <RouterView />
    </div>
    <ToastHost />
  </div>
</template>

<script setup lang="ts">
import { RouterView } from 'vue-router';
import { useFilterStore } from './stores/filter.ts';
import TopBar from './components/layout/TopBar.vue';
import AccountSidebar from './components/common/AccountSidebar.vue';
import FilterRail from './components/match/FilterRail.vue';
import ToastHost from './components/common/ToastHost.vue';
import { watch, onMounted } from 'vue';
import { useAccountStore } from './stores/account.ts';
import { useSettingsStore } from './stores/settings.ts';

const filter = useFilterStore();
const account = useAccountStore();
const settings = useSettingsStore();

onMounted(async () => {
  // Boot sequence: scan_shell -> load_library -> cache_assets
  try {
    await account.scanShell();
    await account.loadLibrary();
    await account.cacheAssets();
    if (account.realAccounts.length > 0) {
      account.selectAccount('__all__');
    }
  } catch (e) {
    console.error('Boot failed:', e);
  }
});

// Ensure settings data is fetched when opened
watch(() => settings.isOpen, (open) => {
  if (open) {
    if (!settings.statsData && !settings.statsLoading && !settings.statsError) {
      void settings.fetchLibraryStats();
    }
  }
});
</script>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  background: var(--color-bg);
}

.panes {
  display: flex;
  flex: 1;
  overflow: hidden;
}
</style>
```

- [ ] **Step 2: Write ToastHost.vue**

Write `packages/gui/src/components/common/ToastHost.vue`:

```vue
<template>
  <div id="toast-host">
    <TransitionGroup name="toast">
      <div
        v-for="t in toasts"
        :key="t.id"
        :class="['toast', t.kind]"
      >{{ t.message }}</div>
    </TransitionGroup>
  </div>
</template>

<script setup lang="ts">
import { ref, onUnmounted } from 'vue';

interface Toast {
  id: number;
  message: string;
  kind: 'ok' | 'error';
}

const toasts = ref<Toast[]>([]);
let nextId = 0;

function show(message: string, kind: 'ok' | 'error' = 'ok') {
  const id = nextId++;
  toasts.value.push({ id, message, kind });
  const duration = kind === 'error' ? 6000 : 2500;
  setTimeout(() => {
    toasts.value = toasts.value.filter(t => t.id !== id);
  }, duration);
}

// Expose for use by other components
(window as unknown as Record<string, unknown>).__wuiToast = show;

onUnmounted(() => {
  delete (window as unknown as Record<string, unknown>).__wuiToast;
});
</script>
```

- [ ] **Step 3: Commit**

```bash
git add packages/gui/src/App.vue packages/gui/src/components/common/ToastHost.vue
git commit -m "feat(gui): build app shell with topbar, sidebar, router-view, toast"
```

### Task 5.2: Build TopBar component

**Files:**
- Create: `packages/gui/src/components/layout/TopBar.vue`

**Consumes:** BRAND_NAME exports from app.ts

- [ ] **Step 1: Write TopBar.vue**

Write `packages/gui/src/components/layout/TopBar.vue`:

```vue
<template>
  <header class="topbar">
    <div class="brand">
      <img class="brand-logo" :src="brandLogoUrl" alt="" aria-hidden="true" width="36" height="36" decoding="async" />
      <span class="brand-wordmark" aria-label="WonderfulUI">
        <span class="brand-name brand-name-base">Wonderful</span>
        <span class="brand-name brand-name-accent">UI</span>
      </span>
    </div>
    <div class="topbar-center">
      <input
        class="search"
        type="text"
        placeholder="搜索 英雄 / 地图 / 模式 / 短码"
        :value="filter.filters.query"
        aria-label="搜索高光"
        @input="onQueryInput"
        @keydown.escape="onQueryEscape"
      />
    </div>
    <div class="topbar-right">
      <button
        class="iconbtn scrape-btn"
        :class="{ 'is-loading': account.scraping }"
        :aria-label="account.scraping ? '正在扫描资料库' : scanLabel + '资料库'"
        :data-tip="account.scraping ? '正在扫描资料库' : scanLabel + '资料库'"
        type="button"
        :disabled="account.scraping"
        @click="onScrape"
      >
        <RefreshCw :size="16" />
      </button>
      <button
        class="iconbtn settings-btn"
        :class="{ 'is-active': settings.isOpen }"
        aria-label="设置"
        data-tip="设置"
        type="button"
        @click="settings.setOpen(true)"
      >
        <Settings :size="16" />
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { RefreshCw, Settings } from 'lucide-vue-next';
import { useAccountStore } from '../../stores/account.ts';
import { useFilterStore } from '../../stores/filter.ts';
import { useSettingsStore } from '../../stores/settings.ts';
import { useRouter } from 'vue-router';

const account = useAccountStore();
const filter = useFilterStore();
const settings = useSettingsStore();
const router = useRouter();

const brandLogoUrl = new URL('../../assets/logo.svg', import.meta.url).href;

const scanLabel = computed(() => filter.refreshScanMode === 'full' ? '全量扫描' : '增量扫描');

function onQueryInput(e: Event) {
  filter.setFilters({ query: (e.target as HTMLInputElement).value });
}

function onQueryEscape(e: Event) {
  filter.setFilters({ query: '' });
  (e.target as HTMLInputElement).value = '';
}

async function onScrape() {
  await account.scrapeLibrary(filter.refreshScanMode);
  (window as unknown as Record<string, unknown>).__wuiToast?.('资料库已' + scanLabel.value, 'ok');
}
</script>
```

- [ ] **Step 2: Commit**

```bash
git add packages/gui/src/components/layout/TopBar.vue
git commit -m "feat(gui): add TopBar layout component"
```

---

## Phase 6: Views

### Task 6.1: Build HomeView (match list view)

**Files:**
- Modify: `packages/gui/src/views/HomeView.vue`
- Create: `packages/gui/src/components/match/MatchList.vue`
- Create: `packages/gui/src/components/match/MatchCard.vue`

**Consumes:** Account store, Filter store, Detail store

- [ ] **Step 1: Write HomeView.vue**

Write `packages/gui/src/views/HomeView.vue`:

```vue
<template>
  <main class="pane list" aria-label="高光列表">
    <div class="pane-head">
      <div class="pane-title-row">
        <span class="pane-title">对局列表</span>
        <button
          class="scope-filter-toggle"
          :class="{ 'is-open': filter.filterBarOpen }"
          type="button"
          :aria-label="filter.filterBarOpen ? '收起筛选' : '展开筛选'"
          :aria-pressed="String(filter.filterBarOpen)"
          data-tip="展开筛选"
          @click="filter.toggleFilterBar()"
        >
          <SlidersHorizontal :size="14" />
          <span v-if="filter.activeCount > 0" class="scope-filter-toggle-count">{{ filter.activeCount }}</span>
        </button>
      </div>
      <div class="pane-head-right">
        <span class="pane-sub">
          <template v-if="filter.activeCount > 0 || filter.filters.query.trim()">
            {{ filteredMatches.length }} / {{ accountMatches.length }} 条
          </template>
          <template v-else>{{ accountMatches.length }} 条 · 时间倒序</template>
        </span>
      </div>
    </div>
    <div class="match-list" role="listbox" ref="listRef" @scroll="onScroll">
      <div class="vlist-spacer" :style="{ height: totalHeight + 'px' }" />
      <MatchCard
        v-for="item in visibleMatches"
        :key="item.match.matches_id"
        :match="item.match"
        :style="{ position: 'absolute', top: '0', left: '0', right: '0', transform: 'translateY(' + item.y + 'px)' }"
        :is-selected="item.match.matches_id === detail.selectedMatch?.matches_id"
        :account-label="account.accountLabels.get(item.match.openID) ?? item.match.openID"
        @click="detail.selectMatch(item.match)"
        @dblclick="playFirst(item.match)"
      />
    </div>
    <div v-if="accountMatches.length === 0" class="empty">
      <div class="empty-title">这个账户还没录到高光</div>
      <div class="empty-sub">去打一局 VALORANT 吧</div>
    </div>
    <div v-else-if="filteredMatches.length === 0" class="empty">
      <div class="empty-title">没有匹配</div>
      <div class="empty-sub">
        <template v-if="filter.activeCount > 0">
          {{ accountMatches.length }} 条中无结果 · {{ filter.summary }}
        </template>
        <template v-else>搜索 "{{ filter.filters.query }}" 在 {{ accountMatches.length }} 条中没结果</template>
      </div>
      <button class="btn btn-primary" style="margin-top:12px" @click="filter.clearFilter('__all__')">清除全部筛选</button>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue';
import { SlidersHorizontal } from 'lucide-vue-next';
import { useAccountStore } from '../stores/account.ts';
import { useFilterStore } from '../stores/filter.ts';
import { useDetailStore } from '../stores/detail.ts';
import { usePlayerStore } from '../stores/player.ts';
import { useVirtualScroll } from '../composables/useVirtualScroll.ts';
import MatchCard from '../components/match/MatchCard.vue';

const account = useAccountStore();
const filter = useFilterStore();
const detail = useDetailStore();
const player = usePlayerStore();

const listRef = ref<HTMLElement | null>(null);

const accountMatches = computed(() => {
  const all = account.matches;
  const openid = account.selectedAccountId;
  if (!openid || openid === '__all__') return [...all].sort((a, b) => b.matches_time - a.matches_time);
  return all.filter(m => m.openID === openid).sort((a, b) => b.matches_time - a.matches_time);
});

const filteredMatches = computed(() => filter.applyToMatches(account.matches, accountMatches.value));

const { totalHeight, visibleMatches, onScroll } = useVirtualScroll(filteredMatches, listRef);

function playFirst(m: MatchRecord) {
  const video = m.videos[0];
  if (!video) return;
  player.open(video, m);
}
</script>
```

- [ ] **Step 2: Write MatchCard.vue**

Write `packages/gui/src/components/match/MatchCard.vue`:
(Contains the full match row card: cover with map bg + hero + MVP badge, 3 info lines, footer with time + account)

Due to file length, this task writes the complete component inline. Key template: `<div class="match-row" :class="{ 'is-selected': isSelected }">` with cover section and meta section (agent, map, KDA, video count, time, account).

- [ ] **Step 3: Commit**

```bash
git add packages/gui/src/views/HomeView.vue packages/gui/src/components/match/MatchCard.vue
git commit -m "feat(gui): add HomeView and MatchCard components"
```

### Task 6.2: Build DetailView

**Files:**
- Create: `packages/gui/src/views/DetailView.vue`

**Consumes:** Detail store, Account store, Filter store match data

- [ ] **Step 1: Write DetailView.vue**

Full detail pane: hero avatar, agent name + result pill, stat grid (kills/deaths/assists/KDA/score/events), montage video cards, moment video cards with type filter chips.

- [ ] **Step 2: Commit**

```bash
git add packages/gui/src/views/DetailView.vue
git commit -m "feat(gui): add DetailView component"
```

### Task 6.3: Build SettingsView

**Files:**
- Create: `packages/gui/src/views/SettingsView.vue`
- Create: `packages/gui/src/components/settings/SettingsModal.vue`

**Consumes:** Settings store, Filter store (scan mode), library-stats.ts chart functions

- [ ] **Step 1: Write SettingsView/SettingsModal**

Modal overlay with nav tabs (资料库/日志), library stats with metrics, scan settings, log viewer.

Port `mountAccountVideoChart` from `utils/library-stats.ts`: call it in `onMounted` with a `ref` to the chart container `<div>`. Dispose on `onUnmounted`. Wrap ECharts init/dispose lifecycle in a composable `useChart`. The `chartMetric` toggles are handled by the settings store.

- [ ] **Step 2: Commit**

```bash
git add packages/gui/src/views/SettingsView.vue packages/gui/src/components/settings/SettingsModal.vue
git commit -m "feat(gui): add SettingsView and SettingsModal components"
```

---

## Phase 7: Common Components

### Task 7.1: Build AccountSidebar

**Files:**
- Create: `packages/gui/src/components/common/AccountSidebar.vue`

**Consumes:** Account store, Filter store (filtered counts)

- [ ] **Step 1: Write AccountSidebar.vue**

Left sidebar with account list, sortable drag handles, rename inline edit, "全部" sentinel, filtered count badges, MVP/SVP achievements feed into match cards.

- [ ] **Step 2: Commit**

```bash
git add packages/gui/src/components/common/AccountSidebar.vue
git commit -m "feat(gui): add AccountSidebar component"
```

### Task 7.2: Build PlayerHost and related components

**Files:**
- Create: `packages/gui/src/components/player/PlayerHost.vue`
- Create: `packages/gui/src/components/player/ProgressBar.vue`
- Create: `packages/gui/src/components/player/PlayerControls.vue`

**Consumes:** Player store, existing player.ts logic (ported to component + composable)

- [ ] **Step 1: Write PlayerHost.vue**

Full video player modal: backdrop, stage with `<video>`, controls bar (play/pause, time, progress bar with event markers, volume, explorer, fullscreen), keyboard shortcuts. Port all 1019 lines of player.ts into Vue component logic.

- [ ] **Step 2: Write ProgressBar.vue**

Progress bar with DOM event markers (<=20) or Canvas markers (>20), drag-to-seek, click-to-seek.

- [ ] **Step 3: Write PlayerControls.vue**

Play/pause, prev/next video, time display, volume slider, explorer button, fullscreen button.

- [ ] **Step 4: Commit**

```bash
git add packages/gui/src/components/player/
git commit -m "feat(gui): add PlayerHost, ProgressBar, PlayerControls"
```

### Task 7.3: Build event-list components

**Files:**
- Create: `packages/gui/src/components/event/EventListModal.vue`
- Create: `packages/gui/src/components/event/EventRow.vue`

**Consumes:** event-list-modal.ts logic, utils/match-events.ts

- [ ] **Step 1: Write EventListModal.vue**

Backdrop + modal: header with match label + kill/death counts, scrollable table of event rows, footer hint. Escape key closes. Lives in `#player-host` area.

- [ ] **Step 2: Write EventRow.vue**

Single event row: time, kill/death icon + type, player name, weapon name, headshot/assist extras. Click opens player at seek time.

- [ ] **Step 3: Commit**

```bash
git add packages/gui/src/components/event/
git commit -m "feat(gui): add EventListModal and EventRow components"
```

### Task 7.4: Build FilterRail and FilterBar

**Files:**
- Create: `packages/gui/src/components/match/FilterRail.vue`
- Create: `packages/gui/src/components/match/FilterBar.vue`

**Consumes:** filter-bar.ts logic, utils/date-picker.ts

- [ ] **Step 1: Write FilterRail.vue**

Sidebar rail container with header, scrollable body, footer clear button.

- [ ] **Step 2: Write FilterBar.vue**

Filter sections: category chips (heroes/maps/modes/results/achievements/videoTypes), range sliders (kills/deaths/assists/etc.), date range picker, applied chips row.

Port `createDateRangePicker` from `utils/date-picker.ts` into a `<DateRangePicker>` sub-component used inside FilterBar. The date picker emits `update:modelValue` with `[Date | null, Date | null]`.

- [ ] **Step 3: Commit**

```bash
git add packages/gui/src/components/match/FilterRail.vue packages/gui/src/components/match/FilterBar.vue
git commit -m "feat(gui): add FilterRail and FilterBar components"
```

---

## Phase 8: CSS Migration

### Task 8.1: Extract component CSS from style.css into scoped styles

**Files:**
- Read: `packages/gui/src/style.css` (3405 lines)
- Modify: every `.vue` component (add `<style scoped>` blocks)
- Modify: `packages/gui/src/assets/style.css` (strip to only custom properties, reset, fonts)

**Produces:** All visual styles moved into their respective component files, matching current appearance pixel-for-pixel.

- [ ] **Step 1: Extract global essentials into assets/style.css**

Keep only `@import`, `:root` custom properties, reset (`*, *::before, *::after`, `html, body`), `#app`, `#player-host`, scrollbar styles, and base element overrides (`a`, `button`, `input`, `img`). Remove all component-specific selectors.

- [ ] **Step 2: Extract TopBar styles**

Move `.topbar`, `.brand`, `.brand-logo`, `.brand-wordmark`, `.brand-name`, `.search`, `.topbar-center`, `.topbar-right`, `.iconbtn`, `.scrape-btn`, `.settings-btn` into `TopBar.vue` `<style scoped>`.

- [ ] **Step 3: Extract AccountSidebar styles**

Move `.accounts`, `.account`, `.account-main`, `.account-grip`, `.account-name`, `.account-count`, `.account-edit-btn`, `.account-rename-input`, `.is-editing`, `.is-selected`, `.is-all`, `.is-error`, `.is-filter-empty`, `.account-sortable-list`, sortable classes into `AccountSidebar.vue`.

- [ ] **Step 4: Extract MatchCard styles**

Move `.match-row`, `.match-cover`, `.cover-bg`, `.cover-bg-fallback`, `.hero-img`, `.hero-placeholder`, `.cover-badge`, `.match-meta`, `.match-line`, `.match-agent`, `.match-result-pill`, `.match-map`, `.match-mode`, `.match-kda`, `.match-video-chip`, `.match-footer`, `.match-time`, `.match-sep-dot`, `.match-account` into `MatchCard.vue`.

- [ ] **Step 5: Extract FilterBar styles**

Move `.filter-rail`, `.filter-section`, `.filter-section-title`, `.filter-chips`, `.filter-chip`, `.filter-slider`, `.filter-slider-track`, `.filter-slider-fill`, `.filter-slider-thumb`, `.filter-slider-bubble`, `.filter-slider-val`, `.filter-rail-body`, `.filter-rail-footer`, `.filter-rail-clear`, `.filter-applied`, `.filter-applied-chip`, `.pane-head`, `.pane-head-right`, `.scope-filter-toggle` into `FilterBar.vue` and `FilterRail.vue`.

- [ ] **Step 6: Extract DetailView styles**

Move `.detail`, `.detail-header`, `.hero-avatar`, `.detail-header-meta`, `.detail-agent-row`, `.detail-agent`, `.detail-sub`, `.detail-stats-row`, `.stat-cell`, `.stat-icon`, `.stat-value`, `.stat-label`, `.detail-section`, `.section-title`, `.montage-grid`, `.montage-card`, `.montage-cover`, `.montage-info`, `.montage-title`, `.montage-meta`, `.moment-grid`, `.moment-card`, `.moment-cover`, `.moment-info`, `.moment-name`, `.moment-duration`, `.moment-chips`, `.moment-chip`, `.resolution-chip`, `.btn-play`, `.event-stat-cell`, `.event-stat-spinner` into `DetailView.vue`.

- [ ] **Step 7: Extract PlayerHost/PlayerControls/ProgressBar styles**

Move `.player-backdrop`, `.player-modal`, `.player-stage`, `.player-video`, `.player-controls`, `.player-progress-wrap`, `.player-progress-track`, `.player-progress-fill`, `.player-progress-thumb`, `.player-ctrl`, `.player-ctrl-play`, `.player-ctrl-vol`, `.player-vol-track`, `.player-vol-fill`, `.player-time`, `.player-close-top`, `.is-playing`, `.is-paused`, `.is-muted`, `.player-event-marker`, `.player-event-marker-label`, `.player-event-marker-dot`, all player animation classes into respective player Vue files.

- [ ] **Step 8: Extract EventListModal styles**

Move `.event-list-modal-backdrop`, `.event-list-modal`, `.event-list-modal-header`, `.event-list-modal-title`, `.event-list-modal-sub`, `.event-list-modal-close`, `.event-list-scroll`, `.event-list-row`, `.event-list-row-head`, `.event-list-col-time`, `.event-list-col-type`, `.event-list-col-player`, `.event-list-col-weapon`, `.event-list-col-extra`, `.event-list-modal-footer` into `EventListModal.vue` and `EventRow.vue`.

- [ ] **Step 9: Extract SettingsModal styles**

Move `.settings-modal-backdrop`, `.settings-modal`, `.settings-modal-head`, `.settings-title`, `.settings-close`, `.settings-modal-body`, `.settings-nav`, `.settings-nav-item`, `.settings-content`, `.settings-section`, `.settings-section-head`, `.settings-row`, `.settings-row-main`, `.settings-row-title`, `.settings-row-sub`, `.settings-action`, `.settings-segment`, `.settings-segment-btn`, `.stats-video-body`, `.stats-video-summary`, `.stats-video-metric`, `.stats-video-value`, `.stats-video-label`, `.stats-video-chart`, `.stats-video-warn`, `.stats-video-notice`, `.settings-log-panel`, `.settings-log-toolbar`, `.settings-log-identity`, `.settings-log-icon`, `.settings-log-copy`, `.settings-log-name`, `.settings-log-statusline`, `.settings-log-actions`, `.settings-log-viewer`, `.settings-log-preview` into `SettingsModal.vue`.

- [ ] **Step 10: Extract Tooltip and Toast styles**

Move `.tooltip`, `.tooltip-body`, `.floating-arrow`, `.tooltip.is-visible`, `.toast-host`, `.toast`, `.toast.ok`, `.toast.error`, `.toast.is-closing` into respective component files or keep minimal versions in `assets/style.css` (tooltip is appended to body, must be global).

- [ ] **Step 11: Extract remaining utility styles**

Move `.empty`, `.empty-title`, `.empty-sub`, `.empty-hint`, `.empty-inline`, `.error`, `.error-message`, `.btn`, `.btn-primary`, `.pane`, `.pane-head`, `.pane-title`, `.pane-sub`, `.pane-title-row`, `.search`, `.is-filter-open`, `.is-closing`, `.is-loading`, `.is-active`, `.is-selected`, `.spin`, `.match-list`, `.vlist-spacer`, `.app`, `.topbar`, `.panes`, `.is-filtering` to `assets/style.css` (shared utility classes) or respective components.

- [ ] **Step 12: Verify visual output**

Run: `bun run --cwd packages/gui dev`
Manual check: All layouts, colors, spacing, typography match current design.

- [ ] **Step 13: Commit**

```bash
git add packages/gui/src/assets/style.css packages/gui/src/components/ packages/gui/src/views/
git commit -m "feat(gui): migrate CSS into component scoped styles"
```

---

## Phase 9: Router & Navigation Integration

### Task 9.1: Wire all routes

**Files:**
- Modify: `packages/gui/src/router/index.ts`

**Produces:** Complete route table with all views accessible

- [ ] **Step 1: Update router with all routes**

```typescript
import { createRouter, createMemoryHistory } from 'vue-router';
import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: () => import('../views/HomeView.vue'),
  },
  {
    path: '/match/:id',
    name: 'detail',
    component: () => import('../views/DetailView.vue'),
    props: true,
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('../views/SettingsView.vue'),
  },
];

export const router = createRouter({
  history: createMemoryHistory(),
  routes,
});
```

- [ ] **Step 2: Wire navigation from match list to detail**

In HomeView, on match click: `router.push({ name: 'detail', params: { id: match.matches_id } })`.

- [ ] **Step 3: Wire navigation from settings button**

In TopBar, on settings click: `router.push({ name: 'settings' })`. SettingsView renders `SettingsModal` as overlay.

- [ ] **Step 4: Verify navigation**

Run: `bun run --cwd packages/gui dev`
Manual: Click match -> detail view shows. Settings button -> settings overlay. Close/back -> return to list.

- [ ] **Step 5: Commit**

```bash
git add packages/gui/src/router/index.ts packages/gui/src/views/ packages/gui/src/components/layout/TopBar.vue
git commit -m "feat(gui): wire vue-router navigation between views"
```

---

## Phase 10: Cleanup & Verification

### Task 10.1: Remove old vanilla source files

**Files:**
- Delete: `packages/gui/src/app.ts` (logic moved to stores + components)
- Delete: `packages/gui/src/player.ts` (moved to PlayerHost.vue + store)
- Delete: `packages/gui/src/filter-bar.ts` (moved to FilterRail.vue + FilterBar.vue)
- Delete: `packages/gui/src/event-list-modal.ts` (moved to EventListModal.vue)
- Delete: `packages/gui/src/settings-modal.ts` (moved to SettingsModal.vue)
- Delete: `packages/gui/src/tooltip.ts` (moved to useTooltip composable)
- Delete: `packages/gui/src/floating.ts` (moved to useFloating composable)
- Delete: `packages/gui/src/event-state-machine.ts` (moved to utils/)
- Delete: `packages/gui/src/match-events.ts` (moved to utils/)
- Delete: `packages/gui/src/event-time.ts` (moved to utils/)
- Delete: `packages/gui/src/weapons.ts` (moved to utils/)
- Delete: `packages/gui/src/filters.ts` (moved to utils/)
- Delete: `packages/gui/src/filter-engine.ts` (moved to utils/)
- Delete: `packages/gui/src/account-preferences.ts` (moved to utils/)
- Delete: `packages/gui/src/dom.ts` (moved to utils/)
- Delete: `packages/gui/src/scan-progress.ts` (moved to utils/)
- Delete: `packages/gui/src/library-stats.ts` (moved to utils/)
- Delete: `packages/gui/src/date-picker.ts` (moved to utils/)
- Delete: `packages/gui/src/player-event-markers.ts` (moved to utils/)
- Delete: `packages/gui/src/render-pulse.ts` (moved to utils/)
- Delete: `packages/gui/src/style.css` (CSS moved to components + assets/)
- Delete: `packages/gui/src/generated/` (moved to utils/generated/)

- [ ] **Step 1: Remove old files**

Run:
```powershell
Remove-Item -Force -LiteralPath "packages/gui/src/app.ts"
Remove-Item -Force -LiteralPath "packages/gui/src/player.ts"
Remove-Item -Force -LiteralPath "packages/gui/src/filter-bar.ts"
Remove-Item -Force -LiteralPath "packages/gui/src/event-list-modal.ts"
Remove-Item -Force -LiteralPath "packages/gui/src/settings-modal.ts"
Remove-Item -Force -LiteralPath "packages/gui/src/tooltip.ts"
Remove-Item -Force -LiteralPath "packages/gui/src/floating.ts"
Remove-Item -Force -LiteralPath "packages/gui/src/event-state-machine.ts"
Remove-Item -Force -LiteralPath "packages/gui/src/match-events.ts"
Remove-Item -Force -LiteralPath "packages/gui/src/event-time.ts"
Remove-Item -Force -LiteralPath "packages/gui/src/weapons.ts"
Remove-Item -Force -LiteralPath "packages/gui/src/filters.ts"
Remove-Item -Force -LiteralPath "packages/gui/src/filter-engine.ts"
Remove-Item -Force -LiteralPath "packages/gui/src/account-preferences.ts"
Remove-Item -Force -LiteralPath "packages/gui/src/dom.ts"
Remove-Item -Force -LiteralPath "packages/gui/src/scan-progress.ts"
Remove-Item -Force -LiteralPath "packages/gui/src/library-stats.ts"
Remove-Item -Force -LiteralPath "packages/gui/src/date-picker.ts"
Remove-Item -Force -LiteralPath "packages/gui/src/player-event-markers.ts"
Remove-Item -Force -LiteralPath "packages/gui/src/render-pulse.ts"
Remove-Item -Force -LiteralPath "packages/gui/src/style.css"
Remove-Item -Recurse -Force -LiteralPath "packages/gui/src/generated"
```

- [ ] **Step 2: Verify build passes**

Run: `bun run --cwd packages/gui build`
Expected: Vite builds successfully, no errors.

- [ ] **Step 3: Commit**

```bash
git add -A packages/gui/
git commit -m "chore(gui): remove old vanilla source files, migrated to vue 3"
```

### Task 10.2: Update tests

**Files:**
- Modify: test files that reference old module paths
- Delete: tests that test DOM construction (irrelevant after Vue migration)
- Keep: tests for pure logic in utils/

- [ ] **Step 1: Verify pure-logic tests still pass**

Run: `bun test packages/gui/test/event-state-machine.test.ts packages/gui/test/match-events.test.ts packages/gui/test/event-time.test.ts packages/gui/test/weapons.test.ts packages/gui/test/filters.test.ts`
Expected: All pass. If import paths broke, fix them to point to `utils/`.

- [ ] **Step 2: Remove DOM-specific test files**

Remove: `app-refresh-state.test.ts`, `brand.test.ts` (tests that need full DOM/app).
Keep: `account-preferences.test.ts`, `event-list-modal.test.ts` (update to test logic only), `library-stats.test.ts`, `player-event-markers.test.ts`.

- [ ] **Step 3: Run all remaining tests**

Run: `bun test packages/gui`
Expected: All remaining tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/gui/test/
git commit -m "test(gui): update tests for vue 3 migration"
```

### Task 10.3: Update tsconfig and final verification

**Files:**
- Modify: `tsconfig.json` (add Vue type references)

- [ ] **Step 1: Add env.d.ts for Vue SFC types**

Create `packages/gui/src/env.d.ts`:
```typescript
/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}
```

- [ ] **Step 2: Full verification**

Run all three:
```bash
bun run --cwd packages/gui build         # Frontend builds
cargo test --release --manifest-path src-tauri/Cargo.toml --lib  # Rust OK
bun test packages/parser                 # Parser OK
```

- [ ] **Step 3: Manual visual spot-check**

Run: `bunx tauri dev`
Check: match list virtual scrolling, account sidebar sort/rename, filter rail, detail view with stats + videos, event list modal, player with progress marks, settings modal with library stats + logs.

- [ ] **Step 4: Commit**

```bash
git add packages/gui/src/env.d.ts
git commit -m "chore(gui): add vue SFC type declarations, final verification"
```

---

## Appendix: lucide-vue-next Migration

Throughout the component files (`TopBar.vue`, `MatchCard.vue`, `DetailView.vue`, `PlayerHost.vue`, `EventListModal.vue`, etc.), replace `createElement(IconName, { ... })` calls from `lucide` with `lucide-vue-next` component usage:

```bash
# Install (add to Phase 1 Task 1.1)
bun add lucide-vue-next --cwd packages/gui
```

Then replace:
- `import { createElement, Play, Settings, ... } from 'lucide';`
- With: `import { Play, Settings, ... } from 'lucide-vue-next';`
- In templates: `<Play :size="14" />` instead of `createElement(Play, { width: 14, height: 14 })`

This affects: TopBar, MatchCard, DetailView, PlayerHost, PlayerControls, EventListModal, EventRow, SettingsModal, AccountSidebar.
