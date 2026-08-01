import { afterEach, describe, expect, test } from 'bun:test';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  publishValorantMetadataTransaction,
  type DownloadedPng,
} from './valorant-metadata-transaction.ts';

const cleanupRoots: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupRoots.splice(0).map(path => rm(path, {
    recursive: true,
    force: true,
  })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'wui-metadata-transaction-'));
  cleanupRoots.push(root);
  const sourceRoot = join(root, 'source');
  const metadataFile = join(root, 'generated', 'metadata.ts');
  const oldAgent = pngResult('old-agent');
  const oldMap = pngResult('old-map');
  await mkdir(join(sourceRoot, 'agents'), { recursive: true });
  await mkdir(join(sourceRoot, 'maps'), { recursive: true });
  await mkdir(join(root, 'generated'), { recursive: true });
  await writeFile(join(sourceRoot, 'agents', `${oldAgent.hash}.png`), oldAgent.bytes);
  await writeFile(join(sourceRoot, 'maps', `${oldMap.hash}.png`), oldMap.bytes);
  await writeFile(metadataFile, 'old metadata');
  return { root, sourceRoot, metadataFile, oldAgent, oldMap };
}

function pngResult(value: string): DownloadedPng {
  const bytes = new TextEncoder().encode(value);
  return {
    bytes,
    hash: createHash('sha256').update(bytes).digest('hex'),
  };
}

async function names(path: string): Promise<string[]> {
  return (await readdir(path)).sort();
}

describe('publishValorantMetadataTransaction', () => {
  test('a later group download failure leaves old metadata and sources untouched', async () => {
    const value = await fixture();
    await expect(publishValorantMetadataTransaction({
      sourceRoot: value.sourceRoot,
      metadataFile: value.metadataFile,
      concurrency: 2,
      groups: [
        { kind: 'agents', records: [{ uuid: 'agent-new', sourceImage: 'agent-new' }] },
        { kind: 'maps', records: [{ uuid: 'map-new', sourceImage: 'map-fail' }] },
      ],
      async download(url) {
        if (url === 'map-fail') throw new Error('simulated map download failure');
        return pngResult(url);
      },
      renderMetadata: () => 'new metadata',
    })).rejects.toThrow('simulated map download failure');

    expect(await readFile(value.metadataFile, 'utf8')).toBe('old metadata');
    expect(await names(join(value.sourceRoot, 'agents'))).toEqual([`${value.oldAgent.hash}.png`]);
    expect(await names(join(value.sourceRoot, 'maps'))).toEqual([`${value.oldMap.hash}.png`]);
    expect((await names(value.sourceRoot)).some(name => name.startsWith('.metadata-update-'))).toBe(false);
  });

  test('a metadata publish failure never prunes sources used by the old registry', async () => {
    const value = await fixture();
    await expect(publishValorantMetadataTransaction({
      sourceRoot: value.sourceRoot,
      metadataFile: value.metadataFile,
      concurrency: 1,
      groups: [{
        kind: 'agents',
        records: [{ uuid: 'agent-new', sourceImage: 'agent-new' }],
      }],
      download: async url => pngResult(url),
      renderMetadata: () => 'new metadata',
      async writeMetadata() {
        expect(await readFile(
          join(value.sourceRoot, 'agents', `${value.oldAgent.hash}.png`),
        )).toEqual(Buffer.from(value.oldAgent.bytes));
        throw new Error('simulated metadata publish failure');
      },
    })).rejects.toThrow('simulated metadata publish failure');

    expect(await readFile(value.metadataFile, 'utf8')).toBe('old metadata');
    expect(await names(join(value.sourceRoot, 'agents'))).toContain(`${value.oldAgent.hash}.png`);
  });

  test('publishes metadata before pruning and keeps one file for duplicate bytes', async () => {
    const value = await fixture();
    const sharedAgent = pngResult('shared-agent');
    const newMap = pngResult('new-map');
    await writeFile(join(value.sourceRoot, 'agents', 'interrupted.download'), 'partial');

    const hashes = await publishValorantMetadataTransaction({
      sourceRoot: value.sourceRoot,
      metadataFile: value.metadataFile,
      concurrency: 2,
      groups: [
        {
          kind: 'agents',
          records: [
            { uuid: 'agent-a', sourceImage: 'shared-agent' },
            { uuid: 'agent-b', sourceImage: 'shared-agent' },
          ],
        },
        { kind: 'maps', records: [{ uuid: 'map-new', sourceImage: 'new-map' }] },
      ],
      async download(url) {
        return url === 'shared-agent' ? sharedAgent : newMap;
      },
      renderMetadata(staged) {
        expect(staged.get('agents')?.get('agent-a')).toBe(sharedAgent.hash);
        expect(staged.get('agents')?.get('agent-b')).toBe(sharedAgent.hash);
        return 'new metadata';
      },
      async writeMetadata(destination, body) {
        // Stale sources still exist until the registry has been published.
        expect(await names(join(value.sourceRoot, 'agents'))).toContain(`${value.oldAgent.hash}.png`);
        await writeFile(destination, body);
      },
    });

    expect(hashes.get('agents')?.get('agent-a')).toBe(hashes.get('agents')?.get('agent-b'));
    expect(await readFile(value.metadataFile, 'utf8')).toBe('new metadata');
    expect(await names(join(value.sourceRoot, 'agents'))).toEqual([`${sharedAgent.hash}.png`]);
    expect(await names(join(value.sourceRoot, 'maps'))).toEqual([`${newMap.hash}.png`]);
  });
});
