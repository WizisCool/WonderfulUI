import { describe, expect, test } from 'bun:test';
import {
  canBeginShareStart,
  createShareSessionId,
  formatShareSessionUuidV4,
  shouldCommitShareStart,
  shouldHandleShareEvent,
} from '../src/utils/share-start.ts';

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
});
