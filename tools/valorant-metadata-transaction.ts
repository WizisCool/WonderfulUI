import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import type { ValorantAssetKind } from './valorant-asset-config.ts';

export interface MetadataAssetRecord {
  uuid: string;
  sourceImage: string;
}

export interface MetadataAssetGroup {
  kind: ValorantAssetKind;
  records: MetadataAssetRecord[];
}

export interface DownloadedPng {
  bytes: Uint8Array;
  hash: string;
}

export type MetadataHashes = ReadonlyMap<ValorantAssetKind, Map<string, string>>;

interface MetadataTransactionOptions {
  sourceRoot: string;
  metadataFile: string;
  groups: MetadataAssetGroup[];
  concurrency: number;
  download(url: string): Promise<DownloadedPng>;
  renderMetadata(hashes: MetadataHashes): string;
  writeMetadata?: (destination: string, body: string) => Promise<void>;
}

/**
 * Publish source PNGs and their generated registry as one recoverable update.
 *
 * All network/validation work is isolated in a temporary staging directory.
 * New content-addressed sources are published before metadata, while stale
 * sources are pruned only after metadata replacement succeeds. Therefore any
 * failure leaves every source referenced by the previous registry intact.
 */
export async function publishValorantMetadataTransaction(
  options: MetadataTransactionOptions,
): Promise<MetadataHashes> {
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
    throw new Error(`metadata download concurrency must be a positive integer`);
  }
  assertUniqueKinds(options.groups);
  await mkdir(options.sourceRoot, { recursive: true });
  const stagingRoot = await mkdtemp(join(options.sourceRoot, '.metadata-update-'));

  try {
    const stagedGroups = await Promise.all(options.groups.map(async group => ({
      kind: group.kind,
      hashes: await stageGroup(
        stagingRoot,
        group,
        options.concurrency,
        options.download,
      ),
    })));
    const hashes = new Map(
      stagedGroups.map(group => [group.kind, group.hashes] as const),
    );
    const metadataBody = options.renderMetadata(hashes);

    // Publishing new hash paths is additive: the old registry remains valid.
    for (const group of stagedGroups) {
      await publishStagedGroup(options.sourceRoot, stagingRoot, group.kind);
    }

    await (options.writeMetadata ?? writeFileAtomically)(
      options.metadataFile,
      metadataBody,
    );

    // Only the successfully-published registry is allowed to define staleness.
    for (const group of stagedGroups) {
      await prunePublishedGroup(options.sourceRoot, group.kind, new Set(group.hashes.values()));
    }
    return hashes;
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

async function stageGroup(
  stagingRoot: string,
  group: MetadataAssetGroup,
  concurrency: number,
  download: (url: string) => Promise<DownloadedPng>,
): Promise<Map<string, string>> {
  const directory = join(stagingRoot, group.kind);
  await mkdir(directory, { recursive: true });
  const hashes = new Map<string, string>();
  const pendingWrites = new Map<string, Promise<void>>();
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, group.records.length) },
    async () => {
      while (nextIndex < group.records.length) {
        const record = group.records[nextIndex++]!;
        const downloaded = await download(record.sourceImage);
        assertDownloadedHash(downloaded, record.sourceImage);
        let write = pendingWrites.get(downloaded.hash);
        if (!write) {
          write = writeFile(join(directory, `${downloaded.hash}.png`), downloaded.bytes);
          pendingWrites.set(downloaded.hash, write);
        }
        await write;
        hashes.set(record.uuid, downloaded.hash);
      }
    },
  );
  await Promise.all(workers);
  return hashes;
}

async function publishStagedGroup(
  sourceRoot: string,
  stagingRoot: string,
  kind: ValorantAssetKind,
): Promise<void> {
  const stagedDirectory = join(stagingRoot, kind);
  const destinationDirectory = join(sourceRoot, kind);
  await mkdir(destinationDirectory, { recursive: true });
  for (const entry of await readdir(stagedDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.png')) continue;
    const staged = join(stagedDirectory, entry.name);
    const destination = join(destinationDirectory, entry.name);
    const expectedHash = entry.name.slice(0, -4);
    try {
      const existing = await readFile(destination);
      if (sha256(existing) === expectedHash) {
        await unlink(staged);
        continue;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await rename(staged, destination);
  }
}

async function prunePublishedGroup(
  sourceRoot: string,
  kind: ValorantAssetKind,
  expected: Set<string>,
): Promise<void> {
  const directory = join(sourceRoot, kind);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const hash = entry.name.endsWith('.png') ? entry.name.slice(0, -4) : '';
    const stalePng = entry.name.endsWith('.png') && !expected.has(hash);
    const interruptedDownload = entry.name.endsWith('.download');
    if (stalePng || interruptedDownload) await unlink(join(directory, entry.name));
  }
}

export async function writeFileAtomically(destination: string, body: string): Promise<void> {
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, body);
    await rename(temporary, destination);
  } catch (error) {
    try {
      await unlink(temporary);
    } catch { /* best-effort temporary-file cleanup */ }
    throw error;
  }
}

function assertDownloadedHash(downloaded: DownloadedPng, source: string): void {
  if (!/^[a-f0-9]{64}$/.test(downloaded.hash)) {
    throw new Error(`invalid downloaded SHA-256 for ${source}`);
  }
  const actual = sha256(downloaded.bytes);
  if (actual !== downloaded.hash) {
    throw new Error(`downloaded SHA-256 mismatch for ${source}`);
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertUniqueKinds(groups: MetadataAssetGroup[]): void {
  const seen = new Set<ValorantAssetKind>();
  for (const group of groups) {
    if (seen.has(group.kind)) throw new Error(`duplicate metadata asset group: ${group.kind}`);
    seen.add(group.kind);
  }
}
