import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('../src/tauri-adapter.ts', () => ({
  invoke: invokeMock,
}));

import { useAccountStore, type LoadResult } from '../src/stores/account.ts';
import { useSettingsStore, type LogStatus } from '../src/stores/settings.ts';
import type { LibraryStats } from '../src/utils/library-stats.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function libraryStats(totalVideos: number): LibraryStats {
  return {
    sourceBytes: 0,
    libraryDbBytes: 0,
    assetCacheBytes: 0,
    logBytes: 0,
    videosBytes: 0,
    missingVideosBytes: 0,
    totalVideos,
    missingVideos: 0,
    totalAccounts: 0,
    accounts: [],
    recentScans: [],
    assetKinds: [],
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  invokeMock.mockReset();
  vi.useRealTimers();
});

describe('account store request lifecycle', () => {
  test('keeps parse-error accounts visible while hiding clean empty shells', () => {
    const account = useAccountStore();
    account.accounts = [
      { openid: 'broken', path: 'D:\\WonderfulDb\\broken', matchCount: 0, error: 'parse failed' },
      { openid: 'empty', path: 'D:\\WonderfulDb\\empty', matchCount: 0 },
      { openid: 'ready', path: 'D:\\WonderfulDb\\ready', matchCount: 3 },
    ];

    expect(account.realAccounts.map(item => item.openid)).toEqual(['broken', 'ready']);
  });

  test('coalesces overlapping scrape requests and clears loading once', async () => {
    const reply = deferred<LoadResult>();
    invokeMock.mockReturnValue(reply.promise);
    const account = useAccountStore();

    const first = account.scrapeLibrary('incremental');
    const second = account.scrapeLibrary('full');

    expect(account.scraping).toBe(true);
    expect(invokeMock).toHaveBeenCalledTimes(1);

    reply.resolve({ dir: 'D:\\WonderfulDb', accounts: [], matches: [], totalErrors: 0 });
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ dir: 'D:\\WonderfulDb' }),
      expect.objectContaining({ dir: 'D:\\WonderfulDb' }),
    ]);
    expect(account.scraping).toBe(false);
  });

  test('preserves unmentioned accounts and persists one complete stable order', async () => {
    invokeMock.mockResolvedValue(undefined);
    const account = useAccountStore();
    account.accounts = [
      { openid: 'a', path: '', matchCount: 1 },
      { openid: 'b', path: '', matchCount: 1 },
      { openid: 'c', path: '', matchCount: 1 },
    ];

    await account.saveAccountOrder(['c', 'a']);

    expect(account.accounts.map(item => item.openid)).toEqual(['c', 'a', 'b']);
    expect(invokeMock).toHaveBeenCalledWith('save_account_order', {
      openids: ['c', 'a', 'b'],
    });
  });

  test('does not apply a late guarded reload over a newer manual scan', async () => {
    const staleRead = deferred<LoadResult>();
    const fresh: LoadResult = {
      dir: 'D:\\WonderfulDb',
      accounts: [{ openid: 'fresh', path: '', matchCount: 1 }],
      matches: [{ matches_id: 'fresh-match', openID: 'fresh' } as LoadResult['matches'][number]],
      totalErrors: 0,
    };
    invokeMock.mockImplementation((command: string) => {
      if (command === 'load_library') return staleRead.promise;
      if (command === 'scrape_library') return Promise.resolve(fresh);
      throw new Error(`unexpected command: ${command}`);
    });
    const account = useAccountStore();
    const expectedRevision = account.libraryRevision;

    const guardedReload = account.loadLibraryIfCurrent(expectedRevision);
    await account.scrapeLibrary('full');
    staleRead.resolve({
      dir: 'D:\\WonderfulDb',
      accounts: [{ openid: 'stale', path: '', matchCount: 1 }],
      matches: [{ matches_id: 'stale-match', openID: 'stale' } as LoadResult['matches'][number]],
      totalErrors: 0,
    });

    await expect(guardedReload).resolves.toBe(false);
    expect(account.matches[0]?.matches_id).toBe('fresh-match');
  });
});

describe('settings store request and animation lifecycle', () => {
  test('does not let repeated close calls leave an orphan timer', () => {
    vi.useFakeTimers();
    const settings = useSettingsStore();

    settings.setOpen(true);
    settings.setOpen(false);
    settings.setOpen(false);
    settings.setOpen(true);
    vi.runAllTimers();

    expect(settings.isOpen).toBe(true);
    expect(settings.isClosing).toBe(false);
  });

  test('coalesces overlapping log refreshes', async () => {
    const reply = deferred<LogStatus>();
    invokeMock.mockReturnValue(reply.promise);
    const settings = useSettingsStore();

    const first = settings.fetchLogs();
    const second = settings.fetchLogs();

    expect(settings.logLoading).toBe(true);
    expect(invokeMock).toHaveBeenCalledTimes(1);

    reply.resolve({
      logDir: 'D:\\logs',
      logPath: 'D:\\logs\\wonderful-ui.log',
      size: 12,
      modifiedMs: 1,
      maxBytes: 1024,
      latestText: 'ready',
    });
    await Promise.all([first, second]);

    expect(settings.logLoading).toBe(false);
    expect(settings.logStatus?.latestText).toBe('ready');
  });

  test('queues a fresh stats read after an older in-flight snapshot', async () => {
    const stale = deferred<LibraryStats>();
    const fresh = deferred<LibraryStats>();
    invokeMock
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(fresh.promise);
    const settings = useSettingsStore();

    const initial = settings.fetchLibraryStats();
    const refresh = settings.refreshLibraryStats();
    expect(invokeMock).toHaveBeenCalledTimes(1);

    stale.resolve(libraryStats(1));
    await initial;
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(2));

    fresh.resolve(libraryStats(2));
    await refresh;

    expect(settings.statsData?.totalVideos).toBe(2);
    expect(settings.statsLoading).toBe(false);
  });
});
