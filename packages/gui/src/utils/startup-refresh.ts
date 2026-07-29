export type StartupRefreshStatus = 'finished' | 'degraded' | 'error' | 'timeout';

export interface StartupRefreshResult {
  status: StartupRefreshStatus;
  error?: string;
}

/** Normalize the terminal Rust event before it controls the boot lifecycle. */
export function parseStartupRefreshResult(payload: Record<string, unknown>): StartupRefreshResult {
  const status = payload.status;
  if (status === 'finished') return { status };
  if (status === 'degraded' || status === 'error') {
    const error = typeof payload.error === 'string' && payload.error.trim()
      ? payload.error.trim()
      : '后台资料库刷新失败';
    return { status, error };
  }
  return { status: 'error', error: '后台资料库返回了未知状态' };
}
