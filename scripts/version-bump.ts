#!/usr/bin/env bun
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const bumpType: 'patch' | 'minor' | 'major' = (process.argv[2] as any) ?? 'patch';

function readJson(path: string) {
  return JSON.parse(readFileSync(path, 'utf8'));
}
function writeJson(path: string, obj: any) {
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

// 1. read current version from tauri.conf.json
const tauriConfPath = join(ROOT, 'src-tauri', 'tauri.conf.json');
const tauriConf = readJson(tauriConfPath);
const current = tauriConf.version;
const [major, minor, patch] = current.split('.').map(Number);

let next: string;
if (bumpType === 'major') {
  next = `${major + 1}.0.0`;
} else if (bumpType === 'minor') {
  next = `${major}.${minor + 1}.0`;
} else {
  next = `${major}.${minor}.${patch + 1}`;
}

// 2. update tauri.conf.json
tauriConf.version = next;
writeJson(tauriConfPath, tauriConf);
console.log(`  tauri.conf.json  ${current} -> ${next}`);

// 3. update root Cargo.toml
const cargoPath = join(ROOT, 'src-tauri', 'Cargo.toml');
let cargoText = readFileSync(cargoPath, 'utf8');
cargoText = cargoText.replace(
  /^version\s*=\s*"[^"]+"/m,
  `version = "${next}"`,
);
writeFileSync(cargoPath, cargoText);
console.log(`  src-tauri/Cargo.toml  ${current} -> ${next}`);

// 4. update root package.json
const pkgPath = join(ROOT, 'package.json');
const pkg = readJson(pkgPath);
pkg.version = next;
writeJson(pkgPath, pkg);
console.log(`  package.json  ${current} -> ${next}`);

// 5. update packages/parser/package.json
const parserPkgPath = join(ROOT, 'packages', 'parser', 'package.json');
if (existsSync(parserPkgPath)) {
  const parserPkg = readJson(parserPkgPath);
  parserPkg.version = next;
  writeJson(parserPkgPath, parserPkg);
  console.log(`  packages/parser/package.json  ${current} -> ${next}`);
}

// 6. update packages/gui/package.json
const guiPkgPath = join(ROOT, 'packages', 'gui', 'package.json');
if (existsSync(guiPkgPath)) {
  const guiPkg = readJson(guiPkgPath);
  guiPkg.version = next;
  writeJson(guiPkgPath, guiPkg);
  console.log(`  packages/gui/package.json  ${current} -> ${next}`);
}

// 7. update packages/parser/cli.ts VERSION constant
const cliPath = join(ROOT, 'packages', 'parser', 'cli.ts');
if (existsSync(cliPath)) {
  let cliText = readFileSync(cliPath, 'utf8');
  cliText = cliText.replace(
    /const VERSION = ['"][^'"]+['"];/,
    `const VERSION = '${next}';`,
  );
  writeFileSync(cliPath, cliText);
  console.log(`  packages/parser/cli.ts VERSION  ${current} -> ${next}`);
}

// 8. update packages/gui/src/utils/version.ts APP_VERSION constant
const versionTsPath = join(ROOT, 'packages', 'gui', 'src', 'utils', 'version.ts');
if (existsSync(versionTsPath)) {
  let versionTsText = readFileSync(versionTsPath, 'utf8');
  versionTsText = versionTsText.replace(
    /const APP_VERSION = ['"][^'"]+['"];/,
    `const APP_VERSION = '${next}';`,
  );
  writeFileSync(versionTsPath, versionTsText);
  console.log(`  packages/gui/src/utils/version.ts APP_VERSION  ${current} -> ${next}`);
}

// 9. update versions.json if it exists (moved from step 8)
const versionsJsonPath = join(ROOT, 'versions.json');
if (existsSync(versionsJsonPath)) {
  const versions = readJson(versionsJsonPath);
  versions.current = next;
  if (!versions.releases) versions.releases = {};
  versions.releases[`v${next}`] = {
    tag: `v${next}`,
    date: new Date().toISOString().slice(0, 10),
    notes: '',
    min_supported_version: '0.1.0',
    assets: { 'windows-x86_64': { url: '', signature: '' } },
  };
  writeJson(versionsJsonPath, versions);
  console.log(`  versions.json  ${current} -> ${next}`);
}

// 10. git commit + tag
execSync('git add -A', { cwd: ROOT, stdio: 'inherit' });
execSync(`git commit -m "chore(release): v${next}"`, { cwd: ROOT, stdio: 'inherit' });
execSync(`git tag v${next}`, { cwd: ROOT, stdio: 'inherit' });

// 11. git push — CI release workflow (release.yml) auto-builds, creates
//     release with generate_release_notes, and attaches MSI/NSIS artifacts.
console.log('  pushing to remote (CI will build & release)...');
execSync('git push origin main', { cwd: ROOT, stdio: 'inherit' });
execSync(`git push origin v${next}`, { cwd: ROOT, stdio: 'inherit' });

console.log(`\n✔ Bumped to v${next}, pushed. CI will build and release.`);
