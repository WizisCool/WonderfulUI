import { describe, test, expect } from 'bun:test';
import { hexToBytes, isHexText } from '../src/decoder.ts';
import { deriveKeyIv, aesDecrypt, decryptWonderfulDbBuffer } from '../src/crypto.ts';
import { parseSnapshotDbBuffer, parseWonderfulDbBuffer, readWonderfulDbText, WonderfulDbError } from '../src/reader.ts';
import { readSnapshotDbFile, readWonderfulDbFile } from '../src/reader-file.ts';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

describe('crypto', () => {
  test('deriveKeyIv produces 32-byte key and 16-byte iv', async () => {
    const { key, iv } = await deriveKeyIv('4807045517549591240');
    expect(key.length).toBe(32);
    expect(iv.length).toBe(16);
  });

  test('aesDecrypt roundtrips a known buffer', async () => {
    const key = new Uint8Array(32).fill(7);
    const iv = new Uint8Array(16).fill(3);
    const crypto = await import('node:crypto');
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    const ct = Buffer.concat([cipher.update('hello world', 'utf8'), cipher.final()]);
    const ptBytes = await aesDecrypt(new Uint8Array(ct), key, iv);
    const pt = new TextDecoder().decode(ptBytes);
    expect(pt).toBe('hello world');
  });

  test('decryptWonderfulDbBuffer end-to-end with known ciphertext', async () => {
    const openid = '4807045517549591240';
    const { key, iv } = await deriveKeyIv(openid);
    // encrypt 'hello world' with the same key/iv scheme the parser would use
    const crypto = await import('node:crypto');
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    const ct = Buffer.concat([cipher.update('plaintext check', 'utf8'), cipher.final()]);
    const out = await decryptWonderfulDbBuffer(new Uint8Array(ct), openid);
    expect(out).toBe('plaintext check');
  });
});

describe('decoder', () => {
  test('hexToBytes decodes and validates', () => {
    const bytes = hexToBytes('48656c6c6f');
    expect(new TextDecoder().decode(bytes)).toBe('Hello');
    expect(isHexText('48656c6c6f')).toBe(true);
    expect(isHexText('xyz')).toBe(false);
  });

  test('hexToBytes rejects odd length and non-hex', () => {
    expect(() => hexToBytes('abc')).toThrow(/odd/);
    expect(() => hexToBytes('zz')).toThrow();
  });
});

describe('snapshot parser tolerance', () => {
  test('corrupt snapshot bytes return empty nick metadata', async () => {
    const result = await parseSnapshotDbBuffer(new TextEncoder().encode('not hex'), '4807045517549591240');
    expect(result.nick).toBeUndefined();
    expect(result.tag).toBeUndefined();
    expect(result.achievements).toBeUndefined();
  });
});

const FIXTURE_DIR = process.env.WONDERFUL_DB_DIR
  ?? join(process.env.USERPROFILE ?? process.env.HOME ?? '', 'AppData', 'Roaming', 'ACLOS', 'WonderfulDb');

describe('snapshot achievements extraction', () => {
  test('extracts mvp/svp from real snapshot 4807', async () => {
    const path = join(FIXTURE_DIR, 'snapshot4807045517549591240');
    const file = Bun.file(path);
    if (!(await file.exists())) { console.warn('skip: snapshot not found'); return; }
    const buf = new Uint8Array(await readFile(path));
    const result = await parseSnapshotDbBuffer(buf, '4807045517549591240');
    expect(result.nick).toBe('超雄小猫咪');
    expect(result.tag).toBe('13949');
    // 4807 has 10 MVP/SVP across 17 records
    expect(result.achievements).toBeDefined();
    const achvs = result.achievements!;
    expect(achvs.length).toBeGreaterThanOrEqual(1);
    for (const a of achvs) {
      expect(['mvp', 'svp']).toContain(a.type);
      expect(typeof a.matches_id).toBe('string');
      expect(a.matches_id.length).toBeGreaterThan(0);
      expect(typeof a.typeStr).toBe('string');
    }
    const mvpCount = achvs.filter(a => a.type === 'mvp').length;
    const svpCount = achvs.filter(a => a.type === 'svp').length;
    console.log(`  4807 achievements: ${achvs.length} (mvp=${mvpCount}, svp=${svpCount})`);
  });

  test('extracts mvp/svp from real snapshot 1412', async () => {
    const path = join(FIXTURE_DIR, 'snapshot14121192131852595386');
    const file = Bun.file(path);
    if (!(await file.exists())) { console.warn('skip: snapshot not found'); return; }
    const buf = new Uint8Array(await readFile(path));
    const result = await parseSnapshotDbBuffer(buf, '14121192131852595386');
    expect(result.nick).toBe('相对论I');
    expect(result.tag).toBe('65174');
    expect(result.achievements).toBeDefined();
    const achvs = result.achievements!;
    expect(achvs.length).toBeGreaterThanOrEqual(1);
    for (const a of achvs) {
      expect(['mvp', 'svp']).toContain(a.type);
    }
    console.log(`  1412 achievements: ${achvs.length}`);
  });

  test('empty snapshot (1379) returns no achievements', async () => {
    const path = join(FIXTURE_DIR, 'snapshot13794749312275947089');
    const file = Bun.file(path);
    if (!(await file.exists())) { console.warn('skip: snapshot not found'); return; }
    const buf = new Uint8Array(await readFile(path));
    const result = await parseSnapshotDbBuffer(buf, '13794749312275947089');
    expect(result.nick).toBeUndefined();
    expect(result.tag).toBeUndefined();
    expect(result.achievements).toBeUndefined();
  });

  test('legacy empty snapshot (1228) returns no achievements', async () => {
    const path = join(FIXTURE_DIR, 'snapshot1228584785010313960');
    const file = Bun.file(path);
    if (!(await file.exists())) { console.warn('skip: snapshot not found'); return; }
    const buf = new Uint8Array(await readFile(path));
    const result = await parseSnapshotDbBuffer(buf, '1228584785010313960');
    expect(result.nick).toBeUndefined();
    expect(result.tag).toBeUndefined();
    expect(result.achievements).toBeUndefined();
  });

  test('achievement objects have expected TS model keys', async () => {
    const path = join(FIXTURE_DIR, 'snapshot4807045517549591240');
    const file = Bun.file(path);
    if (!(await file.exists())) { console.warn('skip: snapshot not found'); return; }
    const buf = new Uint8Array(await readFile(path));
    const result = await parseSnapshotDbBuffer(buf, '4807045517549591240');
    expect(result.achievements).toBeDefined();
    if (result.achievements && result.achievements.length > 0) {
      const a = result.achievements[0];
      expect(a).toHaveProperty('matches_id');
      expect(a).toHaveProperty('type');
      expect(a).toHaveProperty('typeStr');
    }
  });
});

const REAL_DBS: { path: string; openid: string; minMatches: number; agentName: string }[] = [
  {
    path: join(FIXTURE_DIR, '4807045517549591240'),
    openid: '4807045517549591240',
    minMatches: 40,
    agentName: 'Cypher',
  },
  {
    path: join(FIXTURE_DIR, '14121192131852595386'),
    openid: '14121192131852595386',
    minMatches: 1,
    agentName: '',
  },
  {
    path: join(FIXTURE_DIR, '13794749312275947089'),
    openid: '13794749312275947089',
    minMatches: 1,
    agentName: '',
  },
];

describe('real WonderfulDb files', () => {
  for (const db of REAL_DBS) {
    test(`reads ${db.openid}`, async () => {
      const file = Bun.file(db.path);
      if (!(await file.exists())) {
        console.warn(`skip: ${db.path} not found`);
        return;
      }
      const result = await readWonderfulDbFile(db.path);
      console.log(`\n--- ${db.openid} ---`);
      console.log(`key: ${result.key}`);
      console.log(`matches: ${result.matches.length}`);
      if (result.matches[0]) {
        const m = result.matches[0];
        console.log(`  [0] ${m.matches_id}  ${m.agent.agent_name} ${m.map.map_id}  ${m.stats.kills}/${m.stats.deaths}/${m.stats.assists}  win=${m.stats.has_won}  videos=${m.videos.length}`);
        if (m.videos[0]) {
          console.log(`    video[0] ${m.videos[0].video_id}  ${m.videos[0].video_name}  ${m.videos[0].video_src}`);
        }
      }
      expect(result.matches.length).toBeGreaterThanOrEqual(db.minMatches);
      if (db.agentName) {
        expect(result.matches[0]?.agent.agent_name).toBe(db.agentName);
      }
    });
  }
});

const REAL_SNAPSHOTS: { path: string; openid: string; nick: string; tag: string }[] = [
  { path: join(FIXTURE_DIR, 'snapshot4807045517549591240'), openid: '4807045517549591240', nick: '超雄小猫咪', tag: '13949' },
  { path: join(FIXTURE_DIR, 'snapshot14121192131852595386'), openid: '14121192131852595386', nick: '相对论I', tag: '65174' },
  { path: join(FIXTURE_DIR, 'snapshot13794749312275947089'), openid: '13794749312275947089', nick: '', tag: '' },
  { path: join(FIXTURE_DIR, 'snapshot1228584785010313960'), openid: '1228584785010313960', nick: '', tag: '' },
];

describe('real snapshot files', () => {
  for (const s of REAL_SNAPSHOTS) {
    test(`parses ${s.openid}`, async () => {
      const file = Bun.file(s.path);
      if (!(await file.exists())) {
        console.warn(`skip: ${s.path} not found`);
        return;
      }
      // The wrapper `readSnapshotDbFile(<wonderful_list_path>)` derives the
      // sibling `snapshot<openid>` path. Tests bypass that and feed the raw
      // snapshot bytes through `parseSnapshotDbBuffer` so we can pair this
      // fixture directly with the snapshot file.
      const buf = new Uint8Array(await readFile(s.path));
      const result = await parseSnapshotDbBuffer(buf, s.openid);
      console.log(`\n--- ${s.openid} ---\n  nick: ${result.nick}\n  tag:  ${result.tag}`);
      expect(result.nick ?? '').toBe(s.nick);
      expect(result.tag ?? '').toBe(s.tag);
    });
  }
});

describe('readSnapshotDbFile (uses wonderful-list path)', () => {
  // Pair the snapshot fixtures with their wonderful-list path. The wrapper
  // derives the snapshot path from this, matching how scan_all uses it.
  for (const db of REAL_DBS) {
    test(`finds snapshot next to ${db.openid}`, async () => {
      if (!(await Bun.file(db.path).exists())) {
        console.warn(`skip: ${db.path} not found`);
        return;
      }
      const result = await readSnapshotDbFile(db.path);
      console.log(`\n--- ${db.openid} ---\n  nick: ${result.nick}\n  tag:  ${result.tag}`);
      // The 4 fixture openids have known nick expectations; other accounts
      // (no fixture) would just return {} and we don't reach this loop.
      const expectedNick: Record<string, string> = {
        '4807045517549591240': '超雄小猫咪',
        '14121192131852595386': '相对论I',
      };
      const expected = expectedNick[db.openid];
      if (expected) {
        expect(result.nick).toBe(expected);
        expect(result.tag).toMatch(/^\d{2,6}$/);
      }
    });
  }
});
