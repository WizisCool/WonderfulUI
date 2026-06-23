// 分享平台注册表。
//
// 当前实现：'lan-qr'（内嵌 HTTP server + QR 码）。后续加新平台：
// 1) 写 platforms/<name>.ts
// 2) 在这里 import + 加一行
// 3) PlayerHost 不用改（share popover 自动列出新 target）

import { lanQrPlatform } from './platforms/lan-qr.ts';
import type { SharePlatform } from './types.ts';

export const sharePlatforms: Record<string, SharePlatform> = {
  'lan-qr': lanQrPlatform,
};
