// 应用内自更新 Pinia store（第 7 个）。
//
// 封装 tauri-plugin-updater（check / downloadAndInstall）+ tauri-plugin-process
// （relaunch），组件不直接 invoke。
//
// 状态机：
//   idle        → 初始 / 重置后
//   uptodate    → 检查过，无更新
//   available   → 发现新版本（modalOpen 由 caller 决定）
//   downloading → 正在下载，progress 在变
//   installing  → 下载完，安装器接管
//   error       → 失败，error 字段承载友好文案
//
// 启动静默检查（silent=true）失败时只 clientLog，不动 status、不弹 toast；
// 手动检查（silent=false）失败 → status=error + 友好 toast。
//
// happy-dom 单测 / 浏览器调试：顶层 import plugin-updater / plugin-process
// 不会 throw（这两个包只导出函数引用，本身不挂 Tauri runtime），actions
// 进入后用 hasTauri() 守门直接 return，clientLog 记一行 warn。

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
  | 'available'
  | 'downloading'
  | 'installing'
  | 'error'
  | 'uptodate';

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

const FRIENDLY_CHECK_ERROR = '无法连接到更新服务器';
const FRIENDLY_UPDATE_ERROR = '下载或安装更新失败，请稍后重试';

export const useUpdateStore = defineStore('update', () => {
  const status = ref<UpdateStatus>('idle');
  const update = ref<UpdateInfo | null>(null);
  const progress = ref<UpdateProgress>({ downloaded: 0, total: 0, pct: 0 });
  const error = ref<string | null>(null);
  /** 侧栏红点：有可用更新且用户未处理。dismiss 不动它。 */
  const badge = ref(false);
  /** UpdateModal 的可见性。组件直接绑这个字段。 */
  const modalOpen = ref(false);

  function resetProgress() {
    progress.value = { downloaded: 0, total: 0, pct: 0 };
  }

  function openModal() {
    if (update.value) modalOpen.value = true;
  }

  function dismiss() {
    // 关闭弹窗：badge 保持（侧栏红点留着），update 数据保留以便再打开
    modalOpen.value = false;
  }

  async function checkForUpdate(silent: boolean): Promise<void> {
    if (!hasTauri()) {
      clientLog('warn', SCOPE, 'checkForUpdate skipped: no Tauri runtime');
      return;
    }
    // 正在下载/安装时不再二次触发检查
    if (status.value === 'downloading' || status.value === 'installing') return;
    error.value = null;
    try {
      const result = await check();
      if (!result) {
        status.value = 'uptodate';
        badge.value = false;
        if (!silent) {
          useUiStore().showToast('已是最新版本', 'ok');
        }
        return;
      }
      update.value = {
        version: result.version,
        date: result.date ?? '',
        body: result.body ?? '',
      };
      status.value = 'available';
      badge.value = true;
      error.value = null;
      // 静默检查只亮红点；手动检查直接开弹窗
      if (!silent) modalOpen.value = true;
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      clientLog('error', SCOPE, `checkForUpdate failed: ${raw}`);
      if (silent) {
        // 启动静默：保持 idle，仅记日志，不打扰用户
        return;
      }
      status.value = 'error';
      error.value = FRIENDLY_CHECK_ERROR;
      useUiStore().showToast('检查更新失败', 'error');
    }
  }

  async function startUpdate(): Promise<void> {
    if (!hasTauri()) {
      clientLog('warn', SCOPE, 'startUpdate skipped: no Tauri runtime');
      return;
    }
    if (status.value === 'downloading' || status.value === 'installing') return;
    status.value = 'downloading';
    resetProgress();
    error.value = null;
    try {
      // 重新 check 拿一个新鲜的 Update 句柄（check() 拿到的对象只在
      // 一次 downloadAndInstall 调用里有效；用户在弹窗停留较久时
      // 句柄可能已过期）
      const fresh = await check();
      if (!fresh) {
        // 竞态：检查期间已被更新或不再可用
        status.value = 'uptodate';
        badge.value = false;
        useUiStore().showToast('已是最新版本', 'ok');
        return;
      }
      await fresh.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started': {
            const total = event.data?.contentLength ?? 0;
            progress.value = { downloaded: progress.value.downloaded, total, pct: 0 };
            break;
          }
          case 'Progress': {
            const chunk = event.data?.chunkLength ?? 0;
            const downloaded = progress.value.downloaded + chunk;
            const total = progress.value.total;
            progress.value = {
              downloaded,
              total,
              pct: total > 0 ? (downloaded / total) * 100 : 0,
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
      useUiStore().showToast('更新失败', 'error');
    }
  }

  return {
    status, update, progress, error, badge, modalOpen,
    openModal, dismiss, checkForUpdate, startUpdate,
  };
});
