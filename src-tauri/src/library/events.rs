use crate::parser::model::{EventItem, MatchRecord, VideoItem};

const EVENT_TIME_TOLERANCE_MS: i64 = 30_000;
const EVENT_PREROLL_MS: i64 = 2_000;

#[derive(Debug, Clone)]
pub struct NormalizedEvent {
    pub time_ms: i64,
    pub seek_ms: i64,
    pub playback_seek_ms: i64,
    pub event_type: String,
    pub video_id: String,
    pub round_idx: usize,
    pub player_name: String,
    pub killer_name: String,
    pub killed_name: String,
    pub agent_name: String,
    pub weapon_path: String,
    pub weapon_name: String,
    pub is_headshot: bool,
    pub assist_num: i64,
    pub source_event_id: String,
    pub event_time: Option<String>,
    pub dedup_key: String,
    pub raw_json: Option<String>,
    candidate_score: i64,
}

pub fn normalize_match_events(m: &MatchRecord) -> Vec<NormalizedEvent> {
    let mut events_by_key = std::collections::BTreeMap::<String, NormalizedEvent>::new();

    for video in &m.videos {
        for (round_idx, round) in video.rounds.iter().enumerate() {
            for clip in &round.round_clips {
                for ev in &clip.clip_events {
                    let event_type = normalize_event_type(&ev.event_type);
                    if event_type != "kill" && event_type != "death" {
                        continue;
                    }

                    let ext = ev.event_ext.as_ref().and_then(|value| value.as_object());
                    let Some(state) = resolve_event_state(m, video, clip, ev, &event_type, ext)
                    else {
                        continue;
                    };
                    let killer_name = string_field(ext, "KillerPlayerName");
                    let killed_name = string_field(ext, "KilledPlayerName");
                    let norm_killer = normalize_name(&killer_name);
                    let norm_killed = normalize_name(&killed_name);
                    let weapon_path = string_field(ext, "WeaponSkinName");
                    let dedup_key = event_dedup_key(
                        &event_type,
                        &state.event_time,
                        state.time_ms,
                        &norm_killer,
                        &norm_killed,
                        &weapon_path,
                    );
                    let raw_json = serde_json::to_string(ev).ok();
                    let mut candidate = NormalizedEvent {
                        time_ms: state.time_ms,
                        seek_ms: state.seek_ms,
                        playback_seek_ms: state.playback_seek_ms,
                        event_type: event_type.clone(),
                        video_id: video.video_id.clone(),
                        round_idx,
                        player_name: if event_type == "kill" {
                            killed_name.clone()
                        } else {
                            killer_name.clone()
                        },
                        killer_name,
                        killed_name,
                        agent_name: string_field(ext, "AgentName"),
                        weapon_name: weapon_fallback_name(&weapon_path),
                        weapon_path,
                        is_headshot: state.is_headshot,
                        assist_num: state.assist_num,
                        source_event_id: ev.event_id.clone(),
                        event_time: if state.event_time.is_empty() {
                            None
                        } else {
                            Some(state.event_time)
                        },
                        dedup_key: dedup_key.clone(),
                        raw_json,
                        candidate_score: 0,
                    };
                    candidate.candidate_score = event_candidate_score(&candidate, video);

                    match events_by_key.get(&dedup_key) {
                        Some(prev) if candidate.candidate_score <= prev.candidate_score => {}
                        _ => {
                            events_by_key.insert(dedup_key, candidate);
                        }
                    }
                }
            }
        }
    }

    let mut events = events_by_key.into_values().collect::<Vec<_>>();
    events.sort_by_key(|ev| ev.time_ms);
    events
}

#[derive(Debug)]
struct ResolvedEventState {
    time_ms: i64,
    seek_ms: i64,
    playback_seek_ms: i64,
    is_headshot: bool,
    assist_num: i64,
    event_time: String,
}

fn resolve_event_state(
    m: &MatchRecord,
    video: &VideoItem,
    clip: &crate::parser::model::RoundClip,
    ev: &EventItem,
    event_type: &str,
    ext: Option<&serde_json::Map<String, serde_json::Value>>,
) -> Option<ResolvedEventState> {
    let event_name = string_field(ext, "EventName");
    if event_name.is_empty() || !event_name.eq_ignore_ascii_case("shot") {
        return None;
    }
    if string_field(ext, "KillerPlayerName").is_empty()
        || string_field(ext, "KilledPlayerName").is_empty()
    {
        return None;
    }

    let event_agent = normalize_comparable_name(&string_field(ext, "AgentName"));
    let match_agent = normalize_comparable_name(&m.agent.agent_name);
    if event_agent.is_empty() || match_agent.is_empty() || event_agent != match_agent {
        return None;
    }

    let event_time = string_field(ext, "EventTime");
    if event_time.is_empty() || !is_within_match_window(&event_time, m) {
        return None;
    }

    let killer_is_me = number_field(ext, "KillerIsMe");
    let killed_is_me = number_field(ext, "KilledIsMe");
    if event_type == "kill" {
        if killer_is_me != Some(1) || killed_is_me != Some(0) {
            return None;
        }
    } else if killed_is_me != Some(1) || killer_is_me != Some(0) {
        return None;
    }

    let shot_part = number_field(ext, "GetShotRolePart")?;
    let time_ms = resolve_video_time(video, clip, ev, event_type)?;
    Some(ResolvedEventState {
        time_ms,
        seek_ms: time_ms,
        playback_seek_ms: (time_ms - EVENT_PREROLL_MS).max(0),
        is_headshot: shot_part == 1,
        assist_num: number_field(ext, "AssistNum").unwrap_or(0),
        event_time,
    })
}

fn resolve_video_time(
    video: &VideoItem,
    clip: &crate::parser::model::RoundClip,
    ev: &EventItem,
    event_type: &str,
) -> Option<i64> {
    let duration = video.video_duration;
    if duration <= 0 || ev.event_s_time < 0 {
        return None;
    }
    let is_kill_montage = video.video_type == "击杀集锦";
    let is_death_montage = video.video_type == "死亡集锦";
    if is_kill_montage || is_death_montage {
        if (is_kill_montage && event_type != "kill")
            || (is_death_montage && event_type != "death")
        {
            return None;
        }
        return is_within_video(ev.event_s_time, duration).then_some(ev.event_s_time);
    }

    // Moment clips (三杀时刻 / etc.): only kills are playable.
    // Align with TS event-state-machine: when clip_sTime is missing/negative,
    // fall back to event_sTime alone if it still lies inside the video.
    if event_type != "kill" {
        return None;
    }
    if clip.clip_s_time < 0 {
        return is_within_video(ev.event_s_time, duration).then_some(ev.event_s_time);
    }
    let time_ms = clip.clip_s_time + ev.event_s_time;
    is_within_video(time_ms, duration).then_some(time_ms)
}

fn is_within_video(time_ms: i64, duration_ms: i64) -> bool {
    time_ms >= 0 && time_ms <= duration_ms
}

fn string_field(ext: Option<&serde_json::Map<String, serde_json::Value>>, key: &str) -> String {
    ext.and_then(|obj| obj.get(key))
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn number_field(
    ext: Option<&serde_json::Map<String, serde_json::Value>>,
    key: &str,
) -> Option<i64> {
    let value = ext.and_then(|obj| obj.get(key))?;
    if let Some(n) = value.as_i64() {
        return Some(n);
    }
    if let Some(n) = value.as_u64() {
        return i64::try_from(n).ok();
    }
    if let Some(n) = value.as_f64() {
        return n.is_finite().then_some(n as i64);
    }
    value.as_str()?.parse::<f64>().ok().and_then(
        |n| {
            if n.is_finite() {
                Some(n as i64)
            } else {
                None
            }
        },
    )
}

fn normalize_event_type(s: &str) -> String {
    s.trim().to_ascii_lowercase()
}

fn normalize_name(s: &str) -> String {
    let trimmed = s.trim();
    let without_tag = trimmed
        .split_once('#')
        .map(|(name, _)| name)
        .unwrap_or(trimmed);
    without_tag.trim().to_lowercase()
}

fn normalize_comparable_name(s: &str) -> String {
    s.trim().to_lowercase()
}

fn event_second_key(event_time: &str) -> String {
    if parse_acl_local_time_ms(event_time).is_none() {
        return String::new();
    }
    event_time
        .trim()
        .replace('T', " ")
        .chars()
        .take(19)
        .collect()
}

fn weapon_key(weapon_path: &str) -> String {
    weapon_path
        .split('/')
        .last()
        .unwrap_or(weapon_path)
        .strip_suffix("_PrimaryAsset_C")
        .unwrap_or_else(|| weapon_path.split('/').last().unwrap_or(weapon_path))
        .replace('.', "")
}

fn weapon_fallback_name(weapon_path: &str) -> String {
    weapon_key(weapon_path).replace('_', " ")
}

fn event_dedup_key(
    event_type: &str,
    event_time: &str,
    time_ms: i64,
    norm_killer: &str,
    norm_killed: &str,
    weapon_path: &str,
) -> String {
    let type_key = if event_type == "death" { "D" } else { "K" };
    let event_identity = if event_type == "death" {
        norm_killer
    } else {
        norm_killed
    };
    let second_key = event_second_key(event_time);
    if !second_key.is_empty() && !event_identity.is_empty() {
        return format!("{type_key}|{second_key}|{event_identity}");
    }
    format!(
        "{}|{}|{}|{}|{}|{}",
        type_key,
        if second_key.is_empty() {
            "no-time"
        } else {
            second_key.as_str()
        },
        if norm_killer.is_empty() {
            "unknown-killer"
        } else {
            norm_killer
        },
        if norm_killed.is_empty() {
            "unknown-victim"
        } else {
            norm_killed
        },
        time_ms.div_euclid(250),
        weapon_key(weapon_path)
    )
}

fn event_candidate_score(ev: &NormalizedEvent, video: &VideoItem) -> i64 {
    let duration = video.video_duration;
    let has_duration = duration > 0;
    let primary_seekable = has_duration && ev.time_ms >= 0 && ev.time_ms <= duration;
    let any_seekable = has_duration && ev.seek_ms >= 0 && ev.seek_ms <= duration;
    let is_kill_montage = video.video_type == "击杀集锦";
    let is_death_montage = video.video_type == "死亡集锦";
    let is_moment_clip = !is_kill_montage && !is_death_montage;
    let matching_montage = (ev.event_type == "kill" && is_kill_montage)
        || (ev.event_type == "death" && is_death_montage);

    (if any_seekable { 1_000_000_000 } else { 0 })
        + (if matching_montage { 500_000_000 } else { 0 })
        + (if primary_seekable { 100_000_000 } else { 0 })
        + (if is_moment_clip { 1_000_000 } else { 0 })
        + if has_duration {
            duration.min(999_999)
        } else {
            0
        }
}

fn is_within_match_window(event_time: &str, m: &MatchRecord) -> bool {
    if event_time.is_empty() {
        return false;
    }
    let Some(event_ms) = parse_acl_local_time_ms(event_time) else {
        return false;
    };
    let Some(start_ms) = parse_acl_local_time_ms(&m.game_start_time) else {
        return false;
    };
    let Some(end_ms) = parse_acl_local_time_ms(&m.game_end_time) else {
        return false;
    };
    event_ms >= start_ms - EVENT_TIME_TOLERANCE_MS && event_ms <= end_ms + EVENT_TIME_TOLERANCE_MS
}

fn parse_acl_local_time_ms(value: &str) -> Option<i64> {
    let s = value.trim();
    if s.len() < 19 {
        return None;
    }
    let year = parse_digits(s, 0, 4)?;
    let month = parse_digits(s, 5, 7)?;
    let day = parse_digits(s, 8, 10)?;
    let hour = parse_digits(s, 11, 13)?;
    let minute = parse_digits(s, 14, 16)?;
    let second = parse_digits(s, 17, 19)?;
    if s.as_bytes().get(4) != Some(&b'-')
        || s.as_bytes().get(7) != Some(&b'-')
        || !matches!(s.as_bytes().get(10), Some(&b' ') | Some(&b'T'))
        || s.as_bytes().get(13) != Some(&b':')
        || s.as_bytes().get(16) != Some(&b':')
    {
        return None;
    }
    let millis = parse_millis(s.get(19..).unwrap_or_default())?;
    let days = days_from_civil(year, month, day);
    Some((((days * 24 + hour) * 60 + minute) * 60 + second) * 1000 + millis)
}

fn parse_digits(s: &str, start: usize, end: usize) -> Option<i64> {
    let part = s.get(start..end)?;
    if !part.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    part.parse::<i64>().ok()
}

fn parse_millis(rest: &str) -> Option<i64> {
    if rest.is_empty() {
        return Some(0);
    }
    if !rest.starts_with('.') {
        return Some(0);
    }
    let digits = rest[1..]
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .take(3)
        .collect::<String>();
    if digits.is_empty() {
        return Some(0);
    }
    let padded = format!("{digits:0<3}");
    padded.parse::<i64>().ok()
}

fn days_from_civil(mut year: i64, month: i64, day: i64) -> i64 {
    year -= if month <= 2 { 1 } else { 0 };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let yoe = year - era * 400;
    let month_prime = month + if month > 2 { -3 } else { 9 };
    let doy = (153 * month_prime + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::model::{Agent, EventItem, RoundClip, RoundItem};

    fn shot_ext(overrides: serde_json::Value) -> serde_json::Value {
        let mut base = serde_json::json!({
            "EventName": "Shot",
            "EventTime": "2026-06-08 21:56:19.043",
            "AgentName": "Cypher",
            "KillerPlayerName": "me",
            "KilledPlayerName": "enemy",
            "KillerIsMe": 1,
            "KilledIsMe": 0,
            "GetShotRolePart": 1,
            "AssistNum": 0,
            "WeaponSkinName": "Vandal"
        });
        let base_obj = base.as_object_mut().expect("base object");
        for (key, value) in overrides.as_object().expect("override object") {
            base_obj.insert(key.clone(), value.clone());
        }
        base
    }

    fn event(id: &str, event_s_time: i64, event_type: &str, ext: serde_json::Value) -> EventItem {
        EventItem {
            event_id: id.into(),
            event_s_time,
            event_type: event_type.into(),
            event_ext: Some(ext),
        }
    }

    fn video_with_rounds(video_type: &str, duration: i64, rounds: Vec<RoundItem>) -> VideoItem {
        VideoItem {
            video_id: "v1".into(),
            video_type: video_type.into(),
            video_duration: duration,
            rounds,
            ..Default::default()
        }
    }

    fn match_with_videos(videos: Vec<VideoItem>) -> MatchRecord {
        MatchRecord {
            agent: Agent {
                agent_name: "Cypher".into(),
                ..Default::default()
            },
            game_start_time: "2026-06-08 21:55:16.535".into(),
            game_end_time: "2026-06-08 22:28:20.968".into(),
            videos,
            ..Default::default()
        }
    }

    #[test]
    fn montage_events_use_event_s_time_directly() {
        let m = match_with_videos(vec![video_with_rounds(
            "击杀集锦",
            140_000,
            vec![RoundItem {
                round_s_time: 70_000,
                round_clips: vec![RoundClip {
                    clip_s_time: 70_000,
                    clip_events: vec![event("montage", 130_000, "kill", shot_ext(serde_json::json!({})))],
                    ..Default::default()
                }],
                ..Default::default()
            }],
        )]);

        let events = normalize_match_events(&m);

        assert_eq!(events.len(), 1);
        assert_eq!(events[0].time_ms, 130_000);
        assert_eq!(events[0].seek_ms, 130_000);
    }

    #[test]
    fn moment_events_use_clip_time_plus_event_s_time() {
        let m = match_with_videos(vec![video_with_rounds(
            "三杀时刻",
            30_000,
            vec![RoundItem {
                round_s_time: 0,
                round_clips: vec![RoundClip {
                    clip_s_time: 11_000,
                    clip_events: vec![event("moment", 6_000, "kill", shot_ext(serde_json::json!({})))],
                    ..Default::default()
                }],
                ..Default::default()
            }],
        )]);

        let events = normalize_match_events(&m);

        assert_eq!(events.len(), 1);
        assert_eq!(events[0].time_ms, 17_000);
    }

    #[test]
    fn quarantines_incomplete_shot_like_events() {
        let m = match_with_videos(vec![video_with_rounds(
            "击杀集锦",
            30_000,
            vec![RoundItem {
                round_clips: vec![RoundClip {
                    clip_events: vec![event(
                        "missing-event-time",
                        6_000,
                        "kill",
                        shot_ext(serde_json::json!({ "EventTime": null })),
                    )],
                    ..Default::default()
                }],
                ..Default::default()
            }],
        )]);

        let events = normalize_match_events(&m);

        assert!(events.is_empty());
    }

    #[test]
    fn rejects_video_type_event_type_mismatches() {
        let m = match_with_videos(vec![video_with_rounds(
            "击杀集锦",
            30_000,
            vec![RoundItem {
                round_clips: vec![RoundClip {
                    clip_events: vec![event(
                        "death-in-kill-montage",
                        6_000,
                        "death",
                        shot_ext(serde_json::json!({
                            "KillerPlayerName": "enemy",
                            "KilledPlayerName": "me",
                            "KillerIsMe": 0,
                            "KilledIsMe": 1
                        })),
                    )],
                    ..Default::default()
                }],
                ..Default::default()
            }],
        )]);

        let events = normalize_match_events(&m);

        assert!(events.is_empty());
    }

    #[test]
    fn normalizes_event_type_and_agent_names() {
        let mut m = match_with_videos(vec![video_with_rounds(
            "击杀集锦",
            30_000,
            vec![RoundItem {
                round_clips: vec![RoundClip {
                    clip_events: vec![event(
                        "case-and-space",
                        1_000,
                        "Kill",
                        shot_ext(serde_json::json!({ "AgentName": "Cypher " })),
                    )],
                    ..Default::default()
                }],
                ..Default::default()
            }],
        )]);
        m.agent.agent_name = " cypher ".into();

        let events = normalize_match_events(&m);

        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, "kill");
        assert_eq!(events[0].source_event_id, "case-and-space");
    }

    /// Mirrors TS `event-state-machine.ts`: when moment clip_sTime is negative,
    /// fall back to event_sTime alone if it still lies inside the video.
    #[test]
    fn moment_events_with_negative_clip_s_time_fall_back_to_event_s_time() {
        let m = match_with_videos(vec![video_with_rounds(
            "三杀时刻",
            30_000,
            vec![RoundItem {
                round_s_time: 0,
                round_clips: vec![RoundClip {
                    clip_s_time: -1,
                    clip_events: vec![event("neg-clip", 6_000, "kill", shot_ext(serde_json::json!({})))],
                    ..Default::default()
                }],
                ..Default::default()
            }],
        )]);

        let events = normalize_match_events(&m);

        assert_eq!(events.len(), 1);
        assert_eq!(events[0].time_ms, 6_000);
        assert_eq!(events[0].seek_ms, 6_000);
    }
}
