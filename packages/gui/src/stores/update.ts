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
// 静默成功有更新：亮红点 + 轻 toast，不自动开弹窗。
// 手动检查（silent=false）失败 → status=error + toast；成功有更新直接开弹窗。
//
// happy-dom 单测 / 浏览器调试：顶层 import plugin-updater / plugin-process
// 不会 throw；actions 进入后用 hasTauri() 守门直接 return。

import { defineStore } from 'pinia';
import { ref } from 'vue';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { useUiStore } from './ui.ts';
import { clientLog } from '../utils/client-log.ts';

const SCOPE = 'update-store';

function hasTauri(): boolean {
  return typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;
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

export const FRIENDLY_CHECK_ERROR = '无法连接到更新服务器';
export const FRIENDLY_UPDATE_ERROR = '下载或安装更新失败，请稍后重试';

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

  /** 并发 check 去重：手动连点 / 启动+手动重叠时共用一个 promise。 */
  let checkInflight: Promise<void> | null = null;

  function resetProgress() {
    progress.value = { downloaded: 0, total: 0, pct: 0 };
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
        // 静默：只亮红点 + 首次发现时轻 toast；手动：直接开弹窗
        if (!silent) {
          modalOpen.value = true;
        } else if (!alreadyKnown) {
          useUiStore().showToast(`发现新版本 v${result.version}`, 'ok');
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
    openModal,
    dismiss,
    checkForUpdate,
    startUpdate,
    retry,
  };
});
