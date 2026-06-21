#!/usr/bin/env bun
/**
 * CLI for ACLOS WonderfulDb parser.
 *
 * Usage:
 *   wonderful-parser accounts                                list all openids in default folder
 *   wonderful-parser scan <path-to-db> [--json]             list all matches
 *   wonderful-parser scan-all [--json] [--dir <path>]       scan every account, return flat array
 *   wonderful-parser show  <path-to-db> <match-id> [--json] show one match
 *   wonderful-parser --help
 *   wonderful-parser --version
 *
 * Exit codes: 0 ok, 1 file/path error, 2 parse error, 64 usage error.
 */

import { readdirSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { readSnapshotDbFile, readWonderfulDbFile } from './src/reader-file.ts';
import { WonderfulDbError, type MatchRecord } from './src/index.ts';

const VERSION = '0.1.2';
const DEFAULT_WONDERFUL_DIR = join(process.env.USERPROFILE ?? process.env.HOME ?? '', 'AppData', 'Roaming', 'ACLOS', 'WonderfulDb');

function die(msg: string, code = 1): never {
  console.error(`wonderful-parser: ${msg}`);
  process.exit(code);
}

function usage(): never {
  console.log(`wonderful-parser ${VERSION}

Usage:
  wonderful-parser accounts                                list all openids in default folder
  wonderful-parser scan <path-to-db> [--json]             list all matches
  wonderful-parser scan-all [<dir-override>] [--json]     scan every account, return flat array
  wonderful-parser show  <path-to-db> <match-id> [--json] show one match

Default WonderfulDb folder:
  ${DEFAULT_WONDERFUL_DIR}

Options:
  --json      output as JSON
  --help, -h  show this help
  --version   show version`);
  process.exit(0);
}

interface Args { json: boolean; rest: string[] }
function parseArgs(argv: string[]): Args {
  const rest: string[] = [];
  let json = false;
  for (const a of argv) {
    if (a === '--json') json = true;
    else if (a === '--help' || a === '-h') usage();
    else if (a === '--version') { console.log(VERSION); process.exit(0); }
    else rest.push(a);
  }
  return { json, rest };
}

function absPath(p: string): string {
  return isAbsolute(p) ? p : resolve(process.cwd(), p);
}

function fmtMatch(m: MatchRecord): string {
  const s = m.stats;
  const result = s.has_won ? 'W' : 'L';
  const date = new Date(m.matches_time).toISOString().slice(0, 19).replace('T', ' ');
  const v0 = m.videos[0];
  return `${date}  ${result}  ${m.agent.agent_name.padEnd(10)} ${m.map.map_id.padEnd(40)} ${s.kills}/${s.deaths}/${s.assists}  score=${s.score}  matches=${m.matches_id.slice(0, 8)}  video=${v0?.video_name ?? '-'}  mp4=${v0?.video_src ?? '-'}`;
}

async function cmdAccounts() {
  let entries: string[];
  try {
    entries = readdirSync(DEFAULT_WONDERFUL_DIR);
  } catch (e) {
    die(`cannot read ${DEFAULT_WONDERFUL_DIR}: ${(e as Error).message}`);
  }
  const openids = entries.filter(n => /^\d+$/.test(n));
  for (const id of openids) {
    const snap = await readSnapshotDbFile(join(DEFAULT_WONDERFUL_DIR, id));
    const label = snap.nick && snap.tag ? `${snap.nick}#${snap.tag}` : (snap.nick ?? id);
    console.log(`${label}  (${id})`);
  }
}

async function cmdScan(dbPath: string, asJson: boolean) {
  const path = absPath(dbPath);
  let result;
  try { result = await readWonderfulDbFile(path); }
  catch (e) {
    if (e instanceof WonderfulDbError) die(`parse error: ${e.message}`, 2);
    die(`cannot read ${path}: ${(e as Error).message}`);
  }
  if (asJson) {
    console.log(JSON.stringify(result.matches, null, 2));
    return;
  }
  console.log(`account: ${result.key}`);
  console.log(`matches: ${result.matches.length}`);
  console.log('---');
  for (const m of result.matches) console.log(fmtMatch(m));
}

async function cmdShow(dbPath: string, matchId: string, asJson: boolean) {
  const path = absPath(dbPath);
  let result;
  try { result = await readWonderfulDbFile(path); }
  catch (e) {
    if (e instanceof WonderfulDbError) die(`parse error: ${e.message}`, 2);
    die(`cannot read ${path}: ${(e as Error).message}`);
  }
  const m = result.matches.find(x => x.matches_id === matchId || x.matches_id.startsWith(matchId));
  if (!m) die(`match "${matchId}" not found in ${path}`, 1);
  if (asJson) {
    console.log(JSON.stringify(m, null, 2));
    return;
  }
  console.log(JSON.stringify(m, null, 2));
}

interface ScanAllResult {
  dir: string;
  accounts: { openid: string; matchCount: number; nick?: string; tag?: string; error?: string }[];
  matches: (MatchRecord & { openid: string })[];
  totalErrors: number;
}

function fmtAccount(a: ScanAllResult['accounts'][number]): string {
  const id = a.nick && a.tag ? `${a.nick}#${a.tag}` : (a.nick ?? a.openid);
  return `${id.padEnd(28)}  ${a.openid}  ${a.matchCount}${a.error ? `  ERROR: ${a.error}` : ''}`;
}

async function cmdScanAll(dirOverride: string | undefined, asJson: boolean) {
  const dir = dirOverride ?? DEFAULT_WONDERFUL_DIR;
  let openids: string[];
  try { openids = readdirSync(dir).filter(n => /^\d+$/.test(n)); }
  catch (e) { die(`cannot read ${dir}: ${(e as Error).message}`); }

  const accounts: ScanAllResult['accounts'] = [];
  const matches: ScanAllResult['matches'] = [];
  let totalErrors = 0;

  for (const openid of openids) {
    const dbPath = join(dir, openid);
    try {
      const r = await readWonderfulDbFile(dbPath);
      const snap = await readSnapshotDbFile(dbPath);
      accounts.push({ openid, matchCount: r.matches.length, nick: snap.nick, tag: snap.tag });
      for (const m of r.matches) matches.push({ ...m, openid });
    } catch (e) {
      const msg = e instanceof WonderfulDbError ? e.message : (e as Error).message;
      accounts.push({ openid, matchCount: 0, error: msg });
      totalErrors++;
    }
  }
  const out: ScanAllResult = { dir, accounts, matches, totalErrors };
  if (asJson) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  console.log(`dir: ${dir}`);
  console.log(`accounts: ${accounts.length} (${totalErrors} errors)`);
  for (const a of accounts) console.log(`  ${fmtAccount(a)}`);
  console.log(`matches: ${matches.length}`);
}

async function main() {
  const { json, rest } = parseArgs(process.argv.slice(2));
  if (rest.length === 0) usage();
  const [cmd, ...args] = rest;
  switch (cmd) {
    case 'accounts': await cmdAccounts(); return;
    case 'scan': {
      if (args.length < 1) die('scan: missing <path-to-db>', 64);
      await cmdScan(args[0]!, json);
      return;
    }
    case 'scan-all': {
      // optional: first arg = override dir
      await cmdScanAll(args[0], json);
      return;
    }
    case 'show': {
      if (args.length < 2) die('show: missing <path-to-db> <match-id>', 64);
      await cmdShow(args[0]!, args[1]!, json);
      return;
    }
    default: die(`unknown command: ${cmd}`, 64);
  }
}

main().catch(e => die(`unexpected: ${(e as Error).message}`));
