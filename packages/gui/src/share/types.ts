// WonderfulUI 分享中心 —— 平台无关的抽象层。
//
// 原则：
// - 本应用**不实现任何第三方传输协议**（LocalSend / 微信 / 蓝牙等都靠
//   平台自己的客户端或系统通道）。分享平台模块只负责"把视频路径交给
//   外部目标"，所有网络行为由外部完成。
// - 未来加新平台 = 新建 `platforms/<name>.ts` + 在 `registry.ts` 注册。
//   PlayerHost 不用改。
// - 当前**没有任何平台实现**。第一个要加的候选（按用户优先级）：
//   - "在系统共享面板发送" —— 走 Win11 资源管理器的"共享"ribbon
//     （用户在资源管理器里点"共享"按钮选目标，不走 Win11 UWP Share Sheet）
//   - "复制文件到剪贴板" —— 把 .mp4 路径塞进 Windows 剪贴板（CF_HDROP），
//     用户切到微信窗口 Ctrl+V
//   两者都是几十行 Win32 代码、零网络依赖，跟我们 hard constraints
//   （不碰 ACLOS / Riot / Vanguard）不冲突。

export interface ShareContext {
  /** 视频绝对路径（已经走 ACLOS 解密后的本地文件）。 */
  videoPath: string;
  /** 给菜单/UI 显示用的文件名。 */
  videoName: string;
}

export type ShareResult =
  /** 成功 —— 弹了系统面板、复制了文件、启动了外部程序等都算。 */
  | { kind: 'ok'; message?: string }
  /** 失败 —— 前端用 toast 提示。 */
  | { kind: 'failed'; reason: string };

export interface SharePlatform {
  /** 稳定 ID（如 'explorer-share' / 'clipboard'），用作 registry key。 */
  readonly id: string;
  /** 菜单显示名（如 "通过系统共享面板发送"）。 */
  readonly label: string;
  /** 副标题，描述约束或外部依赖（如 "需 Win11 资源管理器"）。 */
  readonly description: string;
  /** 平台是否可用（Win11 才有 Share ribbon / Windows 才有剪贴板等）。 */
  isAvailable(): boolean;
  /** 触发分享。失败必须返回 {kind:'failed', reason:'...'}，不要 throw。 */
  share(ctx: ShareContext): Promise<ShareResult>;
}
