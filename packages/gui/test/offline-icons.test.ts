import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { phLocal } from '../src/icons/ph-local.ts';

describe('offline icon registry', () => {
  test('contains every locally referenced Phosphor icon', () => {
    const sourceRoot = join(import.meta.dir, '..', 'src');
    const missing: string[] = [];

    for (const pattern of ['**/*.vue', '**/*.ts']) {
      for (const file of new Bun.Glob(pattern).scanSync({ cwd: sourceRoot })) {
        const source = readFileSync(join(sourceRoot, file), 'utf8');
        for (const match of source.matchAll(/['"]ph:([a-z0-9-]+)['"]/g)) {
          const icon = match[1];
          if (icon && !phLocal.icons?.[icon]) {
            missing.push(`${relative(sourceRoot, join(sourceRoot, file))}: ph:${icon}`);
          }
        }
      }
    }

    expect(missing).toEqual([]);
  });
});
