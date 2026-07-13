// 分享中心入口。
//
// - `openShareMenu(anchor, ctx)`：从 anchor 元素（通常是播放器工具栏的
//   "分享"按钮）旁边弹一个轻量 popover，列出所有 isAvailable() 的平台；
//   点一项调对应 platform.share(ctx)。Popover 沿用右键菜单的
//   motion vocabulary（player-ctxmenu-in 160ms / player-ctxmenu-out
//   120ms，mousedown capture + button-0 关闭）。
// - `listAvailablePlatforms()`：返回当前可用的平台列表（用于测试 / 调试）。
//
// PlayerHost 在收到 `@share` 事件时调 `openShareMenu(shareBtn, ctx)`。
//
// **当前 popover 还是 TODO**：没有平台实现时，openShareMenu 直接走
// `onResult('__no_platforms__', 'failed', '...')`，PlayerHost 用 toast
// 提示用户。第一个 platform 上线后这里实现 popover + click handler。

import { sharePlatforms } from './registry.ts';
import type { ShareContext, SharePlatform } from './types.ts';

export function listAvailablePlatforms(): SharePlatform[] {
  return Object.values(sharePlatforms).filter((p) => p.isAvailable());
}

export interface OpenShareMenuOptions {
  /** 用户选了平台 / 关闭后的回调。 */
  onResult?: (platformId: string, result: 'ok' | 'failed', message?: string) => void;
}

/**
 * 在 anchor 元素下方弹一个 popover，列出可用的分享平台。
 *
 * 框架初始实现：当没有平台注册时直接走 onResult('__no_platforms__', 'failed')，
 * PlayerHost 用 toast 提示用户。等到第一个 platform.ts 上线后，这里会
 * 渲染真正的 popover（参考 PlayerHost 的右键菜单实现 —— 同样的
 * mousedown capture + button-0 关闭契约）。
 */
export function openShareMenu(
  _anchor: HTMLElement,
  _ctx: ShareContext,
  options: OpenShareMenuOptions = {},
): void {
  const platforms = listAvailablePlatforms();
  if (platforms.length === 0) {
    options.onResult?.(
      '__no_platforms__',
      'failed',
      '尚未配置任何分享平台',
    );
    return;
  }
  // 多个 platform 都可用时真正的 popover 逻辑 TODO：渲染菜单项、
  // 处理点击、调用 platform.share(ctx)。
}

export type { ShareContext, ShareResult, SharePlatform } from './types.ts';
export { SHARE_ICON, SHARE_ICON_SIZE } from './icons.ts';
