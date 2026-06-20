import type { MatchRecord, VideoItem } from '@wonderful-ui/parser';
import { weaponNameOnly } from './weapons.ts';
import {
  eventExtObject,
  numberField,
  parseAclLocalTime,
  resolveClipEventState,
  stringField,
} from './event-state-machine.ts';

export interface NormalizedMatchEvent {
  timeMs: number;
  seekMs: number;
  playbackSeekMs: number;
  type: string;
  video: VideoItem;
  roundIdx: number;
  playerName: string;
  weaponName: string;
  isHeadshot: boolean;
  assistNum: number;
  rawEvent: import('@wonderful-ui/parser').EventItem;
  isKillerMe: boolean;
  isKilledMe: boolean;
}

export interface EventMarker {
  timeMs: number;
  type: string;
  weaponName: string;
  playerName: string;
  isHeadshot: boolean;
}

export function normalizeMatchEvents(m: MatchRecord): NormalizedMatchEvent[] {
  const eventsByKey = new Map<string, NormalizedMatchEvent>();
  for (const v of m.videos) {
    if (!v.rounds) continue;
    v.rounds.forEach((round, roundIdx) => {
      round.round_clips.forEach(clip => {
        clip.clip_events.forEach(ev => {
          const state = resolveClipEventState(m, v, round, clip, ev, roundIdx);
          if (state.kind !== 'montage' && state.kind !== 'moment') return;
          const eventType = state.eventType;
          const ext = ev.event_ext as Record<string, unknown>;
          const killedName = stringField(ext, 'KilledPlayerName');
          const killerName = stringField(ext, 'KillerPlayerName');
          const normKilled = normalizeName(killedName);
          const normKiller = normalizeName(killerName);
          const weaponPath = stringField(ext, 'WeaponSkinName');

          const dedupKey = eventDedupKey({
            eventType,
            eventTime: state.eventTime,
            timeMs: state.timeMs,
            normKiller,
            normKilled,
            weaponPath,
          });
          const candidate: NormalizedMatchEvent = {
            timeMs: state.timeMs,
            seekMs: state.seekMs,
            playbackSeekMs: state.playbackSeekMs,
            type: eventType,
            video: v,
            roundIdx,
            playerName: eventType === 'kill' ? killedName : killerName,
            weaponName: weaponFallbackName(weaponPath),
            isHeadshot: state.isHeadshot,
            assistNum: state.assistNum,
            rawEvent: ev,
            isKillerMe: numberField(ext, 'KillerIsMe') === 1,
            isKilledMe: numberField(ext, 'KilledIsMe') === 1,
          };
          const prev = eventsByKey.get(dedupKey);
          if (!prev || compareEventCandidate(candidate, prev) > 0) {
            eventsByKey.set(dedupKey, candidate);
          }
        });
      });
    });
  }
  const events = [...eventsByKey.values()];
  events.sort((a, b) => a.timeMs - b.timeMs);
  return events;
}

export function eventMarkersForVideo(video: VideoItem, m: MatchRecord): EventMarker[] {
  // Progress markers are presentation artifacts. They must consume only
  // events accepted by the shared state machine, then collapse duplicate
  // render points for the same accepted wall-clock event inside this video.
  // Do not add event-validity rules here.
  const markersByKey = new Map<string, EventMarker>();
  if (!video.rounds) return [];

  video.rounds.forEach((round, roundIdx) => {
    round.round_clips.forEach(clip => {
      clip.clip_events.forEach(ev => {
        const state = resolveClipEventState(m, video, round, clip, ev, roundIdx);
        if (state.kind !== 'montage' && state.kind !== 'moment') return;

        const ext = eventExtObject(ev);
        if (!ext) return;
        const weaponPath = stringField(ext, 'WeaponSkinName');
        const killerName = stringField(ext, 'KillerPlayerName');
        const killedName = stringField(ext, 'KilledPlayerName');
        const marker: EventMarker = {
          timeMs: state.seekMs,
          type: state.eventType,
          weaponName: weaponNameOnly(weaponPath),
          playerName: state.eventType === 'kill' ? killedName : killerName,
          isHeadshot: state.isHeadshot,
        };
        // Same state-machine-accepted shot can occasionally appear twice
        // in one video's clip rows. Keep one marker so one kill is one dot.
        const dedupKey = eventDedupKey({
          eventType: state.eventType,
          eventTime: state.eventTime,
          timeMs: state.timeMs,
          normKiller: normalizeName(killerName),
          normKilled: normalizeName(killedName),
          weaponPath,
        });
        const prev = markersByKey.get(dedupKey);
        if (!prev || marker.timeMs < prev.timeMs) {
          markersByKey.set(dedupKey, marker);
        }
      });
    });
  });

  const markers = [...markersByKey.values()];
  markers.sort((a, b) => a.timeMs - b.timeMs);
  return markers;
}

function normalizeName(s: string): string {
  return s.trim().replace(/#.*$/u, '').toLowerCase();
}

function eventSecondKey(eventTime: string): string {
  const normalized = eventTime.trim().replace('T', ' ');
  if (parseAclLocalTime(normalized) === undefined) return '';
  return normalized.slice(0, 19);
}

function weaponKey(weaponPath: string): string {
  const parts = weaponPath.split('/');
  const last = parts[parts.length - 1] ?? weaponPath;
  return last.replace(/_PrimaryAsset_C$/, '').replace(/\./g, '');
}

function weaponFallbackName(weaponPath: string): string {
  return weaponKey(weaponPath).replace(/_/g, ' ');
}

function eventDedupKey(input: {
  eventType: 'kill' | 'death';
  eventTime: string;
  timeMs: number;
  normKiller: string;
  normKilled: string;
  weaponPath: string;
}): string {
  const eventIdentity = input.eventType === 'death' ? input.normKiller : input.normKilled;
  const secondKey = eventSecondKey(input.eventTime);
  const typeKey = input.eventType === 'death' ? 'D' : 'K';
  if (secondKey && eventIdentity) {
    return `${typeKey}|${secondKey}|${eventIdentity}`;
  }
  const timeBucket = Math.floor(input.timeMs / 250);
  return [
    typeKey,
    secondKey || 'no-time',
    input.normKiller || 'unknown-killer',
    input.normKilled || 'unknown-victim',
    timeBucket,
    weaponKey(input.weaponPath),
  ].join('|');
}

function compareEventCandidate(a: NormalizedMatchEvent, b: NormalizedMatchEvent): number {
  return eventCandidateScore(a) - eventCandidateScore(b);
}

function eventCandidateScore(ev: NormalizedMatchEvent): number {
  const duration = ev.video.video_duration;
  const hasDuration = Number.isFinite(duration) && duration > 0;
  const primarySeekable = hasDuration && ev.timeMs >= 0 && ev.timeMs <= duration;
  const anySeekable = hasDuration && ev.seekMs >= 0 && ev.seekMs <= duration;
  const isKillMontage = ev.video.video_type === '击杀集锦';
  const isDeathMontage = ev.video.video_type === '死亡集锦';
  const isMomentClip = !isKillMontage && !isDeathMontage;
  const matchingMontage =
    (ev.type === 'kill' && isKillMontage) ||
    (ev.type === 'death' && isDeathMontage);

  return (anySeekable ? 1_000_000_000 : 0)
    + (matchingMontage ? 500_000_000 : 0)
    + (primarySeekable ? 100_000_000 : 0)
    + (isMomentClip ? 1_000_000 : 0)
    + (hasDuration ? Math.min(duration, 999_999) : 0);
}
