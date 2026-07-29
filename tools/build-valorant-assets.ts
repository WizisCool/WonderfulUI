import { mkdir, readdir, rename, stat, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
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

interface SourceRecord {
  image: string;
  sourceSha256: string;
}

interface BuildRecord extends SourceRecord {
  kind: ValorantAssetKind;
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = join(repoRoot, 'packages', 'gui', 'assets', 'valorant-source');
const publicRoot = join(repoRoot, 'packages', 'gui', 'public');
const outputRoot = join(publicRoot, 'valorant');
const records: BuildRecord[] = [
  ...VALORANT_AGENTS.map(record => ({ ...record, kind: 'agents' as const })),
  ...VALORANT_MAPS.map(record => ({ ...record, kind: 'maps' as const })),
  ...VALORANT_GAME_MODES.map(record => ({ ...record, kind: 'gamemodes' as const })),
];

const unique = new Map<string, BuildRecord>();
for (const record of records) {
  const expectedPath = compiledValorantAssetPath(record.kind, record.sourceSha256);
  if (record.image !== expectedPath) {
    throw new Error(`registry output path is stale: ${record.image}; expected ${expectedPath}`);
  }
  unique.set(`${record.kind}/${record.sourceSha256}`, record);
}

let nextIndex = 0;
let outputBytes = 0;
const buildRecords = [...unique.values()];
const workers = Array.from(
  { length: Math.min(4, buildRecords.length) },
  async () => {
    while (nextIndex < buildRecords.length) {
      const record = buildRecords[nextIndex++]!;
      const bytes = await compileAsset(record);
      outputBytes += bytes;
    }
  },
);
await Promise.all(workers);
await removeStaleOutputs();

console.log(
  `Built ${buildRecords.length} unique WebP assets for ${records.length} Valorant records `
  + `(${formatBytes(outputBytes)})`,
);

async function compileAsset(record: BuildRecord): Promise<number> {
  const source = join(sourceRoot, record.kind, `${record.sourceSha256}.png`);
  const output = join(publicRoot, record.image.slice(1));
  const spec = VALORANT_ASSET_SPECS[record.kind];
  await mkdir(dirname(output), { recursive: true });

  const temporary = `${output}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await sharp(source, { failOn: 'error', limitInputPixels: 64 * 1024 * 1024 })
      .resize(spec.width, spec.height, {
        fit: 'cover',
        position: 'centre',
      })
      .webp({
        quality: spec.quality,
        alphaQuality: 100,
        effort: 4,
        smartSubsample: true,
      })
      .toFile(temporary);
    await removeIfPresent(output);
    await rename(temporary, output);
  } catch (error) {
    await removeIfPresent(temporary);
    throw new Error(`failed to compile ${relative(repoRoot, source)}: ${String(error)}`, { cause: error });
  }

  const info = await stat(output);
  if (info.size === 0 || info.size > spec.maxOutputBytes) {
    throw new Error(
      `${relative(repoRoot, output)} has invalid compiled size ${info.size}; max ${spec.maxOutputBytes}`,
    );
  }
  return info.size;
}

async function removeStaleOutputs(): Promise<void> {
  const expected = new Set(records.map(record => record.image.slice('/valorant/'.length)));
  for (const kind of Object.keys(VALORANT_ASSET_SPECS) as ValorantAssetKind[]) {
    const directory = join(outputRoot, kind);
    await mkdir(directory, { recursive: true });
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const key = `${kind}/${entry.name}`;
      if (entry.isFile() && !expected.has(key)) {
        await unlink(join(directory, entry.name));
      }
    }
  }
}

async function removeIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}
