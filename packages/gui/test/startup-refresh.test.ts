import { describe, expect, test } from 'bun:test';
import { parseStartupRefreshResult } from '../src/utils/startup-refresh.ts';

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
