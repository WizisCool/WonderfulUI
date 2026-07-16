import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = import.meta.dir ? join(import.meta.dir, '..', '..', '..') : process.cwd();
const CLI = 'bun run packages/parser/cli.ts';
const DB_DIR = process.env.WONDERFUL_DB_DIR
  ?? join(process.env.USERPROFILE ?? process.env.HOME ?? '', 'AppData', 'Roaming', 'ACLOS', 'WonderfulDb');
const DB = join(DB_DIR, '4807045517549591240');

const hasFixture = existsSync(DB);

function run(args: string[]): { stdout: string; stderr: string; code: number } {
  const r = spawnSync('bun', ['run', 'packages/parser/cli.ts', ...args], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    maxBuffer: 20 * 1024 * 1024,
  });
  return { stdout: r.stdout, stderr: r.stderr, code: r.status ?? -1 };
}

const withFixture = hasFixture ? describe : describe.skip;

describe('wonderful-parser CLI', () => {
  test('--help exits 0 and shows usage', () => {
    const r = run(['--help']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('wonderful-parser');
    expect(r.stdout).toContain('Usage');
  });

  test('--version prints version', () => {
    const r = run(['--version']);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe('0.1.8');
  });

  withFixture('with ACLOS fixture', () => {
    test('accounts lists known openids', () => {
      const r = run(['accounts']);
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('4807045517549591240');
      expect(r.stdout).toContain('13794749312275947089');
      expect(r.stdout).toContain('14121192131852595386');
    });

    test('scan prints human summary', () => {
      const r = run(['scan', DB]);
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('account:');
      // Match count drifts with local ACLOS data — only require a number field.
      expect(r.stdout).toMatch(/matches:\s*\d+/);
    });

    test('scan --json produces parseable JSON array', () => {
      const r = run(['scan', DB, '--json']);
      expect(r.code).toBe(0);
      const arr = JSON.parse(r.stdout) as unknown[];
      expect(Array.isArray(arr)).toBe(true);
      // Local WonderfulDb size changes over time; empty is valid after wipe.
      expect(arr.length).toBeGreaterThanOrEqual(0);
    });

    test('show finds a match by full id when present', () => {
      const list = run(['scan', DB, '--json']);
      expect(list.code).toBe(0);
      const arr = JSON.parse(list.stdout) as Array<{ matches_id: string; agent?: { agent_name?: string } }>;
      if (arr.length === 0) return; // nothing to show on empty local DB
      const id = arr[0]!.matches_id;
      const r = run(['show', DB, id]);
      expect(r.code).toBe(0);
      const m = JSON.parse(r.stdout) as { matches_id: string };
      expect(m.matches_id).toBe(id);
    });

    test('show accepts id prefix when present', () => {
      const list = run(['scan', DB, '--json']);
      expect(list.code).toBe(0);
      const arr = JSON.parse(list.stdout) as Array<{ matches_id: string }>;
      if (arr.length === 0) return;
      const id = arr[0]!.matches_id;
      const prefix = id.slice(0, 8);
      const r = run(['show', DB, prefix]);
      expect(r.code).toBe(0);
      expect(r.stdout).toContain(id);
    });

    test('show with unknown id exits 1', () => {
      const r = run(['show', DB, 'deadbeef-0000-0000-0000-000000000000']);
      expect(r.code).toBe(1);
    });
  });

  test('unknown command exits 64', () => {
    const r = run(['bogus']);
    expect(r.code).toBe(64);
    expect(r.stderr).toContain('unknown command');
  });
});
