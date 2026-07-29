import { readdir, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  VALORANT_AGENTS,
  VALORANT_GAME_MODES,
  VALORANT_MAPS,
} from '../packages/gui/src/utils/generated/valorant-metadata.zh-CN.ts';
import {
  VALORANT_ASSET_SPECS,
  compiledValorantAssetPath,
  type ValorantAssetKind,
} from './valorant-asset-config.ts';

interface AssetRecord {
  image: string;
  sourceSha256: string;
  kind: ValorantAssetKind;
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const useDist = process.argv.includes('--dist');
const sourceRoot = join(repoRoot, 'packages', 'gui', 'assets', 'valorant-source');
const assetRoot = join(repoRoot, 'packages', 'gui', useDist ? 'dist' : 'public');
const valorantRoot = join(assetRoot, 'valorant');
const records: AssetRecord[] = [
  ...VALORANT_AGENTS.map(record => ({ ...record, kind: 'agents' as const })),
  ...VALORANT_MAPS.map(record => ({ ...record, kind: 'maps' as const })),
  ...VALORANT_GAME_MODES.map(record => ({ ...record, kind: 'gamemodes' as const })),
];
const expectedSources = new Set<string>();
const expectedOutputs = new Set<string>();

for (const record of records) {
  if (!/^[a-f0-9]{64}$/.test(record.sourceSha256)) {
    throw new Error(`registry has invalid source SHA-256: ${record.sourceSha256}`);
  }
  const expectedImage = compiledValorantAssetPath(record.kind, record.sourceSha256);
  if (record.image !== expectedImage) {
    throw new Error(`registry image does not match its source: ${record.image}`);
  }

  const sourceKey = `${record.kind}/${record.sourceSha256}.png`;
  if (!expectedSources.has(sourceKey)) {
    await verifySource(join(sourceRoot, sourceKey), record.kind, record.sourceSha256);
    expectedSources.add(sourceKey);
  }

  const outputKey = record.image.slice('/valorant/'.length);
  if (!expectedOutputs.has(outputKey)) {
    await verifyOutput(resolveInside(valorantRoot, outputKey), record.kind);
    expectedOutputs.add(outputKey);
  }
}

await verifyExactFiles(sourceRoot, expectedSources, 'source PNG');
await verifyExactFiles(valorantRoot, expectedOutputs, 'compiled WebP');
await verifyNoDuplicateOutputContent(expectedOutputs);
await verifyNoExternalAutoLoads(useDist
  ? [join(assetRoot, 'index.html'), ...await listFilesByExtension(assetRoot, '.css')]
  : [
      join(repoRoot, 'packages', 'gui', 'index.html'),
      ...await listFilesByExtension(join(repoRoot, 'packages', 'gui', 'src'), '.css'),
    ]);

console.log(
  `Verified ${expectedSources.size} deduplicated source PNGs and ${expectedOutputs.size} `
  + `compiled WebP assets for ${records.length} Valorant records in ${relative(repoRoot, assetRoot)}`,
);

async function verifySource(
  path: string,
  kind: ValorantAssetKind,
  expectedHash: string,
): Promise<void> {
  const bytes = new Uint8Array(await readFile(path));
  if (!isPng(bytes)) throw new Error(`source asset is not PNG: ${relative(repoRoot, path)}`);
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== expectedHash) {
    throw new Error(`source checksum mismatch: ${relative(repoRoot, path)}`);
  }

  const metadata = await sharp(bytes, { failOn: 'error' }).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const spec = VALORANT_ASSET_SPECS[kind];
  if (metadata.format !== 'png' || width < spec.width || height < spec.height) {
    throw new Error(
      `${relative(repoRoot, path)} source dimensions ${width}x${height} are below `
      + `${spec.width}x${spec.height}`,
    );
  }
  const expectedRatio = spec.width / spec.height;
  if (Math.abs((width / height) - expectedRatio) > 0.01) {
    throw new Error(
      `${relative(repoRoot, path)} has wrong ${kind} aspect ratio ${width}x${height}; `
      + `expected ${spec.width}:${spec.height}`,
    );
  }
}

async function verifyOutput(path: string, kind: ValorantAssetKind): Promise<void> {
  const spec = VALORANT_ASSET_SPECS[kind];
  const metadata = await sharp(path, { failOn: 'error' }).metadata();
  if (metadata.format !== 'webp' || metadata.width !== spec.width || metadata.height !== spec.height) {
    throw new Error(
      `${relative(repoRoot, path)} must be ${spec.width}x${spec.height} WebP; `
      + `got ${metadata.width ?? 0}x${metadata.height ?? 0} ${metadata.format ?? 'unknown'}`,
    );
  }
  const info = await stat(path);
  if (info.size === 0 || info.size > spec.maxOutputBytes) {
    throw new Error(
      `${relative(repoRoot, path)} has invalid compiled size ${info.size}; max ${spec.maxOutputBytes}`,
    );
  }
}

async function verifyExactFiles(
  root: string,
  expected: Set<string>,
  label: string,
): Promise<void> {
  const actual = new Set(await listFiles(root));
  const missing = [...expected].filter(path => !actual.has(path));
  const extra = [...actual].filter(path => !expected.has(path));
  if (missing.length || extra.length) {
    throw new Error(
      `${label} set differs from registry; missing=${missing.join(',') || '-'} `
      + `extra=${extra.join(',') || '-'}`,
    );
  }
}

async function verifyNoDuplicateOutputContent(expected: Set<string>): Promise<void> {
  const pathByHash = new Map<string, string>();
  for (const key of expected) {
    const path = resolveInside(valorantRoot, key);
    const hash = createHash('sha256').update(await readFile(path)).digest('hex');
    const duplicate = pathByHash.get(hash);
    if (duplicate) {
      throw new Error(`duplicate compiled asset content: ${duplicate} and ${key}`);
    }
    pathByHash.set(hash, key);
  }
}

async function listFiles(directory: string, prefix = ''): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const key = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...await listFiles(join(directory, entry.name), key));
    else if (entry.isFile()) out.push(key);
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

function resolveInside(root: string, key: string): string {
  const path = resolve(root, key);
  const safeRoot = `${resolve(root)}${sep}`;
  if (!path.startsWith(safeRoot)) throw new Error(`asset escapes expected root: ${key}`);
  return path;
}

function isPng(bytes: Uint8Array): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return signature.every((value, index) => bytes[index] === value);
}
