import { describe, expect, test } from 'bun:test';
import { releaseTagMismatch } from './version-invariants.ts';

describe('releaseTagMismatch', () => {
  test('accepts the tag derived from the canonical version', () => {
    expect(releaseTagMismatch('1.2.3', 'tag', 'v1.2.3')).toBeUndefined();
  });

  test('rejects a tag that would publish a mismatched updater URL', () => {
    expect(releaseTagMismatch('1.2.3', 'tag', 'v1.2.2')).toBe(
      'release tag must be v1.2.3, got v1.2.2',
    );
  });

  test('does not impose a tag on local, branch, or manual checks', () => {
    expect(releaseTagMismatch('1.2.3', undefined, undefined)).toBeUndefined();
    expect(releaseTagMismatch('1.2.3', 'branch', 'main')).toBeUndefined();
  });
});
