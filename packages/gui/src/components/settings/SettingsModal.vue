<template>
  <header class="settings-modal-head">
    <div class="settings-title-group">
      <h2 class="settings-title" id="settings-title">设置</h2>
    </div>
    <button
      class="iconbtn settings-close"
      type="button"
      aria-label="关闭设置"
      @click="settings.setOpen(false)"
    >
      <X :size="16" />
    </button>
  </header>
  <div class="settings-modal-body">
    <nav class="settings-nav" aria-label="设置分区">
      <button
        class="settings-nav-item"
        :class="{ 'is-active': settings.activeTab === 'library' }"
        type="button"
        aria-current="page"
        @click="settings.setTab('library')"
      >
        <Database :size="16" />
        <span>资料库</span>
      </button>
      <button
        class="settings-nav-item"
        :class="{ 'is-active': settings.activeTab === 'logs' }"
        type="button"
        aria-current="false"
        @click="settings.setTab('logs')"
      >
        <Bug :size="16" />
        <span>日志</span>
      </button>
    </nav>
    <main
      class="settings-content"
      :class="settings.activeTab === 'logs' ? 'settings-content--logs' : 'settings-content--library'"
    >
      <!-- Library tab -->
      <template v-if="settings.activeTab === 'library'">
        <!-- Video Overview -->
        <section class="settings-section">
          <div class="settings-section-head">
            <h3>资料库概览</h3>
            <template v-if="statsError && !settings.statsData">
              <span class="settings-section-sub" />
            </template>
            <template v-else-if="settings.statsLoading && !settings.statsData">
              <span class="settings-section-sub" />
            </template>
            <template v-else>
              <span class="settings-section-sub">{{ fmtAccountLabel() }}</span>
            </template>
          </div>
          <template v-if="statsError && !settings.statsData">
            <div class="settings-row">
              <span class="settings-row-sub is-error">{{ statsError }}</span>
            </div>
            <div class="settings-row">
              <button class="btn settings-action" type="button" @click="settings.fetchLibraryStats()">重试</button>
            </div>
          </template>
          <template v-else-if="settings.statsLoading && !settings.statsData">
            <div class="settings-row">
              <span class="settings-row-sub">正在加载...</span>
            </div>
          </template>
          <template v-else-if="!settings.statsData">
            <div class="settings-row">
              <span class="settings-row-sub">暂无视频数据</span>
            </div>
          </template>
          <template v-else>
            <div class="stats-video-body">
              <div class="stats-video-summary">
                <button
                  class="stats-video-metric stats-video-metric--toggle"
                  :class="{ 'is-active': settings.chartMetric === 'video' }"
                  type="button"
                  :aria-pressed="String(settings.chartMetric === 'video')"
                  :aria-label="'按视频查看占比'"
                  @click="settings.setChartMetric('video')"
                >
                  <span class="stats-video-value">{{ statsData.totalVideos }}</span>
                  <span class="stats-video-label">视频</span>
                </button>
                <button
                  class="stats-video-metric stats-video-metric--toggle"
                  :class="{ 'is-active': settings.chartMetric === 'match' }"
                  type="button"
                  :aria-pressed="String(settings.chartMetric === 'match')"
                  :aria-label="'按对局查看占比'"
                  @click="settings.setChartMetric('match')"
                >
                  <span class="stats-video-value">{{ statsTotalMatches }}</span>
                  <span class="stats-video-label">对局</span>
                </button>
                <div class="stats-video-metric">
                  <span class="stats-video-value">{{ statsData.totalAccounts }}</span>
                  <span class="stats-video-label">账户</span>
                </div>
              </div>
              <div
                class="stats-video-chart"
                id="stats-account-video-chart"
                ref="chartRef"
                role="img"
                :aria-label="chartAriaLabel"
              />
            </div>
            <div v-if="chartNotices.length > 0" class="stats-video-notice">
              <span v-for="(notice, i) in chartNotices" :key="i" class="stats-video-warn">
                <X :size="12" /> {{ notice }}
              </span>
            </div>
          </template>
        </section>

        <!-- Scan Settings -->
        <section class="settings-section">
          <div class="settings-section-head">
            <h3>扫描设置</h3>
            <span class="settings-section-sub">扫描与重建</span>
          </div>
          <div class="settings-row">
            <div class="settings-row-main">
              <div class="settings-row-title">刷新模式</div>
              <div class="settings-row-sub settings-sub-line">
                决定右上角 <RefreshCw :size="12" /> 刷新按钮的工作方式
              </div>
            </div>
            <div class="settings-segment" role="radiogroup" aria-label="扫描模式">
              <button
                class="settings-segment-btn"
                :class="{ 'is-active': filter.refreshScanMode === 'incremental' }"
                type="button"
                role="radio"
                :aria-checked="String(filter.refreshScanMode === 'incremental')"
                @click="filter.setScanMode('incremental')"
              >增量扫描</button>
              <button
                class="settings-segment-btn"
                :class="{ 'is-active': filter.refreshScanMode === 'full' }"
                type="button"
                role="radio"
                :aria-checked="String(filter.refreshScanMode === 'full')"
                @click="filter.setScanMode('full')"
              >全量扫描</button>
            </div>
          </div>
          <div class="settings-row">
            <div class="settings-row-main">
              <div class="settings-row-title">全量扫描</div>
              <div class="settings-row-sub">全部重新解析，适合重建本地库</div>
            </div>
            <button
              class="btn settings-action"
              type="button"
              :disabled="account.scraping"
              @click="onFullScan"
            >
              <Database :size="15" />
              <span>{{ account.scraping ? '扫描中' : '全量扫描' }}</span>
            </button>
          </div>
        </section>
      </template>

      <!-- Logs tab -->
      <template v-else>
        <section class="settings-log-panel">
          <header class="settings-log-toolbar">
            <div class="settings-log-identity">
              <div class="settings-log-icon">
                <FileText :size="16" />
              </div>
              <div class="settings-log-copy">
                <div class="settings-log-name">{{ logFileName }}</div>
                <div class="settings-log-statusline">
                  <span>{{ logSizeText }}</span>
                  <span>更新 {{ logModifiedText }}</span>
                </div>
              </div>
            </div>
            <div class="settings-action-group settings-log-actions">
              <button
                class="btn settings-action"
                :class="{ 'is-loading': settings.logLoading }"
                type="button"
                :aria-busy="String(settings.logLoading)"
                @click="settings.fetchLogs()"
              >
                <RefreshCw :size="15" />
                <span>{{ settings.logLoading ? '刷新中' : '刷新' }}</span>
              </button>
              <button
                class="btn settings-action"
                type="button"
                @click="revealLogsDir"
              >
                <FolderOpen :size="15" />
                <span>打开目录</span>
              </button>
            </div>
          </header>
          <section class="settings-log-viewer">
            <div class="settings-log-viewer-head">
              <h3>最近内容</h3>
            </div>
            <pre
              class="settings-log-preview"
              :class="{ 'is-error': settings.logError }"
            >{{ logPreviewText }}</pre>
          </section>
        </section>
      </template>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import {
  X, Database, Bug, RefreshCw, FolderOpen, FileText,
} from 'lucide-vue-next';
import { useAccountStore } from '../../stores/account.ts';
import { useFilterStore } from '../../stores/filter.ts';
import { useSettingsStore } from '../../stores/settings.ts';
import { invoke } from '../../tauri-adapter.ts';
import { fmtBytes, CHART_METRIC_LABELS, mountAccountVideoChart, disposeAccountVideoChart } from '../../utils/library-stats.ts';
import type { LibraryStats } from '../../utils/library-stats.ts';

const account = useAccountStore();
const filter = useFilterStore();
const settings = useSettingsStore();

const chartRef = ref<HTMLElement | null>(null);

const statsData = computed<LibraryStats | null>(() => settings.statsData);
const statsError = computed(() => settings.statsError);

const statsTotalMatches = computed(() =>
  (statsData.value?.accounts ?? []).reduce((sum, a) => sum + a.matchCount, 0)
);

const chartAriaLabel = computed(() =>
  `按账号展示${CHART_METRIC_LABELS[settings.chartMetric]}数量占比的饼图`
);

const chartNotices = computed(() => {
  const notices: string[] = [];
  if (settings.statsError) notices.push('刷新失败，正在显示上次统计');
  if (statsData.value && statsData.value.missingVideos > 0) notices.push(`缺失 ${statsData.value.missingVideos} 个视频`);
  return notices;
});

function fmtAccountLabel(): string {
  if (!statsData.value) return '';
  return settings.statsLoading ? '刷新中' : `${statsData.value.accounts.length} 个账户`;
}

function fmtLogTime(ms: number): string {
  if (!ms) return '未知';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function fmtLogPreview(text: string): string {
  return text.replace(/^(\d{10})\.(\d{1,3})(?= \[)/gm, (_, seconds: string, ms: string) => {
    const d = new Date(Number(seconds) * 1000 + Number(ms.padEnd(3, '0')));
    const pad = (n: number, len = 2) => String(n).padStart(len, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
  });
}

function fileName(path: string | undefined, fallback: string): string {
  if (!path) return fallback;
  return path.split(/[\\/]/).filter(Boolean).pop() ?? fallback;
}

const logFileName = computed(() => fileName(settings.logStatus?.logPath, 'wonderful-ui.log'));
const logSizeText = computed(() =>
  settings.logStatus ? `${fmtBytes(settings.logStatus.size)} / ${fmtBytes(settings.logStatus.maxBytes)}` : '尚未生成'
);
const logModifiedText = computed(() =>
  settings.logStatus?.modifiedMs ? fmtLogTime(settings.logStatus.modifiedMs) : '暂无'
);
const logPreviewText = computed(() => {
  const raw = settings.logLoading && settings.logStatus
    ? settings.logStatus.latestText
    : (settings.logLoading ? '正在读取日志...' : (settings.logError ?? settings.logStatus?.latestText ?? '暂无日志内容'));
  return fmtLogPreview(raw);
});

async function onFullScan() {
  await account.scrapeLibrary('full');
  settings.fetchLibraryStats();
}

async function revealLogsDir() {
  try {
    await invoke('reveal_path', { path: settings.logStatus?.logDir ?? '' });
  } catch { /* ignore */ }
}

watch(() => settings.isOpen, (open) => {
  if (open && settings.activeTab === 'library') {
    if (!settings.statsData && !settings.statsLoading && !settings.statsError) {
      settings.fetchLibraryStats();
    }
  }
  if (open && settings.activeTab === 'logs') {
    settings.fetchLogs();
  }
});

watch(() => settings.activeTab, (tab) => {
  if (tab === 'logs') {
    settings.fetchLogs();
  }
});

watch([statsData, () => settings.chartMetric], () => {
  if (chartRef.value && statsData.value) {
    mountAccountVideoChart(chartRef.value, statsData.value, settings.chartMetric);
  }
});

onMounted(() => {
  if (chartRef.value && statsData.value) {
    mountAccountVideoChart(chartRef.value, statsData.value, settings.chartMetric);
  }
});

onUnmounted(() => {
  disposeAccountVideoChart();
});
</script>
