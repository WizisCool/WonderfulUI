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

export interface AclosStatus {
  dir: string;
  dirExists: boolean;
  hasAccounts: boolean;
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
  const accountLabels = ref(new Map<string, string>());
  // Result of `aclos_status` (read-only probe of the ACLOS WonderfulDb
  // directory). `null` until the GUI has finished its first-run probe.
  // The GUI uses this to decide between the normal 3-pane shell and the
  // first-run / onboarding screen.
  const aclosStatus = ref<AclosStatus | null>(null);

  const realAccounts = computed(() => accounts.value);

  function assignAccountLabels() {
    const labels = new Map<string, string>();
    for (const a of accounts.value) {
      labels.set(a.openid, accountDisplayLabel(a));
    }
    accountLabels.value = labels;
  }

  const accountsForRender = computed(() => {
    if (realAccounts.value.length === 0) return [];
    return [
      { openid: ALL_ACCOUNTS, path: '', matchCount: matches.value.length },
      ...realAccounts.value,
    ] as Account[];
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
    assignAccountLabels();
  }

  async function probeAclos(dirOverride?: string): Promise<AclosStatus> {
    const status = await invoke<AclosStatus>('aclos_status', dirOverride ? { dir: dirOverride } : undefined);
    aclosStatus.value = status;
    return status;
  }

  async function loadLibrary(): Promise<void> {
    const data = await invoke<LoadResult>('load_library');
    accounts.value = data.accounts;
    matches.value = data.matches;
    dir.value = data.dir;
    totalErrors.value = data.totalErrors;
    assignAccountLabels();
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
      assignAccountLabels();
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
      assignAccountLabels();
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
    assetPathCache, loadedMatchIds, aclosStatus,
    realAccounts, accountsForRender, accountLabels, accountOrder, matchAchievements,
    scanShell, loadLibrary, scrapeLibrary, cacheAssets, probeAclos,
    selectAccount, saveAccountOrder, renameAccount,
  };
});
