// 应用内自更新 Pinia store（第 7 个）。
//
// 封装 tauri-plugin-updater（check / downloadAndInstall）+ tauri-plugin-process
// （relaunch），组件不直接 invoke。
//
// 状态机：
//   idle        → 初始 / 重置后
//   checking    → 正在请求 latest.json（手动检查显示 loading；静默不打扰）
//   uptodate    → 检查过，无更新
//   available   → 发现新版本（modalOpen 由 caller / 手动检查决定）
//   downloading → 正在下载，progress 在变
//   installing  → 下载完，安装器接管
//   error       → 失败；errorKind 区分 check | download，驱动重试路径
//
// 启动静默检查（silent=true）失败时只 clientLog，不改 status、不弹 toast；
// 静默成功有更新：亮红点；未跳过该版本则自动开弹窗（更新 / 稍后 / 跳过此版本）。
// 「跳过此版本」写入 localStorage，同版本不再自动弹窗，红点与设置页更新保留。
// 手动检查（silent=false）失败 → status=error + toast；成功有更新直接开弹窗。
//
// happy-dom 单测 / 浏览器调试：顶层 import plugin-updater / plugin-process
// 不会 throw；actions 进入后用 hasTauri() 守门直接 return。
//
// DEV 模拟：debugSimulate 为 true 时 startUpdate/retry 走 playFakeDownload，
// 永不 downloadAndInstall / relaunch。由 utils/update-debug.ts 挂载 console API。

import { defineStore } from 'pinia';
import { ref } from 'vue';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { useUiStore } from './ui.ts';
import { clientLog } from '../utils/client-log.ts';

const SCOPE = 'update-store';

/** Fake download duration (ms). Exported for vitest fake timers. */
export const FAKE_DOWNLOAD_MS = 1600;
const FAKE_TICK_MS = 100;
const FAKE_DEFAULT_TOTAL = 10_000_000;
const DEFAULT_DEBUG_VERSION = '9.9.9';
const DEFAULT_DEBUG_BODY = '## dev 模拟更新\n- 仅 UI，不下载安装';

/** Persisted skip: auto-popup suppressed for this version only. Badge + settings remain. */
export const SKIPPED_VERSION_KEY = 'wui:update.skippedVersion';

function hasTauri(): boolean {
  return typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;
}

export function readSkippedVersion(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(SKIPPED_VERSION_KEY);
  } catch {
    return null;
  }
}

export function isVersionSkipped(version: string): boolean {
  const skipped = readSkippedVersion();
  return !!skipped && skipped === version;
}

function persistSkippedVersion(version: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(SKIPPED_VERSION_KEY, version);
  } catch {
    /* ignore quota / private mode */
  }
}

function clearSkippedVersion(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(SKIPPED_VERSION_KEY);
  } catch {
    /* ignore */
  }
}

/** Silent boot: open modal only if not already known this session and not user-skipped. */
function shouldAutoOpenOnSilent(version: string, alreadyKnown: boolean): boolean {
  if (alreadyKnown) return false;
  if (isVersionSkipped(version)) return false;
  return true;
}

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'error'
  | 'uptodate';

/** error 态的来源：决定「重试」走检查还是走下载安装。 */
export type UpdateErrorKind = 'check' | 'download';

export interface UpdateInfo {
  version: string;
  date: string;
  body: string;
}

export interface UpdateProgress {
  downloaded: number;
  total: number;
  pct: number;
}

export interface DebugAvailableOpts {
  version?: string;
  body?: string;
  /** true → badge + toast only; false → open modal */
  silent?: boolean;
}

export interface DebugDownloadingOpts {
  total?: number;
  downloaded?: number;
}

export const FRIENDLY_CHECK_ERROR = '无法连接到更新服务器';
export const FRIENDLY_UPDATE_ERROR = '下载或安装更新失败，请稍后重试';
export const DEV_FAKE_DONE_TOAST = '[dev] 模拟完成，已跳过 relaunch';

export const useUpdateStore = defineStore('update', () => {
  const status = ref<UpdateStatus>('idle');
  const update = ref<UpdateInfo | null>(null);
  const progress = ref<UpdateProgress>({ downloaded: 0, total: 0, pct: 0 });
  const error = ref<string | null>(null);
  const errorKind = ref<UpdateErrorKind | null>(null);
  /** 侧栏红点：有可用更新且用户未处理。dismiss 不动它。 */
  const badge = ref(false);
  /** UpdateModal 的可见性。组件直接绑这个字段。 */
  const modalOpen = ref(false);
  /**
   * DEV 模拟：为 true 时 startUpdate/retry 不调真实插件。
   * 生产构建不应通过 update-debug 挂载入口去设置它。
   */
  const debugSimulate = ref(false);

  /** 并发 check 去重：手动连点 / 启动+手动重叠时共用一个 promise。 */
  let checkInflight: Promise<void> | null = null;

  /** null → playFakeDownload 用 FAKE_DEFAULT_TOTAL；0 → indeterminate */
  let fakeTotalOverride: number | null = null;
  let fakeTimer: ReturnType<typeof setInterval> | null = null;
  let fakeDone: (() => void) | null = null;

  function resetProgress() {
    progress.value = { downloaded: 0, total: 0, pct: 0 };
  }

  function stopFakeDownload() {
    if (fakeTimer != null) {
      clearInterval(fakeTimer);
      fakeTimer = null;
    }
    if (fakeDone) {
      const done = fakeDone;
      fakeDone = null;
      done();
    }
  }

  function openModal() {
    // available / error / 下载安装中途都允许打开（后者用于用户从关于页再看进度）
    if (
      update.value ||
      status.value === 'error' ||
      status.value === 'downloading' ||
      status.value === 'installing'
    ) {
      modalOpen.value = true;
    }
  }

  function dismiss() {
    // 关闭弹窗：badge 保持（侧栏红点留着），update 数据保留以便再打开
    if (status.value === 'downloading' || status.value === 'installing') return;
    modalOpen.value = false;
  }

  /** 跳过当前可用版本：关窗、保留 badge；下次启动同版本不再自动弹窗。 */
  function skipThisVersion() {
    if (status.value === 'downloading' || status.value === 'installing') return;
    const ver = update.value?.version;
    if (!ver) return;
    persistSkippedVersion(ver);
    modalOpen.value = false;
    badge.value = true;
    status.value = 'available';
    clientLog('info', SCOPE, `skipped version v${ver}`);
  }

  function ensureDebugPackage(version?: string, body?: string) {
    update.value = {
      version: version ?? update.value?.version ?? DEFAULT_DEBUG_VERSION,
      date: update.value?.date ?? '',
      body: body ?? update.value?.body ?? DEFAULT_DEBUG_BODY,
    };
  }

  function debugAvailable(opts: DebugAvailableOpts = {}) {
    stopFakeDownload();
    debugSimulate.value = true;
    fakeTotalOverride = null;
    ensureDebugPackage(opts.version, opts.body);
    status.value = 'available';
    badge.value = true;
    error.value = null;
    errorKind.value = null;
    resetProgress();
    const ver = update.value!.version;
    // silent boot：尊重「跳过此版本」；非 silent / 手动模拟仍开窗
    if (opts.silent === true) {
      modalOpen.value = shouldAutoOpenOnSilent(ver, false);
    } else {
      modalOpen.value = true;
    }
  }

  function debugUptodate() {
    stopFakeDownload();
    debugSimulate.value = true;
    fakeTotalOverride = null;
    status.value = 'uptodate';
    badge.value = false;
    update.value = null;
    error.value = null;
    errorKind.value = null;
    modalOpen.value = false;
    resetProgress();
  }

  function debugError(kind: UpdateErrorKind) {
    stopFakeDownload();
    debugSimulate.value = true;
    status.value = 'error';
    errorKind.value = kind;
    error.value = kind === 'check' ? FRIENDLY_CHECK_ERROR : FRIENDLY_UPDATE_ERROR;
    modalOpen.value = true;
    if (kind === 'download') {
      ensureDebugPackage();
      badge.value = true;
    } else {
      // check error: no package required for UI, but clear update for retry path
      update.value = null;
      badge.value = false;
    }
  }

  function debugDownloading(opts: DebugDownloadingOpts = {}) {
    stopFakeDownload();
    debugSimulate.value = true;
    ensureDebugPackage();
    const total = opts.total ?? FAKE_DEFAULT_TOTAL;
    fakeTotalOverride = total;
    const downloaded = opts.downloaded ?? 0;
    status.value = 'downloading';
    badge.value = true;
    error.value = null;
    errorKind.value = null;
    modalOpen.value = true;
    progress.value = {
      downloaded,
      total,
      pct: total > 0 ? Math.min(100, (downloaded / total) * 100) : 0,
    };
  }

  function debugInstalling() {
    stopFakeDownload();
    debugSimulate.value = true;
    ensureDebugPackage();
    status.value = 'installing';
    badge.value = false;
    error.value = null;
    errorKind.value = null;
    modalOpen.value = true;
  }

  function debugProgress(downloaded: number, total: number) {
    debugSimulate.value = true;
    fakeTotalOverride = total;
    progress.value = {
      downloaded,
      total,
      pct: total > 0 ? Math.min(100, (downloaded / total) * 100) : 0,
    };
    if (status.value !== 'downloading') {
      status.value = 'downloading';
      ensureDebugPackage();
      modalOpen.value = true;
      badge.value = true;
      error.value = null;
      errorKind.value = null;
    }
  }

  function debugReset() {
    stopFakeDownload();
    debugSimulate.value = false;
    fakeTotalOverride = null;
    status.value = 'idle';
    update.value = null;
    badge.value = false;
    modalOpen.value = false;
    error.value = null;
    errorKind.value = null;
    resetProgress();
  }

  /** Fake download → installing; never relaunch. Restarts if already mid-download. */
  function playFakeDownload(): Promise<void> {
    if (status.value === 'installing' && fakeTimer == null) {
      return Promise.resolve();
    }
    stopFakeDownload();
    debugSimulate.value = true;
    ensureDebugPackage();
    status.value = 'downloading';
    modalOpen.value = true;
    error.value = null;
    errorKind.value = null;

    const total = fakeTotalOverride ?? FAKE_DEFAULT_TOTAL;
    progress.value = { downloaded: 0, total, pct: 0 };

    const ticks = Math.max(1, Math.floor(FAKE_DOWNLOAD_MS / FAKE_TICK_MS));
    let tick = 0;

    return new Promise((resolve) => {
      fakeDone = resolve;
      fakeTimer = setInterval(() => {
        tick += 1;
        if (total > 0) {
          const downloaded = Math.min(total, Math.round((total * tick) / ticks));
          progress.value = {
            downloaded,
            total,
            pct: Math.min(100, (downloaded / total) * 100),
          };
        } else {
          progress.value = {
            downloaded: tick * 250_000,
            total: 0,
            pct: 0,
          };
        }
          if (tick >= ticks) {
          if (fakeTimer != null) {
            clearInterval(fakeTimer);
            fakeTimer = null;
          }
          fakeDone = null;
          status.value = 'installing';
          badge.value = false;
          clearSkippedVersion();
          useUiStore().showToast(DEV_FAKE_DONE_TOAST, 'ok');
          resolve();
        }
      }, FAKE_TICK_MS);
    });
  }

  async function checkForUpdate(silent: boolean): Promise<void> {
    if (!hasTauri()) {
      clientLog('warn', SCOPE, 'checkForUpdate skipped: no Tauri runtime');
      return;
    }
    // 正在下载/安装时不再二次触发检查
    if (status.value === 'downloading' || status.value === 'installing') return;

    // 已有进行中的检查：等待同一 promise，避免并发 check()
    if (checkInflight) {
      await checkInflight;
      // 若静默等待期间已有可用更新，手动调用方仍应打开弹窗
      if (!silent && status.value === 'available') {
        modalOpen.value = true;
      }
      return;
    }

    const prevStatus = status.value;
    if (!silent) {
      status.value = 'checking';
      error.value = null;
      errorKind.value = null;
    }

    checkInflight = (async () => {
      try {
        const result = await check();
        if (!result) {
          status.value = 'uptodate';
          badge.value = false;
          update.value = null;
          error.value = null;
          errorKind.value = null;
          clearSkippedVersion();
          if (!silent) {
            useUiStore().showToast('已是最新版本', 'ok');
          }
          return;
        }
        const alreadyKnown =
          badge.value && update.value?.version === result.version;
        update.value = {
          version: result.version,
          date: result.date ?? '',
          body: result.body ?? '',
        };
        status.value = 'available';
        badge.value = true;
        error.value = null;
        errorKind.value = null;
        // 手动检查始终开窗；静默：未跳过且本会话未提示过才自动开。
        if (!silent) {
          modalOpen.value = true;
        } else {
          modalOpen.value = shouldAutoOpenOnSilent(result.version, alreadyKnown);
        }
      } catch (e) {
        const raw = e instanceof Error ? e.message : String(e);
        clientLog('error', SCOPE, `checkForUpdate failed: ${raw}`);
        if (silent) {
          // 启动静默：恢复原 status，仅记日志，不打扰用户
          status.value = prevStatus;
          return;
        }
        status.value = 'error';
        error.value = FRIENDLY_CHECK_ERROR;
        errorKind.value = 'check';
        modalOpen.value = true;
        useUiStore().showToast('检查更新失败', 'error');
      }
    })();

    try {
      await checkInflight;
    } finally {
      checkInflight = null;
    }
  }

  async function startUpdate(): Promise<void> {
    if (debugSimulate.value) {
      if (status.value === 'error' && errorKind.value === 'check') {
        debugAvailable({ silent: false });
        return;
      }
      if (status.value === 'installing') return;
      await playFakeDownload();
      return;
    }
    if (!hasTauri()) {
      clientLog('warn', SCOPE, 'startUpdate skipped: no Tauri runtime');
      return;
    }
    if (status.value === 'downloading' || status.value === 'installing') return;
    // 检查失败没有可安装包，应先走 check
    if (status.value === 'error' && errorKind.value === 'check') {
      await checkForUpdate(false);
      return;
    }

    status.value = 'downloading';
    modalOpen.value = true;
    resetProgress();
    error.value = null;
    errorKind.value = null;
    try {
      // 重新 check 拿新鲜 Update 句柄（check() 对象只在一次
      // downloadAndInstall 调用里有效；用户在弹窗停留较久时可能过期）
      const fresh = await check();
      if (!fresh) {
        status.value = 'uptodate';
        badge.value = false;
        update.value = null;
        clearSkippedVersion();
        useUiStore().showToast('已是最新版本', 'ok');
        return;
      }
      // 同步最新 notes / version（二次 check 可能刷新说明）
      update.value = {
        version: fresh.version,
        date: fresh.date ?? '',
        body: fresh.body ?? update.value?.body ?? '',
      };
      await fresh.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started': {
            const total = event.data?.contentLength ?? 0;
            progress.value = {
              downloaded: 0,
              total,
              pct: 0,
            };
            break;
          }
          case 'Progress': {
            const chunk = event.data?.chunkLength ?? 0;
            const downloaded = progress.value.downloaded + chunk;
            const total = progress.value.total;
            progress.value = {
              downloaded,
              total,
              pct: total > 0 ? Math.min(100, (downloaded / total) * 100) : 0,
            };
            break;
          }
          case 'Finished': {
            status.value = 'installing';
            break;
          }
        }
      });
      // downloadAndInstall resolve：安装器已就位（NSIS passive 接管）
      status.value = 'installing';
      badge.value = false;
      clearSkippedVersion();
      // relaunch() 成功则应用直接重启；失败则进 error 态由用户重试
      await relaunch();
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      clientLog('error', SCOPE, `startUpdate failed: ${raw}`);
      status.value = 'error';
      error.value = FRIENDLY_UPDATE_ERROR;
      errorKind.value = 'download';
      useUiStore().showToast('更新失败', 'error');
    }
  }

  /** error 态统一入口：按 errorKind 分流检查 vs 下载。 */
  async function retry(): Promise<void> {
    if (debugSimulate.value) {
      if (errorKind.value === 'check' || !update.value) {
        debugAvailable({ silent: false });
        return;
      }
      await playFakeDownload();
      return;
    }
    if (errorKind.value === 'check' || !update.value) {
      await checkForUpdate(false);
      return;
    }
    await startUpdate();
  }

  return {
    status,
    update,
    progress,
    error,
    errorKind,
    badge,
    modalOpen,
    debugSimulate,
    openModal,
    dismiss,
    skipThisVersion,
    checkForUpdate,
    startUpdate,
    retry,
    debugAvailable,
    debugUptodate,
    debugError,
    debugDownloading,
    debugInstalling,
    debugProgress,
    debugReset,
    playFakeDownload,
  };
});
