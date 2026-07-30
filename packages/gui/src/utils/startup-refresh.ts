export type StartupRefreshStatus = 'finished' | 'degraded' | 'error' | 'timeout';

export interface StartupRefreshResult {
  status: StartupRefreshStatus;
  error?: string;
}

/** Release boot after a deadline without settling or cancelling the real terminal promise. */
export function waitForStartupRefresh(
  terminal: Promise<StartupRefreshResult>,
  timeoutMs: number,
): Promise<StartupRefreshResult> {
  return new Promise(resolve => {
    let resolved = false;
    const timer = globalThis.setTimeout(() => {
      if (resolved) return;
      resolved = true;
      resolve({ status: 'timeout' });
    }, timeoutMs);

    terminal.then(
      result => {
        if (resolved) return;
        resolved = true;
        globalThis.clearTimeout(timer);
        resolve(result);
      },
      error => {
        if (resolved) return;
        resolved = true;
        globalThis.clearTimeout(timer);
        resolve({
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        });
      },
    );
  });
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
