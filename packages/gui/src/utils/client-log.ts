// 客户端日志助手：把前端关键事件转发到 Rust `app_log`，
// 与后端日志统一格式（tag=client/<scope>，level=info|warn|error）。
//
// 浏览器调试模式下（无 Tauri runtime）只打 console.info，
// 不抛错。前端测试环境（happy-dom）也安全。

import { invoke } from '../tauri-adapter.ts';

let hasTauri = false;
if (typeof window !== 'undefined') {
  hasTauri = !!window.__TAURI_INTERNALS__;
}

export type ClientLogLevel = 'info' | 'warn' | 'error';

export function clientLog(level: ClientLogLevel, scope: string, message: string): void {
  // 浏览器 / 测试环境：仅 console，**不**调 invoke（会 throw）
  if (!hasTauri) {
    if (level === 'error') console.error(`[${scope}] ${message}`);
    else if (level === 'warn') console.warn(`[${scope}] ${message}`);
    else console.info(`[${scope}] ${message}`);
    return;
  }
  // Tauri runtime：调 Rust log_event（fire-and-forget，错误不抛）
  invoke('log_event', { level, scope, message }).catch(() => {
    // best-effort；失败时只 console
    if (level === 'error') console.error(`[${scope}] ${message}`);
    else if (level === 'warn') console.warn(`[${scope}] ${message}`);
    else console.info(`[${scope}] ${message}`);
  });
}
