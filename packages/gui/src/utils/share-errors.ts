// Stable backend error-code to user-facing Quick Share message mapping.
// Never render the raw Tauri error: it may contain native paths, HRESULTs, or
// listener details that are useful in logs but not appropriate for the UI.

export const FRIENDLY_SHARE_START_ERROR = '快传服务启动失败，请重试';
export const FRIENDLY_SHARE_STOP_ERROR = '快传服务异常停止，请重试';

const START_MESSAGES: Record<string, string> = {
  WUI_SHARE_SOURCE_UNAVAILABLE: '快传源文件不可用，请重新扫描后重试。',
  WUI_SHARE_PORT_IN_USE: '快传端口 22357 被占用，请关闭占用该端口的程序后重试。',
  WUI_SHARE_PORT_BIND_FAILED: '快传无法监听端口 22357，请稍后重试。',
  WUI_SHARE_LAN_IP_UNAVAILABLE: '未检测到可供其他设备访问的局域网 IPv4 地址。',
  WUI_SHARE_FIREWALL_POLICY_MANAGED: 'Windows 防火墙规则受组织策略管理，请联系管理员。',
  WUI_SHARE_FIREWALL_INBOUND_BLOCKED: '当前 Windows 入站策略禁止连接，请允许局域网入站后重试。',
  WUI_SHARE_FIREWALL_AUTHORIZATION_CANCELLED: '需要允许 Windows 管理员授权才能开启快传。',
  WUI_SHARE_FIREWALL_AUTHORIZATION_FAILED: 'Windows 防火墙授权失败，请稍后重试或联系管理员。',
  WUI_SHARE_START_CANCELLED: '快传启动已取消。',
  WUI_SHARE_SERVER_START_FAILED: FRIENDLY_SHARE_START_ERROR,
};

export function friendlyShareError(
  error: unknown,
  phase: 'start' | 'stop' = 'start',
): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const code = raw.split('|', 1)[0] ?? '';
  if (phase === 'start' && START_MESSAGES[code]) return START_MESSAGES[code];
  return phase === 'stop' ? FRIENDLY_SHARE_STOP_ERROR : FRIENDLY_SHARE_START_ERROR;
}
