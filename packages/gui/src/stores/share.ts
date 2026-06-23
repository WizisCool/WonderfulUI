// "快传" 跨设备分享 Pinia store。
//
// 状态机：
//   idle       → 没启动过 / 启动前
//   starting   → invoke 启动中（极短）
//   running    → server 跑着，info 有 URL + QR
//   error      → 上次启动失败
//
// 关闭走 stop()；server 端 3 分钟空闲会自动停（Rust 端发
// `wui://share_server_stopped` 事件），前端收到后 reset 回 idle。

import { defineStore } from 'pinia';
import { ref } from 'vue';
import { invoke } from '../tauri-adapter.ts';

export interface ShareServerInfo {
  port: number;
  token: string;
  url: string;
  lanIp: string;
  qrSvg: string;
  videoName: string;
  videoSize: number;
  /** Rust 端 server 启动时的 Unix epoch 秒。倒计时起点。 */
  startedAtUnix: number;
}

export interface ShareDownloadedEvent {
  count: number;
  filename: string;
  sizeBytes: number;
}

export type ShareStatus = 'idle' | 'starting' | 'running' | 'error';

export const useShareStore = defineStore('share', () => {
  const status = ref<ShareStatus>('idle');
  const info = ref<ShareServerInfo | null>(null);
  const downloadCount = ref(0);
  const lastBytes = ref(0);
  const lastError = ref('');

  async function start(videoPath: string) {
    status.value = 'starting';
    lastError.value = '';
    try {
      const result = await invoke<ShareServerInfo>('start_share_server', {
        path: videoPath,
      });
      info.value = result;
      downloadCount.value = 0;
      status.value = 'running';
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : String(e);
      info.value = null;
      status.value = 'error';
    }
  }

  async function stop() {
    try {
      await invoke('stop_share_server');
    } catch {
      // 关闭失败不影响 UI 状态重置
    }
    info.value = null;
    status.value = 'idle';
    downloadCount.value = 0;
    lastBytes.value = 0;
  }

  /** 收到 `wui://share_downloaded` 事件时调用。 */
  function onDownloaded(payload: ShareDownloadedEvent) {
    downloadCount.value = payload.count;
    lastBytes.value = payload.sizeBytes;
  }

  /** 收到 `wui://share_server_stopped` 事件时调用。 */
  function onStopped(reason: 'stopped' | 'error' | 'idle_timeout', message?: string) {
    if (reason === 'error' && message) {
      lastError.value = message;
      status.value = 'error';
    } else {
      status.value = 'idle';
    }
    info.value = null;
    downloadCount.value = 0;
  }

  return { status, info, downloadCount, lastBytes, lastError, start, stop, onDownloaded, onStopped };
});
