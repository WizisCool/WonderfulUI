import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  VALORANT_AGENTS,
  VALORANT_GAME_MODES,
  VALORANT_MAPS,
} from '../packages/gui/src/utils/generated/valorant-metadata.zh-CN.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const useDist = process.argv.includes('--dist');
const assetRoot = join(repoRoot, 'packages', 'gui', useDist ? 'dist' : 'public');
const valorantRoot = join(assetRoot, 'valorant');
const records = [...VALORANT_AGENTS, ...VALORANT_MAPS, ...VALORANT_GAME_MODES];
const expected = new Set<string>();

for (const record of records) {
  if (!record.image.startsWith('/valorant/') || !record.image.endsWith('.png')) {
    throw new Error(`registry image must be a bundled PNG path: ${record.image}`);
  }
  const path = resolve(assetRoot, record.image.slice(1));
  const safeRoot = `${resolve(valorantRoot)}${sep}`;
  if (!path.startsWith(safeRoot)) throw new Error(`asset escapes valorant root: ${record.image}`);
  const bytes = new Uint8Array(await readFile(path));
  if (!isPng(bytes)) throw new Error(`asset is not a PNG: ${relative(repoRoot, path)}`);
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== record.sha256) {
    throw new Error(`asset checksum mismatch: ${relative(repoRoot, path)}`);
  }
  const key = relative(valorantRoot, path).replace(/\\/g, '/');
  if (expected.has(key)) throw new Error(`duplicate bundled asset path: ${record.image}`);
  expected.add(key);
}

const actual = new Set(await listPngFiles(valorantRoot));
const missing = [...expected].filter(path => !actual.has(path));
const extra = [...actual].filter(path => !expected.has(path));
if (missing.length || extra.length) {
  throw new Error(
    `bundled Valorant assets differ from registry; missing=${missing.join(',') || '-'} extra=${extra.join(',') || '-'}`,
  );
}

await verifyNoExternalAutoLoads(useDist
  ? [join(assetRoot, 'index.html'), ...await listFilesByExtension(assetRoot, '.css')]
  : [
      join(repoRoot, 'packages', 'gui', 'index.html'),
      ...await listFilesByExtension(join(repoRoot, 'packages', 'gui', 'src'), '.css'),
    ]);

console.log(
  `Verified ${expected.size} bundled Valorant PNG assets and offline resource references in ${relative(repoRoot, assetRoot)}`,
);

async function listPngFiles(directory: string, prefix = ''): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const key = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...await listPngFiles(join(directory, entry.name), key));
    else if (entry.isFile() && entry.name.endsWith('.png')) out.push(key);
  }
  return out;
}

async function listFilesByExtension(directory: string, extension: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) out.push(...await listFilesByExtension(path, extension));
    else if (entry.isFile() && entry.name.endsWith(extension)) out.push(path);
  }
  return out;
}

async function verifyNoExternalAutoLoads(paths: string[]): Promise<void> {
  const externalCssImport = /@import\s+(?:url\()?\s*['"]?https?:\/\//i;
  const externalHtmlResource = /<(?:script|link|img|source|video|audio)\b[^>]*(?:src|href)\s*=\s*['"]https?:\/\//i;
  for (const path of paths) {
    const source = await readFile(path, 'utf8');
    if (externalCssImport.test(source) || externalHtmlResource.test(source)) {
      throw new Error(`runtime resource must be bundled instead of remotely loaded: ${relative(repoRoot, path)}`);
    }
  }
}

function isPng(bytes: Uint8Array): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return signature.every((value, index) => bytes[index] === value);
}
