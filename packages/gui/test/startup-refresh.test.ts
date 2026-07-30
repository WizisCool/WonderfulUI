import { describe, expect, test } from 'bun:test';
import {
  parseStartupRefreshResult,
  waitForStartupRefresh,
} from '../src/utils/startup-refresh.ts';

describe('parseStartupRefreshResult', () => {
  test('accepts the successful terminal event without inventing an error', () => {
    expect(parseStartupRefreshResult({ status: 'finished' })).toEqual({ status: 'finished' });
  });

  test('preserves degraded and fatal background failures', () => {
    expect(parseStartupRefreshResult({ status: 'degraded', error: ' source unavailable ' }))
      .toEqual({ status: 'degraded', error: 'source unavailable' });
    expect(parseStartupRefreshResult({ status: 'error', error: 'database unavailable' }))
      .toEqual({ status: 'error', error: 'database unavailable' });
  });

  test('fails closed for malformed terminal events', () => {
    expect(parseStartupRefreshResult({ status: 'other' })).toEqual({
      status: 'error',
      error: '后台资料库返回了未知状态',
    });
    expect(parseStartupRefreshResult({ status: 'error' }).error).not.toBe('');
  });
});

describe('waitForStartupRefresh', () => {
  test('releases the caller on timeout without settling the terminal work', async () => {
    let finish!: (result: { status: 'finished' }) => void;
    const terminal = new Promise<{ status: 'finished' }>(resolve => {
      finish = resolve;
    });

    await expect(waitForStartupRefresh(terminal, 0)).resolves.toEqual({ status: 'timeout' });
    finish({ status: 'finished' });
    await expect(terminal).resolves.toEqual({ status: 'finished' });
  });
});
