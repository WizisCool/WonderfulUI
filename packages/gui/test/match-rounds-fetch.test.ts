import { describe, expect, test } from 'bun:test';
import { shouldCommitMatchRounds } from '../src/utils/match-rounds-fetch.ts';

describe('shouldCommitMatchRounds', () => {
  test('allows commit when selection is still the requested match', () => {
    expect(shouldCommitMatchRounds('m1', 'm1', 3, 3)).toBe(true);
  });

  test('rejects stale response after selection changed', () => {
    expect(shouldCommitMatchRounds('m1', 'm2', 3, 3)).toBe(false);
  });

  test('rejects when nothing is selected', () => {
    expect(shouldCommitMatchRounds('m1', null, 3, 3)).toBe(false);
    expect(shouldCommitMatchRounds('m1', undefined, 3, 3)).toBe(false);
  });

  test('rejects a response from an earlier selection of the same match id', () => {
    expect(shouldCommitMatchRounds('m1', 'm1', 3, 5)).toBe(false);
  });
});
