import type { EventItem, MatchRecord, RoundClip, RoundItem, VideoItem } from '@wonderful-ui/parser';
import { EVENT_PREROLL_MS } from './event-time.ts';

export type VisibleEventKind = 'montage' | 'moment';
export type EventActionType = 'kill' | 'death';

export type EventState =
  | {
    kind: VisibleEventKind;
    eventType: EventActionType;
    timeMs: number;
    seekMs: number;
    playbackSeekMs: number;
    isHeadshot: boolean;
    assistNum: number;
    eventTime: string;
  }
  | { kind: 'rejected'; reason: string }
  | { kind: 'quarantined'; reason: string };

export function resolveClipEventState(
  match: MatchRecord,
  video: VideoItem,
  _round: RoundItem,
  clip: RoundClip,
  event: EventItem,
  _roundIdx: number,
): EventState {
  const eventType = normalizeEventType(event.event_type);
  if (eventType !== 'kill' && eventType !== 'death') {
    return rejected('unsupported-event-type');
  }

  const ext = eventExtObject(event);
  if (!ext) return quarantined('missing-event-ext');

  const eventName = stringField(ext, 'EventName');
  if (!eventName) return quarantined('missing-event-name');
  if (eventName.toLowerCase() !== 'shot') return rejected('not-shot-event');

  const killerName = stringField(ext, 'KillerPlayerName');
  const killedName = stringField(ext, 'KilledPlayerName');
  if (!killerName || !killedName) return quarantined('missing-player-name');

  const eventAgent = normalizeComparableName(stringField(ext, 'AgentName'));
  const matchAgent = normalizeComparableName(match.agent?.agent_name ?? '');
  if (!eventAgent) return quarantined('missing-event-agent');
  if (!matchAgent) return quarantined('missing-match-agent');
  if (eventAgent !== matchAgent) return rejected('agent-mismatch');

  const eventTime = stringField(ext, 'EventTime');
  if (!eventTime) return quarantined('missing-event-time');
  if (!isWithinMatchWindow(eventTime, match)) return rejected('outside-match-window');

  const killerIsMe = numberField(ext, 'KillerIsMe');
  const killedIsMe = numberField(ext, 'KilledIsMe');
  if (eventType === 'kill') {
    if (killerIsMe === 0 || killedIsMe === 1) return rejected('not-local-kill');
    if (killerIsMe !== 1 || killedIsMe !== 0) return quarantined('missing-local-kill-flags');
  } else {
    if (killedIsMe === 0 || killerIsMe === 1) return rejected('not-local-death');
    if (killedIsMe !== 1 || killerIsMe !== 0) return quarantined('missing-local-death-flags');
  }

  const shotPart = numberField(ext, 'GetShotRolePart');
  if (shotPart === undefined) return quarantined('missing-shot-part');

  const timeState = resolveVideoTime(video, clip, event, eventType);
  if (timeState.kind !== 'ok') return timeState.state;

  return {
    kind: timeState.visibleKind,
    eventType,
    timeMs: timeState.timeMs,
    seekMs: timeState.timeMs,
    playbackSeekMs: Math.max(0, timeState.timeMs - EVENT_PREROLL_MS),
    isHeadshot: shotPart === 1,
    assistNum: numberField(ext, 'AssistNum') ?? 0,
    eventTime,
  };
}

function resolveVideoTime(
  video: VideoItem,
  clip: RoundClip,
  event: EventItem,
  eventType: EventActionType,
): { kind: 'ok'; visibleKind: VisibleEventKind; timeMs: number } | { kind: 'bad'; state: EventState } {
  const duration = finiteNumber(video.video_duration);
  const eventTime = finiteNumber(event.event_sTime);
  if (duration === undefined || duration <= 0) {
    return { kind: 'bad', state: quarantined('missing-video-duration') };
  }
  if (eventTime === undefined || eventTime < 0) {
    return { kind: 'bad', state: quarantined('invalid-event-time') };
  }

  const isKillMontage = video.video_type === '击杀集锦';
  const isDeathMontage = video.video_type === '死亡集锦';
  if (isKillMontage || isDeathMontage) {
    if ((isKillMontage && eventType !== 'kill') || (isDeathMontage && eventType !== 'death')) {
      return { kind: 'bad', state: rejected('video-type-event-type-mismatch') };
    }
    if (!isWithinVideo(eventTime, duration)) {
      return { kind: 'bad', state: quarantined('event-time-outside-video') };
    }
    return { kind: 'ok', visibleKind: 'montage', timeMs: eventTime };
  }

  if (eventType !== 'kill') {
    return { kind: 'bad', state: rejected('video-type-event-type-mismatch') };
  }
  const clipTime = finiteNumber(clip.clip_sTime);
  if (clipTime === undefined || clipTime < 0) {
    if (isWithinVideo(eventTime, duration)) {
      return { kind: 'ok', visibleKind: 'moment', timeMs: eventTime };
    }
    return { kind: 'bad', state: quarantined('invalid-moment-time') };
  }
  const timeMs = clipTime + eventTime;
  if (!isWithinVideo(timeMs, duration)) {
    return { kind: 'bad', state: quarantined('moment-time-outside-video') };
  }
  return { kind: 'ok', visibleKind: 'moment', timeMs };
}

export function eventExtObject(event: EventItem): Record<string, unknown> | undefined {
  const ext = event.event_ext;
  if (!ext || typeof ext !== 'object' || Array.isArray(ext)) return undefined;
  return ext;
}

export function stringField(ext: Record<string, unknown>, key: string): string {
  const value = ext[key];
  return typeof value === 'string' ? value.trim() : '';
}

export function numberField(ext: Record<string, unknown>, key: string): number | undefined {
  return finiteNumber(ext[key]);
}

export function normalizeEventType(s: string): string {
  return s.trim().toLowerCase();
}

export function normalizeComparableName(s: string): string {
  return s.trim().toLowerCase();
}

export function parseAclLocalTime(value: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/.exec(value.trim());
  if (!m) return undefined;
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6]),
    Number((m[7] ?? '0').slice(0, 3).padEnd(3, '0')),
  ).getTime();
}

export function isWithinMatchWindow(eventTime: string, match: MatchRecord): boolean {
  const eventMs = parseAclLocalTime(eventTime);
  const startMs = parseAclLocalTime(match.gameStartTime);
  const endMs = parseAclLocalTime(match.gameEndTime);
  if (eventMs === undefined || startMs === undefined || endMs === undefined) {
    return false;
  }
  return eventMs >= startMs - 30_000 && eventMs <= endMs + 30_000;
}

function finiteNumber(value: unknown): number | undefined {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

function isWithinVideo(timeMs: number, durationMs: number): boolean {
  return timeMs >= 0 && timeMs <= durationMs;
}

function rejected(reason: string): EventState {
  return { kind: 'rejected', reason };
}

function quarantined(reason: string): EventState {
  return { kind: 'quarantined', reason };
}
