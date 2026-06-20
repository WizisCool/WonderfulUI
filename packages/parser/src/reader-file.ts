/**
 * File-IO entry for the parser. Bun/Node only — uses Bun.file and node:path.
 * Kept separate from `reader.ts` so the browser/WebView bundle can import
 * the pure parser without pulling in Node built-ins.
 */

import { basename, dirname, join } from 'node:path';
import { parseSnapshotDbBuffer, parseWonderfulDbBuffer } from './reader.ts';
import type { AccountSnapshot, WonderfulDbFile } from './model.ts';

/**
 * Read a WonderfulDb file from disk. The openid is the file name without
 * its directory (ACLOS uses the openid as the file name with no extension).
 */
export async function readWonderfulDbFile(path: string): Promise<WonderfulDbFile> {
  const openid = basename(path);
  const text = await Bun.file(path).text();
  const buf = new TextEncoder().encode(text);
  return parseWonderfulDbBuffer(buf, openid);
}

/**
 * Read the per-account `snapshot<openid>` file. It sits next to the
 * wonderful-list file in the same WonderfulDb directory, so callers can
 * pass either the wonderful-list path or just the directory + openid.
 *
 * Returns `{ nick: undefined, tag: undefined }` (never throws) when the
 * file is missing or has no records — matches `parseSnapshotDbBuffer`.
 */
export async function readSnapshotDbFile(wonderfulListPath: string): Promise<AccountSnapshot> {
  const openid = basename(wonderfulListPath);
  const dir = dirname(wonderfulListPath);
  const snapshotPath = join(dir, `snapshot${openid}`);
  const file = Bun.file(snapshotPath);
  if (!(await file.exists())) return {};
  const text = await file.text();
  const buf = new TextEncoder().encode(text);
  return parseSnapshotDbBuffer(buf, openid);
}
