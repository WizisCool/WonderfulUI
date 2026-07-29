import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface Capability {
  permissions: Array<string | { identifier: string; allow?: unknown[] }>;
}

interface TauriConfig {
  app: {
    security: {
      csp: Record<string, string[]> | null;
      devCsp?: Record<string, string[]> | null;
      assetProtocol: { enable: boolean; scope: string[] };
    };
  };
}

const repoRoot = join(import.meta.dir, '..', '..', '..');
const tauriConfig = JSON.parse(
  readFileSync(join(repoRoot, 'src-tauri', 'tauri.conf.json'), 'utf8'),
) as TauriConfig;
const capability = JSON.parse(
  readFileSync(join(repoRoot, 'src-tauri', 'capabilities', 'default.json'), 'utf8'),
) as Capability;

describe('Tauri security boundaries', () => {
  test('ships a restrictive production CSP while leaving Vite dev explicit', () => {
    const csp = tauriConfig.app.security.csp;
    expect(csp).not.toBeNull();
    expect(csp?.['default-src']).toEqual(["'self'"]);
    expect(csp?.['script-src']).toEqual(["'self'"]);
    expect(csp?.['connect-src']).toEqual(["'self'", 'ipc:', 'http://ipc.localhost']);
    expect(csp?.['media-src']).toEqual([
      "'self'",
      'asset:',
      'http://asset.localhost',
      'blob:',
    ]);
    expect(csp?.['object-src']).toEqual(["'none'"]);
    expect(csp?.['base-uri']).toEqual(["'none'"]);
    expect(csp?.['form-action']).toEqual(["'none'"]);
    expect(csp?.['frame-ancestors']).toEqual(["'none'"]);
    expect(JSON.stringify(csp)).not.toContain('https:');
    expect(JSON.stringify(csp)).not.toContain('*');
    expect(tauriConfig.app.security.devCsp).toBeNull();
  });

  test('does not grant the asset protocol blanket file-system access', () => {
    const scope = tauriConfig.app.security.assetProtocol.scope;
    expect(tauriConfig.app.security.assetProtocol.enable).toBe(true);
    expect(scope).toEqual(['$LOCALDATA/wonderful-ui/assets/**']);
    expect(scope).not.toContain('**');
  });

  test('lets Save As scope one output file without global read access', () => {
    const identifiers = capability.permissions.map(permission =>
      typeof permission === 'string' ? permission : permission.identifier
    );
    expect(identifiers).toContain('dialog:allow-save');
    expect(identifiers).toContain('fs:allow-write-file');
    expect(identifiers).not.toContain('fs:allow-read-file');
    expect(identifiers).not.toContain('fs:scope');
  });
});
