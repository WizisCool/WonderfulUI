import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { invoke } from '../tauri-adapter.ts';
import { accountDisplayLabel, applyAccountOrder } from '../utils/account-preferences.ts';
import { collectMatchAssetEntries } from '../utils/valorant-assets.ts';
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

export function isVisibleAccount(account: Account): boolean {
  return (account.matchCount ?? 0) > 0 || !!account.error?.trim();
}

export const useAccountStore = defineStore('account', () => {
  const accounts = ref<Account[]>([]);
  const selectedAccountId = ref<string | null>(null);
  const matches = ref<MatchRecord[]>([]);
  const dir = ref('');
  const totalErrors = ref(0);
  const scraping = ref(false);
  const libraryRevision = ref(0);
  const assetPathCache = ref(new Map<string, string>());
  const loadedMatchIds = ref(new Set<string>());
  const accountLabels = ref(new Map<string, string>());
  let scrapeInflight: Promise<LoadResult> | null = null;
  // Result of `aclos_status` (read-only probe of the ACLOS WonderfulDb
  // directory). `null` until the GUI has finished its first-run probe.
  // The GUI uses this to decide between the normal 3-pane shell and the
  // first-run / onboarding screen.
  const aclosStatus = ref<AclosStatus | null>(null);

  // Hide only clean, empty WonderfulDb shells. Parse failures remain visible
  // so the user has a recovery path instead of a misleading empty library.
  const realAccounts = computed(() =>
    accounts.value.filter(isVisibleAccount),
  );

  function assignAccountLabels() {
    const labels = new Map<string, string>();
    for (const a of accounts.value) {
      labels.set(a.openid, accountDisplayLabel(a));
    }
    accountLabels.value = labels;
  }

  const accountsForRender = computed(() => {
    if (realAccounts.value.length === 0) return [];
    const visible = [...realAccounts.value];
    if (matches.value.length > 0) {
      visible.unshift({ openid: ALL_ACCOUNTS, path: '', matchCount: matches.value.length });
    }
    return visible as Account[];
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
    libraryRevision.value += 1;
  }

  async function probeAclos(): Promise<AclosStatus> {
    const status = await invoke<AclosStatus>('aclos_status');
    aclosStatus.value = status;
    return status;
  }

  function applyLibrary(data: LoadResult): void {
    accounts.value = data.accounts;
    matches.value = data.matches;
    // If the selected account disappeared (e.g. purged empty shell), fall back.
    if (
      selectedAccountId.value &&
      selectedAccountId.value !== ALL_ACCOUNTS &&
      !data.accounts.some((a) => a.openid === selectedAccountId.value && isVisibleAccount(a))
    ) {
      const visible = data.accounts.filter(isVisibleAccount);
      selectedAccountId.value = data.matches.length > 0
        ? ALL_ACCOUNTS
        : (visible[0]?.openid ?? null);
    }
    dir.value = data.dir;
    totalErrors.value = data.totalErrors;
    assignAccountLabels();
    libraryRevision.value += 1;
  }

  async function loadLibrary(): Promise<void> {
    applyLibrary(await invoke<LoadResult>('load_library'));
  }

  /**
   * Reload only if no newer store result was applied while the native read was
   * in flight. Used by the startup timeout follow-up so a late background
   * completion cannot overwrite a manual scan that the user already saw.
   */
  async function loadLibraryIfCurrent(expectedRevision: number): Promise<boolean> {
    if (libraryRevision.value !== expectedRevision) return false;
    const data = await invoke<LoadResult>('load_library');
    if (libraryRevision.value !== expectedRevision) return false;
    applyLibrary(data);
    return true;
  }

  function scrapeLibrary(mode: 'incremental' | 'full' = 'incremental'): Promise<LoadResult> {
    if (scrapeInflight) return scrapeInflight;

    scraping.value = true;
    const operation = (async () => {
      const fresh = await invoke<LoadResult>('scrape_library', {
        trigger: mode === 'full' ? 'full_manual' : 'manual',
        mode,
      });
      applyLibrary(fresh);
      loadedMatchIds.value.clear();
      return fresh;
    })();
    const request = operation.finally(() => {
      if (scrapeInflight === request) {
        scrapeInflight = null;
        scraping.value = false;
      }
    });
    scrapeInflight = request;
    return request;
  }

  async function cacheAssets(): Promise<void> {
    // Single dispatcher: same resolveMatch* path as MatchCard / DetailView.
    const entries = collectMatchAssetEntries(matches.value);
    if (entries.length === 0) return;
    try {
      const results = await invoke<Record<string, string>>('cache_assets', { entries });
      for (const [url, localPath] of Object.entries(results)) {
        assetPathCache.value.set(url, localPath);
      }
    } catch { /* non-fatal */ }
  }

  function selectAccount(openid: string | null) {
    selectedAccountId.value = openid;
  }

  async function saveAccountOrder(order: string[]): Promise<void> {
    const prev = [...accounts.value];
    try {
      const ordered = applyAccountOrder(accounts.value, order);
      accounts.value = ordered;
      await invoke('save_account_order', { openids: ordered.map(account => account.openid) });
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

  return {
    accounts, selectedAccountId, matches, dir, totalErrors, scraping, libraryRevision,
    assetPathCache, loadedMatchIds, aclosStatus,
    realAccounts, accountsForRender, accountLabels, accountOrder, matchAchievements,
    scanShell, loadLibrary, loadLibraryIfCurrent, scrapeLibrary, cacheAssets, probeAclos,
    selectAccount, saveAccountOrder, renameAccount,
  };
});
