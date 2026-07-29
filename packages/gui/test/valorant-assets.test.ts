import { describe, expect, test } from 'bun:test';
import type { MatchRecord } from '@wonderful-ui/parser';
import {
  VALORANT_AGENTS,
  VALORANT_GAME_MODES,
  VALORANT_MAPS,
} from '../src/utils/generated/valorant-metadata.zh-CN.ts';
import {
  collectMatchAssetEntries,
  lookupAgentAsset,
  lookupGameModeAsset,
  lookupMapAsset,
  resolveMatchAgentLabel,
  resolveMatchAssetUrl,
  resolveMatchMapLabel,
} from '../src/utils/valorant-assets.ts';

function match(overrides: Partial<MatchRecord> = {}): MatchRecord {
  return {
    matches_id: 'metadata-test',
    matches_time: 0,
    map: { map_id: '/Game/Maps/Jam/Jam' },
    agent: { agent_id: '', agent_name: 'Jett' },
    stats: {
      kills: 0,
      assists: 0,
      deaths: 0,
      score: 0,
      has_won: false,
      mode_name: '',
      rounds_won: 0,
      rounds_lost: 0,
      game_level: '',
    },
    openID: '',
    mode: '',
    minRoundId: 0,
    gameStartTime: '',
    gameEndTime: '',
    videos: [],
    ...overrides,
  };
}

describe('generated Valorant metadata', () => {
  test('has unique stable identities and bundled image paths', () => {
    expect(VALORANT_AGENTS.length).toBeGreaterThan(20);
    expect(VALORANT_MAPS.length).toBeGreaterThan(20);
    expect(new Set(VALORANT_AGENTS.map(agent => agent.uuid)).size).toBe(VALORANT_AGENTS.length);
    expect(new Set(VALORANT_MAPS.map(map => map.uuid)).size).toBe(VALORANT_MAPS.length);
    expect(new Set(VALORANT_MAPS.map(map => map.mapUrl.toLowerCase())).size).toBe(VALORANT_MAPS.length);
    expect(VALORANT_GAME_MODES.length).toBeGreaterThan(10);
    for (const record of [...VALORANT_AGENTS, ...VALORANT_MAPS, ...VALORANT_GAME_MODES]) {
      expect(record.cn.trim()).not.toBe('');
      expect(record.image).toMatch(/^\/valorant\/(agents|maps|gamemodes)\/[a-f0-9-]+\.png$/);
      expect(record.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  test('contains current agents and canonical map names', () => {
    expect(lookupAgentAsset('Miks')?.cn).toBe('迷核');
    expect(lookupAgentAsset('Veto')?.cn).toBe('禁灭');
    expect(lookupMapAsset('/Game/Maps/Jam/Jam')?.cn).toBe('莲华古城');
    expect(lookupMapAsset('/Game/Maps/PovegliaV2/RangeV2')?.cn).toBe('靶场');
  });
});

describe('canonical match resolution', () => {
  test('known identities override stale or mismatched ACLOS display fields', () => {
    const value = match({
      agent: {
        agent_id: 'add6443a-41bd-e414-f6ad-e58d267f4e95',
        agent_name: 'Sova',
      },
      career: {
        hero_name: '错误特工',
        hero_image: 'https://example.com/hero.png',
        map_name: '亚海悬城',
        map_image: 'https://example.com/map.png',
      },
    });

    expect(resolveMatchAgentLabel(value)).toBe('捷风');
    expect(resolveMatchMapLabel(value)).toBe('莲华古城');
    expect(resolveMatchAssetUrl(value, 'hero_image')).toBe('/valorant/agents/add6443a-41bd-e414-f6ad-e58d267f4e95.png');
    expect(resolveMatchAssetUrl(value, 'map_image')).toBe('/valorant/maps/2fe4ed3a-450a-948b-6d6b-e89a78e680a9.png');
    expect(collectMatchAssetEntries([value])).toEqual([]);
  });

  test('unknown identities retain labels but never fetch remote images at runtime', () => {
    const value = match({
      map: { map_id: '/Game/Maps/Future/Future', map_name: '未来地图' },
      agent: { agent_id: 'future-agent-id', agent_name: 'FutureAgent' },
      career: {
        hero_name: '未来特工',
        hero_image: 'https://example.com/future-agent.png',
        map_image: 'https://example.com/future-map.png',
      },
    });

    expect(resolveMatchAgentLabel(value)).toBe('未来特工');
    expect(resolveMatchMapLabel(value)).toBe('未来地图');
    expect(resolveMatchAssetUrl(value, 'hero_image')).toBeUndefined();
    expect(resolveMatchAssetUrl(value, 'map_image')).toBeUndefined();
  });

  test('resolves a bundled game-mode icon from the internal mode path', () => {
    const value = match({
      stats: {
        ...match().stats,
        mode_name: '/Game/GameModes/Bomb/BombGameMode.BombGameMode_C',
      },
      mode: 'competitive',
      career: { game_mode_icon: 'https://example.com/mode.png' },
    });
    expect(lookupGameModeAsset(value)?.cn).toBe('标准');
    expect(resolveMatchAssetUrl(value, 'game_mode_icon'))
      .toBe('/valorant/gamemodes/96bd3920-4f36-d026-2b28-c683eb0bcac5.png');
  });
});
