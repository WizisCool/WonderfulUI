import { defineStore } from 'pinia';
import { ref } from 'vue';
import { invoke } from '../tauri-adapter.ts';
import type { LibraryStats } from '../utils/library-stats.ts';

export type SettingsTab = 'library' | 'logs' | 'about';

export interface LogStatus {
  logDir: string; logPath: string; size: number;
  modifiedMs: number; maxBytes: number; latestText: string;
}

const ANIMATION_MS = 150;

function rejectionMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error === null || error === undefined) return '未知错误';
  const message = String(error).trim();
  return message || '未知错误';
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

  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  let logsInflight: Promise<void> | null = null;
  let statsInflight: Promise<void> | null = null;

  function setOpen(open: boolean) {
    if (open) {
      if (closeTimer !== null) { clearTimeout(closeTimer); closeTimer = null; }
      isOpen.value = true;
      isClosing.value = false;
    } else if (isOpen.value && !isClosing.value) {
      isClosing.value = true;
      closeTimer = setTimeout(() => {
        isOpen.value = false;
        isClosing.value = false;
        closeTimer = null;
      }, ANIMATION_MS);
    }
  }

  function setTab(tab: SettingsTab) { activeTab.value = tab; }
  function setChartMetric(m: 'video' | 'match') { chartMetric.value = m; }

  function fetchLogs(): Promise<void> {
    if (logsInflight) return logsInflight;

    logLoading.value = true;
    logError.value = null;
    const operation = (async () => {
      try {
        logStatus.value = await invoke<LogStatus>('get_log_status');
      } catch (e) {
        logError.value = `日志读取失败: ${rejectionMessage(e)}`;
      }
    })();
    const request = operation.finally(() => {
      if (logsInflight === request) {
        logsInflight = null;
        logLoading.value = false;
      }
    });
    logsInflight = request;
    return request;
  }

  function fetchLibraryStats(): Promise<void> {
    if (statsInflight) return statsInflight;

    const prev = statsData.value;
    statsLoading.value = true;
    statsError.value = null;
    const operation = (async () => {
      try {
        statsData.value = await invoke<LibraryStats>('get_library_stats');
      } catch (e) {
        statsData.value = prev;
        statsError.value = `资料库统计失败: ${rejectionMessage(e)}`;
      }
    })();
    const request = operation.finally(() => {
      if (statsInflight === request) {
        statsInflight = null;
        statsLoading.value = false;
      }
    });
    statsInflight = request;
    return request;
  }

  /** Data changed while a read may be in flight: wait for it, then read again. */
  async function refreshLibraryStats(): Promise<void> {
    const current = statsInflight;
    if (current) await current;
    await fetchLibraryStats();
  }

  return {
    isOpen, isClosing, activeTab, logLoading, logStatus, logError,
    statsLoading, statsData, statsError, chartMetric,
    setOpen, setTab, setChartMetric, fetchLogs, fetchLibraryStats, refreshLibraryStats,
  };
});
