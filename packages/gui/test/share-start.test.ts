import { describe, expect, test } from 'bun:test';
import {
  canBeginShareStart,
  createShareSessionId,
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
    expect(first.length).toBeGreaterThan(8);
  });
});
