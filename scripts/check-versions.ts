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

console.log(errors > 0 ? `\n✖ ${errors} mismatch(es) found.\n` : '\n✔ All versions match.\n');
process.exit(errors > 0 ? 1 : 0);
