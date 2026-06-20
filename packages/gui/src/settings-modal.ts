import { createElement, Bug, Database, FileText, FolderOpen, RefreshCw, X } from 'lucide';
import { el } from './dom.ts';

export type ScrapeMode = 'incremental' | 'full';
export type SettingsTab = 'library' | 'logs';

export interface LogStatus {
  logDir: string;
  logPath: string;
  size: number;
  modifiedMs: number;
  maxBytes: number;
  latestText: string;
}

export interface LogPanelState {
  loading: boolean;
  status: LogStatus | null;
  error: string | null;
}

const REFRESH_SCAN_MODE_KEY = 'wui:library.refreshScanMode';

export function scanModeLabel(mode: ScrapeMode): string {
  return mode === 'full' ? '全量扫描' : '增量扫描';
}

export function loadRefreshScanMode(): ScrapeMode {
  return localStorage.getItem(REFRESH_SCAN_MODE_KEY) === 'full' ? 'full' : 'incremental';
}

export function saveRefreshScanMode(mode: ScrapeMode) {
  localStorage.setItem(REFRESH_SCAN_MODE_KEY, mode);
}

function fmtBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
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

function navButton(tab: SettingsTab, activeTab: SettingsTab, icon: SVGElement, label: string): HTMLElement {
  return el('button', {
    class: `settings-nav-item ${activeTab === tab ? 'is-active' : ''}`,
    type: 'button',
    'data-action': 'set-settings-tab',
    'data-tab': tab,
    'aria-current': activeTab === tab ? 'page' : 'false',
  }, [
    icon,
    el('span', {}, [label]),
  ]);
}

function librarySettingsContent(scraping: boolean, scanMode: ScrapeMode): HTMLElement[] {
  const fullButton = el('button', {
    class: 'btn settings-action',
    type: 'button',
    'data-action': 'scrape-library-full',
  }, [
    createElement(Database, { width: 15, height: 15 }),
    el('span', {}, [scraping ? '扫描中' : '全量扫描']),
  ]);
  fullButton.disabled = scraping;
  const modeButtons = el('div', {
    class: 'settings-segment',
    role: 'radiogroup',
    'aria-label': '扫描模式',
  }, [
    el('button', {
      class: `settings-segment-btn ${scanMode === 'incremental' ? 'is-active' : ''}`,
      type: 'button',
      role: 'radio',
      'aria-checked': String(scanMode === 'incremental'),
      'data-action': 'set-refresh-scan-mode',
      'data-mode': 'incremental',
    }, ['增量扫描']),
    el('button', {
      class: `settings-segment-btn ${scanMode === 'full' ? 'is-active' : ''}`,
      type: 'button',
      role: 'radio',
      'aria-checked': String(scanMode === 'full'),
      'data-action': 'set-refresh-scan-mode',
      'data-mode': 'full',
    }, ['全量扫描']),
  ]);

  return [
    el('section', { class: 'settings-section' }, [
      el('div', { class: 'settings-section-head' }, [
        el('h3', {}, ['本地资料库']),
        el('span', { class: 'settings-section-sub' }, ['扫描设置']),
      ]),
      el('div', { class: 'settings-row' }, [
        el('div', { class: 'settings-row-main' }, [
          el('div', { class: 'settings-row-title' }, ['刷新模式']),
          el('div', { class: 'settings-row-sub settings-sub-line' }, [
            '决定右上角',
            createElement(RefreshCw, { width: 12, height: 12 }),
            '刷新按钮的工作方式',
          ]),
        ]),
        modeButtons,
      ]),
      el('div', { class: 'settings-row' }, [
        el('div', { class: 'settings-row-main' }, [
          el('div', { class: 'settings-row-title' }, ['全量扫描']),
          el('div', { class: 'settings-row-sub' }, ['全部重新解析，适合重建本地库']),
        ]),
        fullButton,
      ]),
    ]),
  ];
}

function logSettingsContent(logs: LogPanelState): HTMLElement[] {
  const status = logs.status;
  const rawLatestText = logs.loading && status
    ? status.latestText
    : (logs.loading
    ? '正在读取日志...'
    : (logs.error ?? status?.latestText ?? '暂无日志内容'));
  const latestText = fmtLogPreview(rawLatestText);
  const sizeText = status ? `${fmtBytes(status.size)} / ${fmtBytes(status.maxBytes)}` : '尚未生成';
  const modifiedText = status?.modifiedMs ? fmtLogTime(status.modifiedMs) : '暂无';
  const logName = fileName(status?.logPath, 'wonderful-ui.log');
  return [
    el('section', { class: 'settings-log-panel' }, [
      el('header', { class: 'settings-log-toolbar' }, [
        el('div', { class: 'settings-log-identity' }, [
          el('div', { class: 'settings-log-icon' }, [
            createElement(FileText, { width: 16, height: 16 }),
          ]),
          el('div', { class: 'settings-log-copy' }, [
            el('div', { class: 'settings-log-name' }, [logName]),
            el('div', { class: 'settings-log-statusline' }, [
              el('span', {}, [sizeText]),
              el('span', {}, [`更新 ${modifiedText}`]),
            ]),
          ]),
        ]),
        el('div', { class: 'settings-action-group settings-log-actions' }, [
          el('button', {
            class: `btn settings-action ${logs.loading ? 'is-loading' : ''}`,
            type: 'button',
            'data-action': 'refresh-logs',
            'aria-busy': String(logs.loading),
          }, [
            createElement(RefreshCw, { width: 15, height: 15 }),
            el('span', {}, [logs.loading ? '刷新中' : '刷新']),
          ]),
          el('button', {
            class: 'btn settings-action',
            type: 'button',
            'data-action': 'reveal-logs-dir',
          }, [
            createElement(FolderOpen, { width: 15, height: 15 }),
            el('span', {}, ['打开目录']),
          ]),
        ]),
      ]),
      el('section', { class: 'settings-log-viewer' }, [
        el('div', { class: 'settings-log-viewer-head' }, [
          el('h3', {}, ['最近内容']),
        ]),
        el('pre', { class: `settings-log-preview ${logs.error ? 'is-error' : ''}` }, [latestText]),
      ]),
    ]),
  ];
}

export function settingsModal(
  scraping: boolean,
  scanMode: ScrapeMode,
  activeTab: SettingsTab,
  logs: LogPanelState,
  closing = false,
): HTMLElement {
  const content = activeTab === 'logs'
    ? logSettingsContent(logs)
    : librarySettingsContent(scraping, scanMode);

  return el('div', { class: `settings-modal-backdrop ${closing ? 'is-closing' : ''}` }, [
    el('section', {
      class: 'settings-modal',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'settings-title',
      'data-settings-tab': activeTab,
    }, [
      el('header', { class: 'settings-modal-head' }, [
        el('div', { class: 'settings-title-group' }, [
          el('h2', { class: 'settings-title', id: 'settings-title' }, ['设置']),
        ]),
        el('button', {
          class: 'iconbtn settings-close',
          type: 'button',
          'aria-label': '关闭设置',
          'data-action': 'close-settings',
        }, [createElement(X, { width: 16, height: 16 })]),
      ]),
      el('div', { class: 'settings-modal-body' }, [
        el('nav', { class: 'settings-nav', 'aria-label': '设置分区' }, [
          navButton('library', activeTab, createElement(Database, { width: 16, height: 16 }), '资料库'),
          navButton('logs', activeTab, createElement(Bug, { width: 16, height: 16 }), '日志'),
        ]),
        el('main', { class: `settings-content ${activeTab === 'logs' ? 'settings-content--logs' : ''}` }, content),
      ]),
    ]),
  ]);
}
