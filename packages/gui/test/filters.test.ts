import { describe, test, expect } from 'bun:test';
import {
  EMPTY_FILTERS, activeFilterCount,
  FilterState, kdaOf, kdOf, matchDurationSec, normalizeVisibleFilters, videoTotalDuration,
  agentCn, mapCn, mapImageUrl, heroImageUrl, fmtMap, fmtMatchDuration,
} from '../src/utils/filters.ts';
import { applyFilters, facetValueCounts, pruneUnavailableCategories } from '../src/utils/filter-engine.ts';
import { endOfSelectedDayForFilter } from '../src/utils/date-picker.ts';
import type { MatchRecord, VideoItem } from '@wonderful-ui/parser';

function mkVideo(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    video_id: 'v1', video_isProcessing: false,
    video_src: 'Z:\\v.mp4', video_duration: 120, video_fps: 60,
    video_resolution: '1920x1080', video_name: '击杀集锦',
    video_poster: 'Z:\\v.jpg', video_ext: '.mp4',
    video_time: 0, video_size: 2_000_000, video_level: '3',
    video_type: '击杀集锦', video_hash: '', cover_hash: '',
    template_id: '', is_upload: false,
    ...overrides,
  };
}

function mkMatch(overrides: Partial<MatchRecord> = {}): MatchRecord {
  const video = overrides.videos ? overrides.videos[0]! : mkVideo();
  return {
    matches_id: 'm1',
    matches_time: new Date('2026-06-15').getTime(),
    map: { map_id: '/Game/Maps/Jam/Jam' },
    agent: { agent_id: 'a1', agent_name: 'Jett' },
    stats: {
      kills: 20, deaths: 10, assists: 5, score: 300,
      has_won: true, mode_name: '', rounds_won: 13, rounds_lost: 8,
      game_level: '150',
    },
    openID: '123',
    mode: 'competitive',
    minRoundId: 0,
    gameStartTime: '2026-06-15T10:00:00Z',
    gameEndTime: '2026-06-15T10:35:00Z',
    videos: [video],
    career: { hero_name: '捷风', map_name: '莲华古城', game_mode: '竞技模式' },
    ...overrides,
  };
}

const m1 = mkMatch();
const m2 = mkMatch({
  matches_id: 'm2',
  agent: { agent_id: 'a2', agent_name: 'Sage' },
  career: { hero_name: '贤者', map_name: '深海明珠', game_mode: '竞技模式' },
  map: { map_id: '/Game/Maps/Pitt/Pitt' },
  stats: {
    kills: 5, deaths: 20, assists: 10, score: 100,
    has_won: false, mode_name: '', rounds_won: 5, rounds_lost: 13,
    game_level: '80',
  },
  matches_time: new Date('2026-06-10').getTime(),
  mode: 'competitive',
});
const m3 = mkMatch({
  matches_id: 'm3',
  agent: { agent_id: 'a1', agent_name: 'Jett' },
  stats: {
    kills: 30, deaths: 5, assists: 2, score: 400,
    has_won: true, mode_name: '', rounds_won: 13, rounds_lost: 2,
    game_level: '200',
  },
  matches_time: new Date('2026-01-01').getTime(),
  career: { hero_name: '捷风', map_name: '亚海悬城', game_mode: '极速模式' },
  map: { map_id: '/Game/Maps/Ascent/Ascent' },
  mode: 'swiftplay',
});
const all = [m1, m2, m3];

describe('EMPTY_FILTERS', () => {
  test('returns all matches when no filters active', () => {
    const result = applyFilters(all, EMPTY_FILTERS);
    expect(result.length).toBe(3);
  });
});

describe('categorical filter', () => {
  test('heroes OR: 捷风 returns m1 and m3', () => {
    const fs: FilterState = { ...EMPTY_FILTERS, heroes: ['捷风'] };
    const result = applyFilters(all, fs);
    expect(result.length).toBe(2);
    expect(result.map(m => m.matches_id).sort()).toEqual(['m1', 'm3']);
  });

  test('heroes OR with en fallback: Jett also matches via agent_name', () => {
    const fs: FilterState = { ...EMPTY_FILTERS, heroes: ['Jett'] };
    const result = applyFilters(all, fs);
    expect(result.length).toBe(2);
  });

  test('results: win returns 2 matches', () => {
    const fs: FilterState = { ...EMPTY_FILTERS, results: ['win'] };
    expect(applyFilters(all, fs).length).toBe(2);
  });

  test('results: loss returns 1 match', () => {
    const fs: FilterState = { ...EMPTY_FILTERS, results: ['loss'] };
    expect(applyFilters(all, fs).length).toBe(1);
  });

  test('cross-category AND: 捷风 + 莲华古城 returns only m1', () => {
    const fs: FilterState = { ...EMPTY_FILTERS, heroes: ['捷风'], maps: ['莲华古城'] };
    const result = applyFilters(all, fs);
    expect(result.length).toBe(1);
    expect(result[0]!.matches_id).toBe('m1');
  });

  test('modes: swiftplay returns m3', () => {
    const fs: FilterState = { ...EMPTY_FILTERS, modes: ['极速模式'] };
    const result = applyFilters(all, fs);
    expect(result.length).toBe(1);
    expect(result[0]!.matches_id).toBe('m3');
  });

  test('videoTypes matches when any video has the type', () => {
    const fs: FilterState = { ...EMPTY_FILTERS, videoTypes: ['击杀集锦'] };
    expect(applyFilters(all, fs).length).toBe(3); // all matches have "击杀集锦" video
  });
});

describe('dynamic facets', () => {
  test('map selection narrows available heroes', () => {
    const fs: FilterState = { ...EMPTY_FILTERS, maps: ['莲华古城'] };
    expect([...facetValueCounts(all, fs, 'heroes').keys()]).toEqual(['捷风']);
  });

  test('hero selection narrows available maps in reverse', () => {
    const fs: FilterState = { ...EMPTY_FILTERS, heroes: ['捷风'] };
    expect([...facetValueCounts(all, fs, 'maps').keys()].sort()).toEqual(['亚海悬城', '莲华古城']);
  });

  test('prunes category selections that no longer exist in current scope', () => {
    const fs: FilterState = { ...EMPTY_FILTERS, maps: ['莲华古城'], heroes: ['贤者'] };
    const pruned = pruneUnavailableCategories(all, fs);
    expect(pruned.maps).toEqual(['莲华古城']);
    expect(pruned.heroes).toEqual([]);
  });
});

describe('numeric range filter', () => {
  test('kills [15,25] includes boundary values', () => {
    const fs: FilterState = { ...EMPTY_FILTERS, kills: [15, 25] };
    const result = applyFilters(all, fs);
    expect(result.length).toBe(1);
    expect(result[0]!.matches_id).toBe('m1');
  });

  test('kills [null, 15] returns m2 only', () => {
    const fs: FilterState = { ...EMPTY_FILTERS, kills: [null, 15] };
    const result = applyFilters(all, fs);
    expect(result.map(m => m.matches_id)).toEqual(['m2']);
  });

  test('score [200, null] includes 300 and 400', () => {
    const fs: FilterState = { ...EMPTY_FILTERS, score: [200, null] };
    expect(applyFilters(all, fs).length).toBe(2);
  });

  test('kda range filters ratio', () => {
    // m1: (20+5)/10 = 2.5, m2: (5+10)/20 = 0.75, m3: (30+2)/5 = 6.4
    const fs: FilterState = { ...EMPTY_FILTERS, kda: [1, 3] };
    const result = applyFilters(all, fs);
    expect(result.length).toBe(1);
    expect(result[0]!.matches_id).toBe('m1');
  });

  test('roundsWon range', () => {
    const fs: FilterState = { ...EMPTY_FILTERS, roundsWon: [13, 13] };
    const result = applyFilters(all, fs);
    expect(result.length).toBe(2); // m1 and m3 both have 13 rounds won
  });

  test('videoCount range', () => {
    const fs: FilterState = { ...EMPTY_FILTERS, videoCount: [1, 1] };
    expect(applyFilters(all, fs).length).toBe(3); // all have 1 video
  });
});

describe('date range', () => {
  test('date picker end date includes the full selected day', () => {
    const end = endOfSelectedDayForFilter(new Date(2026, 5, 15));
    const d = new Date(end);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(5);
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(23);
    expect(d.getMinutes()).toBe(59);
    expect(d.getSeconds()).toBe(59);
    expect(d.getMilliseconds()).toBe(999);
  });

  test('dateRange narrows to 2026-06 matches', () => {
    const jun1 = new Date('2026-06-01').getTime();
    const jul1 = new Date('2026-07-01').getTime();
    const fs: FilterState = { ...EMPTY_FILTERS, dateRange: [jun1, jul1] };
    const result = applyFilters(all, fs);
    expect(result.length).toBe(2); // m1 + m2
  });

  test('dateRange with only lower bound', () => {
    const mar1 = new Date('2026-03-01').getTime();
    const fs: FilterState = { ...EMPTY_FILTERS, dateRange: [mar1, null] };
    expect(applyFilters(all, fs).length).toBe(2); // m1 + m2 in June
  });
});

describe('empty result', () => {
  test('contradictory filters return empty', () => {
    const fs: FilterState = {
      ...EMPTY_FILTERS,
      heroes: ['捷风'],
      kills: [50, 100],
    };
    expect(applyFilters(all, fs).length).toBe(0);
  });
});

describe('derived values', () => {
  test('kdaOf computes correctly', () => {
    expect(kdaOf(m1)).toBeCloseTo(2.5, 1); // (20+5)/10
    expect(kdaOf(m2)).toBeCloseTo(0.75, 2); // (5+10)/20
    expect(kdaOf(m3)).toBeCloseTo(6.4, 1); // (30+2)/5
  });

  test('kdOf computes correctly', () => {
    expect(kdOf(m1)).toBe(2); // 20/10
    expect(kdOf(m2)).toBe(0.25); // 5/20
    expect(kdOf(m3)).toBe(6); // 30/5
  });

  test('matchDurationSec computes correctly', () => {
    expect(matchDurationSec(m1)).toBe(35 * 60); // 35 min
  });

  test('fmtMatchDuration / matchDurationSec parse ACLOS local wall-clock strings', () => {
    // ACLOS writes "YYYY-MM-DD HH:mm:ss.mmm" (space, no Z). Must not rely on
    // implementation-defined Date("…") parsing.
    const m = mkMatch({
      gameStartTime: '2026-06-08 21:55:16.535',
      gameEndTime: '2026-06-08 22:25:16.535',
    });
    expect(matchDurationSec(m)).toBe(30 * 60);
    expect(fmtMatchDuration(m)).toBe('30:00');
  });

  test('videoTotalDuration sums', () => {
    expect(videoTotalDuration(m1)).toBe(120);
  });

  test('kdaOf handles 0 deaths gracefully', () => {
    const m = mkMatch({ stats: { ...m1.stats, deaths: 0, kills: 10, assists: 2 } });
    const v = kdaOf(m);
    expect(v).toBeGreaterThan(0);
    expect(Number.isFinite(v)).toBe(true);
  });
});

describe('activeFilterCount', () => {
  test('empty filters = 0', () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
  });

  test('1 hero + 1 range = 2', () => {
    const fs: FilterState = { ...EMPTY_FILTERS, heroes: ['捷风'], kills: [10, 20] };
    expect(activeFilterCount(fs)).toBe(2);
  });

  test('query counts as 1', () => {
    const fs: FilterState = { ...EMPTY_FILTERS, query: '捷风' };
    expect(activeFilterCount(fs)).toBe(1);
  });

  test('multiple selections in one category count each', () => {
    const fs: FilterState = { ...EMPTY_FILTERS, heroes: ['捷风', '贤者'] };
    expect(activeFilterCount(fs)).toBe(2);
  });
});

describe('visible filter normalization', () => {
  test('clears hidden legacy numeric filters', () => {
    const fs: FilterState = { ...EMPTY_FILTERS, deaths: [1, 3], score: [200, null], kills: [20, null] };
    const normalized = normalizeVisibleFilters(fs);
    expect(normalized.deaths).toEqual([null, null]);
    expect(normalized.score).toEqual([null, null]);
    expect(normalized.kills).toEqual([20, null]);
  });
});

describe('fuse.js text search', () => {
  test('query matches CN hero name', () => {
    const fs: FilterState = { ...EMPTY_FILTERS, query: '捷风' };
    const result = applyFilters(all, fs);
    expect(result.length).toBe(2); // m1 + m3
  });

  test('query matches EN hero name (fuzzy)', () => {
    const fs: FilterState = { ...EMPTY_FILTERS, query: 'Sage' };
    const result = applyFilters(all, fs);
    expect(result.length).toBe(1);
    expect(result[0]!.matches_id).toBe('m2');
  });

  test('query matches CN map name', () => {
    const fs: FilterState = { ...EMPTY_FILTERS, query: '深海明珠' };
    const result = applyFilters(all, fs);
    expect(result.length).toBe(1);
    expect(result[0]!.matches_id).toBe('m2');
  });

  test('query matches CN mode', () => {
    const fs: FilterState = { ...EMPTY_FILTERS, query: '极速模式' };
    const result = applyFilters(all, fs);
    expect(result.length).toBe(1);
    expect(result[0]!.matches_id).toBe('m3');
  });

  test('query matches match ID', () => {
    const fs: FilterState = { ...EMPTY_FILTERS, query: 'm2' };
    const result = applyFilters(all, fs);
    expect(result.length).toBe(1);
    expect(result[0]!.matches_id).toBe('m2');
  });

  test('query combines with categorical filters', () => {
    const fs: FilterState = { ...EMPTY_FILTERS, query: '捷风', results: ['win'] };
    const result = applyFilters(all, fs);
    expect(result.length).toBe(2); // both m1 and m3 are Jett + win
  });

  test('empty query returns all', () => {
    const fs: FilterState = { ...EMPTY_FILTERS, query: '' };
    expect(applyFilters(all, fs).length).toBe(3);
  });
});

describe('career-missing map/agent fallbacks', () => {
  test('mapCn/fmtMap resolve Skirmish_A and RangeV2', () => {
    expect(fmtMap('/Game/Maps/Duel/Duel_1/Skirmish_A')).toBe('斗牛 1');
    expect(fmtMap('/Game/Maps/Duel/Duel_Heady/Skirmish_E')).toBe('斗牛 5');
    expect(fmtMap('/Game/Maps/PovegliaV2/RangeV2')).toBe('训练场');
    expect(fmtMap('/Game/Maps/HURM/HURM_Helix/HURM_Helix')).toBe('渔市');
    expect(fmtMap('/Game/Maps/HURM/HURM_Alley/HURM_Alley')).toBe('商街');
    expect(fmtMap('/Game/Maps/HURM/HURM_Bowl/HURM_Bowl')).toBe('古城');
    expect(fmtMap('/Game/Maps/HURM/HURM_Yard/HURM_Yard')).toBe('小镇');
    expect(fmtMap('/Game/Maps/HURM/HURM_HighTide/HURM_HighTide')).toBe('乱次元');
  });

  test('agentCn falls back to CN when career.hero_name empty', () => {
    const m = mkMatch({
      agent: { agent_id: 'x', agent_name: 'Jett' },
      career: { hero_name: '', map_name: '', map_image: '', hero_image: '' },
      map: { map_id: '/Game/Maps/Duel/Duel_1/Skirmish_A' },
    });
    expect(agentCn(m)).toBe('捷风');
    expect(mapCn(m)).toBe('斗牛 1');
    expect(heroImageUrl(m)).toContain('headicon');
    expect(mapImageUrl(m)).toContain('skirmish_a');
  });

  test('career values win for text and images when present', () => {
    const m = mkMatch({
      agent: { agent_id: 'x', agent_name: 'Jett' },
      career: {
        hero_name: '自定义',
        map_name: '自定义图',
        map_image: 'https://example.com/m.png',
        hero_image: 'https://example.com/h.png',
      },
      map: { map_id: '/Game/Maps/Ascent/Ascent' },
    });
    expect(agentCn(m)).toBe('自定义');
    expect(mapCn(m)).toBe('自定义图');
    expect(mapImageUrl(m)).toBe('https://example.com/m.png');
    expect(heroImageUrl(m)).toBe('https://example.com/h.png');
  });
});
