import { describe, expect, test } from 'bun:test';
import {
  canBeginShareStart,
  createShareSessionId,
  formatShareSessionUuidV4,
  shouldCommitShareStart,
  shouldHandleShareEvent,
} from '../src/utils/share-start.ts';
import { friendlyShareError } from '../src/utils/share-errors.ts';

describe('share start guards', () => {
  test('canBeginShareStart blocks only while starting', () => {
    expect(canBeginShareStart('idle')).toBe(true);
    expect(canBeginShareStart('running')).toBe(true);
    expect(canBeginShareStart('error')).toBe(true);
    expect(canBeginShareStart('starting')).toBe(false);
  });

  test('shouldCommitShareStart requires the same active handshake', () => {
    expect(shouldCommitShareStart('starting', 'session-7', 'session-7')).toBe(true);
    expect(shouldCommitShareStart('starting', 'session-8', 'session-7')).toBe(false);
    expect(shouldCommitShareStart('starting', null, 'session-7')).toBe(false);
    expect(shouldCommitShareStart('idle', 'session-7', 'session-7')).toBe(false);
    expect(shouldCommitShareStart('running', 'session-7', 'session-7')).toBe(false);
    expect(shouldCommitShareStart('error', 'session-7', 'session-7')).toBe(false);
  });

  test('events are handled only for the current server session', () => {
    expect(shouldHandleShareEvent('session-11', 'session-11')).toBe(true);
    expect(shouldHandleShareEvent('session-12', 'session-11')).toBe(false);
    expect(shouldHandleShareEvent(null, 'session-11')).toBe(false);
  });

  test('session IDs do not reuse a simple process-local counter', () => {
    const first = createShareSessionId();
    const second = createShareSessionId();
    expect(first).not.toBe(second);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  test('fallback bytes are normalized into the backend UUID v4 contract', () => {
    expect(formatShareSessionUuidV4(new Uint8Array(16)))
      .toBe('00000000-0000-4000-8000-000000000000');
    expect(() => formatShareSessionUuidV4(new Uint8Array(15))).toThrow();
  });

  test('stable backend error codes map to concrete safe messages', () => {
    for (const [code, message] of [
      ['WUI_SHARE_SOURCE_UNAVAILABLE', '快传源文件不可用，请重新扫描后重试。'],
      ['WUI_SHARE_PORT_IN_USE', '快传端口 22357 被占用，请关闭占用该端口的程序后重试。'],
      ['WUI_SHARE_PORT_BIND_FAILED', '快传无法监听端口 22357，请稍后重试。'],
      ['WUI_SHARE_LAN_IP_UNAVAILABLE', '未检测到可供其他设备访问的局域网 IPv4 地址。'],
      ['WUI_SHARE_FIREWALL_POLICY_MANAGED', 'Windows 防火墙规则受组织策略管理，请联系管理员。'],
      ['WUI_SHARE_FIREWALL_INBOUND_BLOCKED', '当前 Windows 入站策略禁止连接，请允许局域网入站后重试。'],
      ['WUI_SHARE_FIREWALL_AUTHORIZATION_CANCELLED', '需要允许 Windows 管理员授权才能开启快传。'],
      ['WUI_SHARE_FIREWALL_AUTHORIZATION_FAILED', 'Windows 防火墙授权失败，请稍后重试。'],
      ['WUI_SHARE_START_CANCELLED', '快传启动已取消。'],
      ['WUI_SHARE_SERVER_START_FAILED', '快传服务启动失败，请重试'],
    ] as const) {
      expect(friendlyShareError(`${code}|internal detail`, 'start')).toBe(message);
    }
    expect(friendlyShareError('unknown-native-error', 'start'))
      .toBe('快传服务启动失败，请重试');
    expect(friendlyShareError('unknown-native-error', 'stop'))
      .toBe('快传服务异常停止，请重试');
  });
});
