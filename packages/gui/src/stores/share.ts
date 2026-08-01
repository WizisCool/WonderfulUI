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
import {
  canBeginShareStart,
  createShareSessionId,
  shouldCommitShareStart,
  shouldHandleShareEvent,
} from '../utils/share-start.ts';
import { clientLog } from '../utils/client-log.ts';
import {
  friendlyShareError,
} from '../utils/share-errors.ts';

export { FRIENDLY_SHARE_START_ERROR, FRIENDLY_SHARE_STOP_ERROR } from '../utils/share-errors.ts';

export interface ShareServerInfo {
  sessionId: string;
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
  sessionId: string;
  count: number;
  filename: string;
  sizeBytes: number;
}

export type ShareStatus = 'idle' | 'starting' | 'running' | 'error';

export interface ShareStoppedEvent {
  sessionId: string;
  reason: 'stopped' | 'error' | 'idle_timeout';
  message?: string;
}

export const useShareStore = defineStore('share', () => {
  const status = ref<ShareStatus>('idle');
  const info = ref<ShareServerInfo | null>(null);
  const downloadCount = ref(0);
  const lastBytes = ref(0);
  const lastError = ref('');
  const activeSessionId = ref<string | null>(null);

  async function stopBackendSession(sessionId: string): Promise<void> {
    try {
      await invoke('stop_share_server', { sessionId });
    } catch {
      // The UI must still close. If start is in flight, its stale-result path
      // retries this session-scoped stop after the backend returns its token.
    }
  }

  function resetVisibleState(): void {
    info.value = null;
    status.value = 'idle';
    downloadCount.value = 0;
    lastBytes.value = 0;
  }

  async function start(videoPath: string) {
    // Ignore double-clicks while the first invoke is in flight. Starting from
    // a running session first stops that exact old session, then begins a new
    // identity so late events cannot overwrite the replacement.
    if (!canBeginShareStart(status.value)) return;
    const previousSessionId = activeSessionId.value;
    const requestSessionId = createShareSessionId();
    activeSessionId.value = requestSessionId;
    status.value = 'starting';
    info.value = null;
    downloadCount.value = 0;
    lastBytes.value = 0;
    lastError.value = '';
    if (previousSessionId !== null) {
      await stopBackendSession(previousSessionId);
      if (!shouldCommitShareStart(
        status.value,
        activeSessionId.value,
        requestSessionId,
      )) return;
    }
    try {
      const result = await invoke<ShareServerInfo>('start_share_server', {
        path: videoPath,
        sessionId: requestSessionId,
      });
      // stop() or a replacement start may have run during await. Do not
      // resurrect its UI, and stop only the stale backend session that this
      // result created (never whatever server is current now).
      if (!shouldCommitShareStart(
        status.value,
        activeSessionId.value,
        requestSessionId,
      )) {
        await stopBackendSession(result.sessionId);
        return;
      }
      info.value = result;
      downloadCount.value = 0;
      status.value = 'running';
    } catch (e) {
      if (!shouldCommitShareStart(
        status.value,
        activeSessionId.value,
        requestSessionId,
      )) return;
      const message = e instanceof Error ? e.message : String(e);
      clientLog('error', 'share-store', `start failed: ${message}`);
      lastError.value = friendlyShareError(e, 'start');
      info.value = null;
      status.value = 'error';
    }
  }

  async function stop() {
    const sessionId = activeSessionId.value;
    // Invalidate synchronously before awaiting IPC. An in-flight start sees
    // the mismatch and cleans up its own backend session after it returns.
    activeSessionId.value = null;
    resetVisibleState();
    if (sessionId !== null) await stopBackendSession(sessionId);
  }

  /** 收到 `wui://share_downloaded` 事件时调用。 */
  function onDownloaded(payload: ShareDownloadedEvent): boolean {
    if (!shouldHandleShareEvent(activeSessionId.value, payload.sessionId)) return false;
    downloadCount.value = payload.count;
    lastBytes.value = payload.sizeBytes;
    return true;
  }

  /** 收到 `wui://share_server_stopped` 事件时调用。 */
  function onStopped(payload: ShareStoppedEvent): boolean {
    if (!shouldHandleShareEvent(activeSessionId.value, payload.sessionId)) return false;
    activeSessionId.value = null;
    if (payload.reason === 'error') {
      if (payload.message) {
        clientLog('error', 'share-store', `server stopped: ${payload.message}`);
      }
      lastError.value = friendlyShareError(payload.message, 'stop');
      status.value = 'error';
    } else {
      status.value = 'idle';
    }
    info.value = null;
    downloadCount.value = 0;
    lastBytes.value = 0;
    return true;
  }

  return {
    status, info, downloadCount, lastBytes, lastError, activeSessionId,
    start, stop, onDownloaded, onStopped,
  };
});
