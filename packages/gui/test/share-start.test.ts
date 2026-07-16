import { describe, expect, test } from 'bun:test';
import { canBeginShareStart, shouldCommitShareStart } from '../src/utils/share-start.ts';

describe('share start guards', () => {
  test('canBeginShareStart blocks only while starting', () => {
    expect(canBeginShareStart('idle')).toBe(true);
    expect(canBeginShareStart('running')).toBe(true);
    expect(canBeginShareStart('error')).toBe(true);
    expect(canBeginShareStart('starting')).toBe(false);
  });

  test('shouldCommitShareStart only while still starting after await', () => {
    expect(shouldCommitShareStart('starting')).toBe(true);
    expect(shouldCommitShareStart('idle')).toBe(false);
    expect(shouldCommitShareStart('running')).toBe(false);
    expect(shouldCommitShareStart('error')).toBe(false);
  });
});
