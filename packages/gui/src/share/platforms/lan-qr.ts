// "快传" 平台实现：内嵌 HTTP server + 二维码，手机/电脑扫码下载。
// Rust 端见 src-tauri/src/share_server.rs。

import { SHARE_ICON } from '../icons.ts';
import type { ShareContext, SharePlatform, ShareResult } from '../types.ts';

export const lanQrPlatform: SharePlatform = {
  id: 'lan-qr',
  label: '快传（扫码下载）',
  description: '同 WiFi 下扫码即下载',
  /** UI icon — same as toolbar / context menu / ShareModal brand. */
  icon: SHARE_ICON,

  isAvailable(): boolean {
    // 任何 Windows 桌面都可用（不需要装 LocalSend / 任何外部 app）
    return typeof window !== 'undefined';
  },

  // 这个 platform 不直接 share —— PlayerHost 看到 id === 'lan-qr' 时
  // 会弹 ShareModal（而不是同步调用 share()）。share() 只在
  // isAvailable() 失败时兜底返回 ok（不该走到）。
  async share(_ctx: ShareContext): Promise<ShareResult> {
    return { kind: 'ok', message: '请通过 ShareModal 启动' };
  },
};
