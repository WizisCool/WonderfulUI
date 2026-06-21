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
