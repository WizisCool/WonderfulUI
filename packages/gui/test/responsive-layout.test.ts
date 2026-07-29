import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const style = readFileSync(
  join(import.meta.dir, '..', 'src', 'assets', 'style.css'),
  'utf8',
);

describe('minimum-window pane layout', () => {
  test('gives filter results the detail pane space at narrow widths', () => {
    expect(style).toMatch(/@media \(max-width: 1160px\)/);
    expect(style).toMatch(/\.app\.is-filter-open\s+\.pane\.list\s*{\s*grid-column:\s*3\s*\/\s*-1/);
    expect(style).toMatch(/\.app\.is-filter-open\s+\.pane\.detail\s*{\s*display:\s*none/);
  });
});
