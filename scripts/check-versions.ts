#!/usr/bin/env bun
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
let errors = 0;

function readJson(path: string) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function check(label: string, actual: string, expected: string) {
  if (actual !== expected) {
    console.error(`  FAIL ${label}: expected "${expected}", got "${actual}"`);
    errors++;
  } else {
    console.log(`  OK   ${label}`);
  }
}

const tauriConf = readJson(join(ROOT, 'src-tauri', 'tauri.conf.json'));
const expected = tauriConf.version;
console.log(`\nCanonical version (tauri.conf.json): ${expected}\n`);

// tauri.conf.json
check('tauri.conf.json', expected, expected);

// Cargo.toml
const cargoText = readFileSync(join(ROOT, 'src-tauri', 'Cargo.toml'), 'utf8');
const cargoVer = cargoText.match(/^version\s*=\s*"([^"]+)"/m)?.[1] ?? '';
check('src-tauri/Cargo.toml', cargoVer, expected);

// root package.json
const pkg = readJson(join(ROOT, 'package.json'));
check('package.json', pkg.version, expected);

// parser package.json
const parserPkg = readJson(join(ROOT, 'packages', 'parser', 'package.json'));
check('packages/parser/package.json', parserPkg.version, expected);

// gui package.json
const guiPkg = readJson(join(ROOT, 'packages', 'gui', 'package.json'));
check('packages/gui/package.json', guiPkg.version, expected);

// parser cli.ts
const cliText = readFileSync(join(ROOT, 'packages', 'parser', 'cli.ts'), 'utf8');
const cliVer = cliText.match(/const VERSION\s*=\s*['"]([^'"]+)['"]/)?.[1] ?? '';
check('packages/parser/cli.ts VERSION', cliVer, expected);

// gui version.ts
const versionTs = readFileSync(join(ROOT, 'packages', 'gui', 'src', 'utils', 'version.ts'), 'utf8');
const appVer = versionTs.match(/const APP_VERSION\s*=\s*['"]([^'"]+)['"]/)?.[1] ?? '';
check('packages/gui/src/utils/version.ts APP_VERSION', appVer, expected);

// versions.json
const versionsJson = readJson(join(ROOT, 'versions.json'));
check('versions.json current', versionsJson.current, expected);

// cli test hardcoded version
const cliTest = readFileSync(join(ROOT, 'packages', 'parser', 'tests', 'cli.test.ts'), 'utf8');
const testVer = cliTest.match(/expect\(r\.stdout\.trim\(\)\)\.toBe\('([\d.]+)'\)/)?.[1] ?? '';
check('packages/parser/tests/cli.test.ts', testVer, expected);

// --- Updater production safety (docs/UPDATER.md) ---
// Guard against accidental localhost / insecure endpoints shipping in release.
console.log('\nUpdater config:');
const updater = tauriConf.plugins?.updater ?? {};
const endpoints: string[] = Array.isArray(updater.endpoints) ? updater.endpoints : [];
const expectedEndpoint =
  'https://github.com/WizisCool/WonderfulUI/releases/latest/download/latest.json';
if (endpoints.length === 0) {
  console.error('  FAIL plugins.updater.endpoints: empty');
  errors++;
} else if (!endpoints.includes(expectedEndpoint)) {
  console.error(
    `  FAIL plugins.updater.endpoints: must include production URL\n` +
      `       expected to contain: ${expectedEndpoint}\n` +
      `       got: ${JSON.stringify(endpoints)}`,
  );
  errors++;
} else {
  console.log('  OK   plugins.updater.endpoints (production latest.json)');
}
for (const ep of endpoints) {
  if (ep.startsWith('http://') || /localhost|127\.0\.0\.1/i.test(ep)) {
    console.error(
      `  FAIL plugins.updater.endpoints: insecure or localhost endpoint not allowed in committed config: ${ep}`,
    );
    errors++;
  }
}
if (updater.dangerousInsecureTransportProtocol === true) {
  console.error(
    '  FAIL plugins.updater.dangerousInsecureTransportProtocol must not be true in committed config',
  );
  errors++;
} else {
  console.log('  OK   dangerousInsecureTransportProtocol unset/false');
}
const pubkey = typeof updater.pubkey === 'string' ? updater.pubkey.trim() : '';
if (!pubkey) {
  console.error('  FAIL plugins.updater.pubkey: empty');
  errors++;
} else {
  console.log('  OK   plugins.updater.pubkey non-empty');
}
if (tauriConf.bundle?.createUpdaterArtifacts !== true) {
  console.error('  FAIL bundle.createUpdaterArtifacts must be true');
  errors++;
} else {
  console.log('  OK   bundle.createUpdaterArtifacts');
}

// versions.json current release entry should exist (notes may be empty but warn)
const releaseKey = `v${expected}`;
const releaseEntry = versionsJson.releases?.[releaseKey];
if (!releaseEntry) {
  console.error(`  FAIL versions.json.releases["${releaseKey}"] missing`);
  errors++;
} else {
  console.log(`  OK   versions.json.releases["${releaseKey}"] present`);
  if (!String(releaseEntry.notes ?? '').trim()) {
    console.log(
      `  WARN versions.json.releases["${releaseKey}"].notes is empty — ` +
        `latest.json will fall back to git log / generic title`,
    );
  }
}

console.log(errors > 0 ? `\n✖ ${errors} mismatch(es) found.\n` : '\n✔ All versions match.\n');
process.exit(errors > 0 ? 1 : 0);
