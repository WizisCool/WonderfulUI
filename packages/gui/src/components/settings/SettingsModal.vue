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
      <WIcon icon="ph:x" :size="16" />
    </button>
  </header>
  <div class="settings-modal-body">
    <nav class="settings-nav" aria-label="设置分区">
       <button
        class="settings-nav-item"
        :class="{ 'is-active': settings.activeTab === 'library' }"
        type="button"
        :aria-current="settings.activeTab === 'library' ? 'page' : undefined"
        @click="settings.setTab('library')"
      >
        <WIcon icon="ph:database" :size="16" />
        <span>资料库</span>
      </button>
      <button
        class="settings-nav-item"
        :class="{ 'is-active': settings.activeTab === 'logs' }"
        type="button"
        :aria-current="settings.activeTab === 'logs' ? 'page' : undefined"
        @click="settings.setTab('logs')"
      >
        <WIcon icon="ph:bug" :size="16" />
        <span>日志</span>
      </button>
      <button
        class="settings-nav-item"
        :class="{ 'is-active': settings.activeTab === 'about' }"
        type="button"
        :aria-current="settings.activeTab === 'about' ? 'page' : undefined"
        @click="settings.setTab('about')"
      >
        <WIcon icon="ph:info" :size="16" />
        <span>关于</span>
      </button>
    </nav>
    <main
      class="settings-content"
      :class="{
        'settings-content--logs': settings.activeTab === 'logs',
        'settings-content--library': settings.activeTab !== 'logs',
      }"
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
                  v-motion
                  :initial="{ opacity: 0, y: 12 }"
                  :enter="{ opacity: 1, y: 0, transition: { delay: 0 } }"
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
                  v-motion
                  :initial="{ opacity: 0, y: 12 }"
                  :enter="{ opacity: 1, y: 0, transition: { delay: 60 } }"
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
                <div
                  v-motion
                  :initial="{ opacity: 0, y: 12 }"
                  :enter="{ opacity: 1, y: 0, transition: { delay: 120 } }"
                  class="stats-video-metric"
                >
                  <span class="stats-video-value">{{ statsData.totalAccounts }}</span>
                  <span class="stats-video-label">账户</span>
                </div>
              </div>
              <div
                v-motion
                :initial="{ opacity: 0, scale: 0.96 }"
                :enter="{ opacity: 1, scale: 1, transition: { delay: 180, duration: 300 } }"
                class="stats-video-chart"
                id="stats-account-video-chart"
                ref="chartRef"
                role="img"
                :aria-label="chartAriaLabel"
              >
                <div class="stats-video-chart-center" aria-hidden="true">
                  <template v-if="chartOverlay.total > 0">
                    <span class="stats-video-chart-center-number">{{ chartOverlay.total }}</span>
                    <span class="stats-video-chart-center-label">{{ chartOverlay.label }}</span>
                  </template>
                  <template v-else>
                    <span class="stats-video-chart-center-empty">{{ chartOverlay.emptyLabel }}</span>
                  </template>
                </div>
              </div>
            </div>
            <div v-if="chartNotices.length > 0" class="stats-video-notice">
              <span v-for="(notice, i) in chartNotices" :key="i" class="stats-video-warn">
                <WIcon icon="ph:x" :size="12" /> {{ notice }}
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
                决定对局列表头部 <WIcon icon="ph:arrows-clockwise" :size="12" /> 刷新按钮的工作方式
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
              <WIcon icon="ph:database" :size="15" />
              <span>{{ account.scraping ? '扫描中' : '全量扫描' }}</span>
            </button>
          </div>
        </section>
      </template>

      <!-- Logs tab -->
      <template v-else-if="settings.activeTab === 'logs'">
        <section class="settings-log-panel">
          <header class="settings-log-toolbar">
            <div class="settings-log-identity">
              <div class="settings-log-icon">
                <WIcon icon="ph:file-text" :size="16" />
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
                <WIcon icon="ph:arrows-clockwise" :size="15" />
                <span>{{ settings.logLoading ? '刷新中' : '刷新' }}</span>
              </button>
              <button
                class="btn settings-action"
                type="button"
                @click="revealLogsDir"
              >
                <WIcon icon="ph:folder-open" :size="15" />
                <span>打开目录</span>
              </button>
            </div>
          </header>
          <section class="settings-log-viewer">
            <div class="settings-log-viewer-head">
              <h3>最近内容</h3>
            </div>
            <pre
              ref="logPreviewRef"
              class="settings-log-preview"
              :class="{ 'is-error': settings.logError }"
            >{{ logPreviewText }}</pre>
          </section>
        </section>
      </template>

      <!-- About tab -->
      <template v-else-if="settings.activeTab === 'about'">
        <section class="settings-section">
          <div class="settings-section-head">
            <h3>关于 WonderfulUI</h3>
          </div>
          <div class="settings-row settings-row-stack">
            <div class="settings-row-main">
              <div class="settings-row-title">版本</div>
              <div class="settings-row-sub">v{{ APP_VERSION }}</div>
            </div>
            <div class="settings-row-main">
              <div class="settings-row-sub is-muted">无畏时刻高光离线浏览器。无需启动游戏即可浏览 VALORANT 高光时刻的元数据与本地录像。</div>
            </div>
          </div>
        </section>
      </template>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted, nextTick } from 'vue';
import WIcon from '../common/WIcon.vue';
import { useAccountStore } from '../../stores/account.ts';
import { useFilterStore } from '../../stores/filter.ts';
import { useSettingsStore } from '../../stores/settings.ts';
import { useUiStore } from '../../stores/ui.ts';
import { invoke } from '../../tauri-adapter.ts';
import { APP_VERSION } from '../../utils/version.ts';
import { fmtBytes, CHART_METRIC_LABELS, CHART_METRIC_EMPTY, mountAccountVideoChart, disposeAccountVideoChart } from '../../utils/library-stats.ts';
import type { LibraryStats } from '../../utils/library-stats.ts';

const account = useAccountStore();
const filter = useFilterStore();
const settings = useSettingsStore();
const ui = useUiStore();

const chartRef = ref<HTMLElement | null>(null);

const chartOverlay = ref<{ total: number; label: string; emptyLabel: string }>({
  total: 0,
  label: CHART_METRIC_LABELS.video,
  emptyLabel: CHART_METRIC_EMPTY.video,
});

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

const logPreviewRef = ref<HTMLPreElement | null>(null);

watch(logPreviewText, () => {
  nextTick(() => {
    const el = logPreviewRef.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
});

async function onFullScan() {
  ui.showScanOverlay();
  try {
    await account.scrapeLibrary('full');
  } finally {
    ui.hideScanOverlay();
  }
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

onMounted(() => {
  if (settings.activeTab === 'library' && !settings.statsData && !settings.statsLoading && !settings.statsError) {
    settings.fetchLibraryStats();
  }
  if (settings.activeTab === 'logs') {
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
    chartOverlay.value = mountAccountVideoChart(chartRef.value, statsData.value, settings.chartMetric);
  }
});

onMounted(() => {
  if (chartRef.value && statsData.value) {
    chartOverlay.value = mountAccountVideoChart(chartRef.value, statsData.value, settings.chartMetric);
  }
});

onUnmounted(() => {
  disposeAccountVideoChart();
});
</script>

<style scoped>
.settings-modal-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 16px;
  padding: 13px 16px;
  border-bottom: 1px solid var(--border-soft);
  background: var(--surface);
}
.settings-title-group { min-width: 0; }
.settings-title {
  margin: 0;
  color: var(--ink);
  font-size: 16px;
  line-height: 1.25;
  font-weight: var(--w-semibold);
}
.settings-close { flex-shrink: 0; }
.settings-modal-body {
  display: grid;
  grid-template-columns: 128px minmax(0, 1fr);
  min-height: 0;
  flex: 1;
}
.settings-nav {
  padding: 8px;
  border-right: 1px solid var(--border-soft);
  background: var(--surface);
}
.settings-nav-item {
  width: 100%;
  min-height: 34px;
  display: flex; align-items: center; gap: 9px;
  padding: 7px 9px;
  border-radius: var(--radius);
  color: var(--ink-3);
  font-size: 12px;
  text-align: left;
  transition:
    background 100ms ease-out,
    color 100ms ease-out;
}
.settings-nav-item.is-active {
  background: var(--surface-2);
  color: var(--ink);
  font-weight: var(--w-medium);
}
.settings-nav-item.is-disabled {
  color: var(--ink-4);
  cursor: default;
}
.settings-content {
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  padding: 14px;
  display: flex; flex-direction: column;
  gap: 12px;
}
.settings-content--logs {
  overflow: hidden;
}
.settings-section {
  flex: 0 0 auto;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  background: transparent;
  overflow: hidden;
}
.settings-section-head {
  display: flex; align-items: baseline; justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-soft);
}
.settings-section-head h3 {
  margin: 0;
  font-size: 14px;
  font-weight: var(--w-semibold);
  color: var(--ink);
}
.settings-section-sub {
  color: var(--ink-3);
  font-size: 11px;
}
.settings-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  min-height: 54px;
  padding: 9px 12px;
  transition: background 100ms ease-out;
}
.settings-row + .settings-row { border-top: 1px solid var(--border-soft); }
.settings-row:has(.settings-action):hover,
.settings-row:has(.settings-segment):hover {
  background: color-mix(in oklch, var(--surface-2), transparent 55%);
}
.settings-row.is-disabled { color: var(--ink-4); }
.settings-row-stack {
  grid-template-columns: 1fr;
  align-items: start;
  gap: 8px;
}
.settings-row-main { min-width: 0; }
.settings-row-title {
  color: var(--ink);
  font-size: 13px;
  font-weight: var(--w-medium);
}
.settings-row.is-disabled .settings-row-title { color: var(--ink-3); }
.settings-row-sub {
  margin-top: 2px;
  color: var(--ink-3);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.settings-row-sub.is-error {
  color: var(--warn);
}
.settings-row-sub.is-muted {
  color: var(--ink-3);
  font-size: 13px;
  line-height: 1.6;
}
.settings-sub-line {
  display: inline-flex; align-items: center; gap: 4px;
  flex-wrap: wrap;
}
.settings-sub-line svg {
  color: var(--ink-3);
  flex-shrink: 0;
}
.settings-action {
  display: inline-flex; align-items: center; gap: 6px;
  min-width: 92px;
  justify-content: center;
  white-space: nowrap;
  color: var(--ink-2);
  border: 1px solid var(--border-soft);
  background: transparent;
  transition:
    background 100ms ease-out,
    border-color 100ms ease-out,
    color 100ms ease-out;
}
.settings-action svg { color: var(--accent); }
.settings-action:hover {
  color: var(--ink);
  border-color: var(--accent);
  background: color-mix(in oklch, var(--accent), transparent 92%);
}
.settings-action:disabled {
  opacity: 0.68;
  cursor: default;
}
.settings-action:disabled:hover {
  color: var(--ink-2);
  border-color: var(--border-soft);
  background: transparent;
}
.settings-action.is-loading svg {
  animation: spin 900ms linear infinite;
  transform-origin: center;
  transform-box: fill-box;
}
.settings-action-group {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.settings-segment {
  display: inline-grid;
  grid-template-columns: repeat(2, minmax(76px, 1fr));
  padding: 2px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  background: var(--bg);
}
.settings-segment-btn {
  min-height: 28px;
  padding: 4px 9px;
  border-radius: calc(var(--radius) - 2px);
  color: var(--ink-3);
  font-size: 12px;
  white-space: nowrap;
  transition:
    background 100ms ease-out,
    color 100ms ease-out;
}
.settings-segment-btn:hover {
  color: var(--ink-2);
}
.settings-segment-btn.is-active {
  color: var(--ink);
  background: var(--surface-2);
  font-weight: var(--w-medium);
}
.settings-chip {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 58px;
  padding: 3px 8px;
  border-radius: 999px;
  color: var(--ink-3);
  background: var(--surface-2);
  border: 1px solid var(--border-soft);
  font-size: 12px;
  white-space: nowrap;
}
.settings-chip.muted {
  color: var(--ink-4);
  background: transparent;
}
.settings-log-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  background: color-mix(in oklch, var(--bg), transparent 34%);
}
.settings-log-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  padding: 12px;
  border-bottom: 1px solid var(--border-soft);
  background: color-mix(in oklch, var(--surface), transparent 18%);
}
.settings-log-identity {
  min-width: 0;
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
}
.settings-log-icon {
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink-3);
}
.settings-log-copy {
  min-width: 0;
}
.settings-log-name {
  color: var(--ink);
  font-size: 13px;
  font-weight: var(--w-medium);
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.settings-log-statusline {
  margin-top: 2px;
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--ink-3);
  font-family: var(--font-mono);
  font-size: 10.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.settings-log-statusline span + span::before {
  content: '';
  display: inline-block;
  width: 3px;
  height: 3px;
  margin-right: 8px;
  border-radius: 50%;
  background: var(--ink-4);
  vertical-align: 2px;
}
.settings-log-actions {
  padding-top: 0;
  flex-wrap: nowrap;
}
.settings-log-actions .settings-action {
  min-width: 84px;
}
.settings-log-viewer {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.settings-log-viewer-head {
  display: flex;
  align-items: center;
  min-height: 38px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border-soft);
}
.settings-log-viewer-head h3 {
  margin: 0;
  color: var(--ink);
  font-size: 13px;
  font-weight: var(--w-semibold);
}
.settings-log-preview {
  flex: 1;
  margin: 0;
  min-height: 0;
  max-height: none;
  overflow: auto;
  padding: 10px 12px 22px;
  background: var(--bg);
  color: var(--ink-2);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.62;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: text;
}
.settings-log-preview.is-error {
  color: var(--warn);
}

.stats-video-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
}
.stats-video-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.stats-video-metric {
  min-width: 0;
  padding: 9px 10px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  background: color-mix(in oklch, var(--surface-2), transparent 48%);
}
.stats-video-metric--toggle {
  display: block;
  width: 100%;
  text-align: left;
  cursor: pointer;
  color: inherit;
  font: inherit;
  transition:
    background-color 120ms ease-out,
    border-color 120ms ease-out,
    color 120ms ease-out;
}
.stats-video-metric--toggle:hover {
  background: color-mix(in oklch, var(--surface-2), var(--ink) 10%);
  border-color: color-mix(in oklch, var(--border-soft), var(--ink-3) 55%);
}
.stats-video-metric--toggle:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
.stats-video-metric--toggle.is-active {
  background: color-mix(in oklch, var(--accent), transparent 55%);
  border-color: var(--accent);
}
.stats-video-metric--toggle.is-active:hover {
  background: color-mix(in oklch, var(--accent), transparent 38%);
}
.stats-video-metric--toggle.is-active .stats-video-value {
  color: var(--ink);
}
.stats-video-metric--toggle.is-active .stats-video-label {
  color: var(--ink-2);
}
.stats-video-value {
  display: block;
  color: var(--ink);
  font-family: var(--font-mono);
  font-size: 18px;
  line-height: 1.15;
  font-weight: var(--w-semibold);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.stats-video-label {
  display: block;
  margin-top: 2px;
  color: var(--ink-3);
  font-size: 11px;
}
.stats-video-chart {
  position: relative;
  width: 100%;
  height: 224px;
  min-height: 224px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  background: color-mix(in oklch, var(--bg), transparent 38%);
}
.stats-video-chart svg path {
  transition: opacity 100ms ease-out;
  cursor: pointer;
}
.stats-video-chart svg path:hover {
  opacity: 0.75;
}
.stats-video-chart-center {
  position: absolute;
  left: 35%;
  top: 51%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  pointer-events: none;
  text-align: center;
  line-height: 1.1;
}
.stats-video-chart-center-number {
  font-family: var(--font-mono);
  font-size: 18px;
  font-weight: 600;
  color: var(--ink);
}
.stats-video-chart-center-label {
  font-family: var(--font-sans);
  font-size: 12px;
  color: var(--ink-2);
}
.stats-video-chart-center-empty {
  font-family: var(--font-sans);
  font-size: 12px;
  color: var(--ink-3);
}
.stats-video-notice {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 14px;
  padding: 0 12px 12px;
}
.stats-video-warn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  min-width: 0;
  color: var(--warn);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.stats-video-warn svg {
  color: var(--warn);
  width: 12px;
  height: 12px;
}

@media (max-width: 760px) {
  .stats-video-summary {
    grid-template-columns: 1fr;
  }
  .stats-video-chart {
    height: 280px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .settings-action.is-loading svg {
    animation-duration: 1ms;
    animation-iteration-count: 1;
  }
  .settings-nav-item,
  .settings-row,
  .settings-action,
  .settings-segment-btn {
    transition-duration: 1ms;
  }
}

@media (max-width: 760px) {
  .settings-modal-body {
    grid-template-columns: 1fr;
  }
  .settings-nav {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    border-right: 0;
    border-bottom: 1px solid var(--border-soft);
  }
  .settings-nav-item {
    width: auto;
    flex: 0 0 auto;
  }
  .settings-row {
    grid-template-columns: 1fr;
    align-items: start;
    gap: 8px;
  }
  .settings-action {
    width: 100%;
  }
  .settings-segment {
    width: 100%;
  }
}
</style>
