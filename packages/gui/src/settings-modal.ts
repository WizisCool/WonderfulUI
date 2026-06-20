import { createElement, Clock3, Database, HardDrive, RefreshCw, X } from 'lucide';
import { el } from './dom.ts';

export type ScrapeMode = 'incremental' | 'full';

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

export function settingsModal(scraping: boolean, scanMode: ScrapeMode, closing = false): HTMLElement {
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

  return el('div', { class: `settings-modal-backdrop ${closing ? 'is-closing' : ''}` }, [
    el('section', {
      class: 'settings-modal',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'settings-title',
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
          el('button', { class: 'settings-nav-item is-active', type: 'button' }, [
            createElement(Database, { width: 16, height: 16 }),
            el('span', {}, ['资料库']),
          ]),
          el('div', { class: 'settings-nav-item is-disabled' }, [
            createElement(Clock3, { width: 16, height: 16 }),
            el('span', {}, ['自动化']),
          ]),
          el('div', { class: 'settings-nav-item is-disabled' }, [
            createElement(HardDrive, { width: 16, height: 16 }),
            el('span', {}, ['迁移备份']),
          ]),
        ]),
        el('main', { class: 'settings-content' }, [
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
          el('section', { class: 'settings-section' }, [
            el('div', { class: 'settings-section-head' }, [
              el('h3', {}, ['后续能力']),
              el('span', { class: 'settings-section-sub' }, ['未接入']),
            ]),
            el('div', { class: 'settings-row is-disabled' }, [
              el('div', { class: 'settings-row-main' }, [
                el('div', { class: 'settings-row-title' }, ['自动扫描']),
                el('div', { class: 'settings-row-sub' }, ['定期 / 资源变化时刷新']),
              ]),
              el('span', { class: 'settings-chip muted' }, ['未接入']),
            ]),
            el('div', { class: 'settings-row is-disabled' }, [
              el('div', { class: 'settings-row-main' }, [
                el('div', { class: 'settings-row-title' }, ['视频资源同步']),
                el('div', { class: 'settings-row-sub' }, ['路径发现 / MD5 绑定']),
              ]),
              el('span', { class: 'settings-chip muted' }, ['未接入']),
            ]),
            el('div', { class: 'settings-row is-disabled' }, [
              el('div', { class: 'settings-row-main' }, [
                el('div', { class: 'settings-row-title' }, ['迁移与备份']),
                el('div', { class: 'settings-row-sub' }, ['导入 / 导出本地库']),
              ]),
              el('span', { class: 'settings-chip muted' }, ['未接入']),
            ]),
          ]),
        ]),
      ]),
    ]),
  ]);
}
