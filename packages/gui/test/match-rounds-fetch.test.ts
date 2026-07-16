import { describe, expect, test } from 'bun:test';
import { shouldCommitMatchRounds } from '../src/utils/match-rounds-fetch.ts';

describe('shouldCommitMatchRounds', () => {
  test('allows commit when selection is still the requested match', () => {
    expect(shouldCommitMatchRounds('m1', 'm1')).toBe(true);
  });

  test('rejects stale response after selection changed', () => {
    expect(shouldCommitMatchRounds('m1', 'm2')).toBe(false);
  });

  test('rejects when nothing is selected', () => {
    expect(shouldCommitMatchRounds('m1', null)).toBe(false);
    expect(shouldCommitMatchRounds('m1', undefined)).toBe(false);
  });
});
