//! Data model for ACLOS WonderfulDb. Mirrors `packages/parser/src/model.ts`
//! so the GUI (which still imports the TS types from `@wonderful-ui/parser`)
//! sees the same shape on the IPC boundary.

use serde::{Deserialize, Deserializer, Serialize};
use std::collections::BTreeMap;

fn deser_str_or_num<'de, D: Deserializer<'de>>(d: D) -> Result<String, D::Error> {
    use serde::de;
    struct Visitor;
    impl<'de> de::Visitor<'de> for Visitor {
        type Value = String;
        fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
            f.write_str("a string or number")
        }
        fn visit_str<E: de::Error>(self, v: &str) -> Result<String, E> {
            Ok(v.to_owned())
        }
        fn visit_i64<E: de::Error>(self, v: i64) -> Result<String, E> {
            Ok(v.to_string())
        }
        fn visit_u64<E: de::Error>(self, v: u64) -> Result<String, E> {
            Ok(v.to_string())
        }
        fn visit_f64<E: de::Error>(self, v: f64) -> Result<String, E> {
            Ok(v.to_string())
        }
        fn visit_string<E: de::Error>(self, v: String) -> Result<String, E> {
            Ok(v)
        }
    }
    d.deserialize_any(Visitor)
}

fn deser_i64_or_str<'de, D: Deserializer<'de>>(d: D) -> Result<i64, D::Error> {
    use serde::de;
    struct Visitor;
    impl<'de> de::Visitor<'de> for Visitor {
        type Value = i64;
        fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
            f.write_str("an integer or integer string")
        }
        fn visit_i64<E: de::Error>(self, v: i64) -> Result<i64, E> {
            Ok(v)
        }
        fn visit_u64<E: de::Error>(self, v: u64) -> Result<i64, E> {
            i64::try_from(v).map_err(|_| E::custom(format!("integer out of range: {}", v)))
        }
        fn visit_f64<E: de::Error>(self, v: f64) -> Result<i64, E> {
            if v.is_finite() {
                Ok(v as i64)
            } else {
                Err(E::custom("non-finite number"))
            }
        }
        fn visit_str<E: de::Error>(self, v: &str) -> Result<i64, E> {
            v.parse::<i64>().map_err(E::custom)
        }
        fn visit_string<E: de::Error>(self, v: String) -> Result<i64, E> {
            self.visit_str(&v)
        }
    }
    d.deserialize_any(Visitor)
}

fn deser_option_i64_or_str<'de, D: Deserializer<'de>>(d: D) -> Result<Option<i64>, D::Error> {
    use serde::de;
    struct Visitor;
    impl<'de> de::Visitor<'de> for Visitor {
        type Value = Option<i64>;
        fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
            f.write_str("null, an integer, or integer string")
        }
        fn visit_none<E: de::Error>(self) -> Result<Option<i64>, E> {
            Ok(None)
        }
        fn visit_unit<E: de::Error>(self) -> Result<Option<i64>, E> {
            Ok(None)
        }
        fn visit_some<D2: Deserializer<'de>>(self, d: D2) -> Result<Option<i64>, D2::Error> {
            deser_i64_or_str(d).map(Some)
        }
    }
    d.deserialize_option(Visitor)
}

fn deser_bool_or_str<'de, D: Deserializer<'de>>(d: D) -> Result<bool, D::Error> {
    use serde::de;
    struct Visitor;
    impl<'de> de::Visitor<'de> for Visitor {
        type Value = bool;
        fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
            f.write_str("a bool, number, or bool string")
        }
        fn visit_bool<E: de::Error>(self, v: bool) -> Result<bool, E> {
            Ok(v)
        }
        fn visit_i64<E: de::Error>(self, v: i64) -> Result<bool, E> {
            Ok(v != 0)
        }
        fn visit_u64<E: de::Error>(self, v: u64) -> Result<bool, E> {
            Ok(v != 0)
        }
        fn visit_str<E: de::Error>(self, v: &str) -> Result<bool, E> {
            match v {
                "true" | "1" => Ok(true),
                "false" | "0" => Ok(false),
                _ => Err(E::custom(format!("invalid bool string: {}", v))),
            }
        }
        fn visit_string<E: de::Error>(self, v: String) -> Result<bool, E> {
            self.visit_str(&v)
        }
    }
    d.deserialize_any(Visitor)
}

fn deser_option_bool_or_str<'de, D: Deserializer<'de>>(d: D) -> Result<Option<bool>, D::Error> {
    use serde::de;
    struct Visitor;
    impl<'de> de::Visitor<'de> for Visitor {
        type Value = Option<bool>;
        fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
            f.write_str("null, a bool, number, or bool string")
        }
        fn visit_none<E: de::Error>(self) -> Result<Option<bool>, E> {
            Ok(None)
        }
        fn visit_unit<E: de::Error>(self) -> Result<Option<bool>, E> {
            Ok(None)
        }
        fn visit_some<D2: Deserializer<'de>>(self, d: D2) -> Result<Option<bool>, D2::Error> {
            deser_bool_or_str(d).map(Some)
        }
    }
    d.deserialize_option(Visitor)
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MatchMap {
    #[serde(default)]
    pub map_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub map_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub map_image: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Agent {
    #[serde(default)]
    pub agent_id: String,
    #[serde(default)]
    pub agent_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MatchStats {
    #[serde(default, deserialize_with = "deser_i64_or_str")]
    pub kills: i64,
    #[serde(default, deserialize_with = "deser_i64_or_str")]
    pub assists: i64,
    #[serde(default, deserialize_with = "deser_i64_or_str")]
    pub deaths: i64,
    #[serde(default, deserialize_with = "deser_i64_or_str")]
    pub score: i64,
    #[serde(default, deserialize_with = "deser_bool_or_str")]
    pub has_won: bool,
    #[serde(default)]
    pub mode_name: String,
    #[serde(default, deserialize_with = "deser_i64_or_str")]
    pub rounds_won: i64,
    #[serde(default, deserialize_with = "deser_i64_or_str")]
    pub rounds_lost: i64,
    #[serde(default)]
    pub game_level: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VideoItem {
    #[serde(default)]
    pub video_id: String,
    #[serde(
        rename = "video_isProcessing",
        alias = "video_is_processing",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub video_is_processing: Option<bool>,
    #[serde(default)]
    pub video_src: String,
    #[serde(default, deserialize_with = "deser_i64_or_str")]
    pub video_duration: i64,
    #[serde(default, deserialize_with = "deser_i64_or_str")]
    pub video_fps: i64,
    #[serde(default)]
    pub video_resolution: String,
    #[serde(default)]
    pub video_name: String,
    #[serde(default)]
    pub video_poster: String,
    #[serde(default)]
    pub video_ext: String,
    #[serde(default, deserialize_with = "deser_i64_or_str")]
    pub video_time: i64,
    #[serde(default, deserialize_with = "deser_i64_or_str")]
    pub video_size: i64,
    #[serde(default)]
    pub video_level: String,
    #[serde(default)]
    pub video_type: String,
    #[serde(default)]
    pub video_hash: String,
    #[serde(default)]
    pub cover_hash: String,
    #[serde(default)]
    pub template_id: String,
    #[serde(
        default,
        deserialize_with = "deser_option_i64_or_str",
        skip_serializing_if = "Option::is_none"
    )]
    pub clips_count: Option<i64>,
    #[serde(
        default,
        deserialize_with = "deser_option_bool_or_str",
        skip_serializing_if = "Option::is_none"
    )]
    pub is_upload: Option<bool>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rounds: Vec<RoundItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct EventItem {
    #[serde(default)]
    pub event_id: String,
    #[serde(rename = "event_sTime", default, deserialize_with = "deser_i64_or_str")]
    pub event_s_time: i64,
    #[serde(default)]
    pub event_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub event_ext: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RoundClip {
    #[serde(default)]
    pub clip_id: String,
    #[serde(default, deserialize_with = "deser_i64_or_str")]
    pub clip_duration: i64,
    #[serde(rename = "clip_sTime", default, deserialize_with = "deser_i64_or_str")]
    pub clip_s_time: i64,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub clip_events: Vec<EventItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RoundHonor {
    #[serde(default)]
    pub honor_id: String,
    #[serde(default)]
    pub honor_name: String,
    #[serde(default)]
    pub honor_time: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RoundItem {
    #[serde(deserialize_with = "deser_str_or_num", default)]
    pub round_id: String,
    #[serde(default, deserialize_with = "deser_i64_or_str")]
    pub round_duration: i64,
    #[serde(rename = "round_sTime", default, deserialize_with = "deser_i64_or_str")]
    pub round_s_time: i64,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub round_clips: Vec<RoundClip>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub round_honors: Vec<RoundHonor>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MatchRecord {
    #[serde(default)]
    pub matches_id: String,
    #[serde(default, deserialize_with = "deser_i64_or_str")]
    pub matches_time: i64,
    #[serde(default)]
    pub map: MatchMap,
    #[serde(default)]
    pub agent: Agent,
    #[serde(default)]
    pub stats: MatchStats,
    #[serde(rename = "openID", default)]
    pub open_id: String,
    #[serde(default)]
    pub mode: String,
    #[serde(rename = "minRoundId", default, deserialize_with = "deser_i64_or_str")]
    pub min_round_id: i64,
    #[serde(rename = "gameStartTime", default)]
    pub game_start_time: String,
    #[serde(rename = "gameEndTime", default)]
    pub game_end_time: String,
    #[serde(default)]
    pub videos: Vec<VideoItem>,
    /// Anything else ACLOS stuffs into the match object. Same shape as the
    /// TS parser's `extras` field. Captured via `#[serde(flatten)]` so it
    /// round-trips with the original key set.
    #[serde(flatten, default, skip_serializing_if = "BTreeMap::is_empty")]
    pub extras: BTreeMap<String, serde_json::Value>,
}

/// Drop the per-round kill/death event data from every match's videos.
///
/// `scan_all` / `load_library` can return hundreds of matches; carrying the
/// full `rounds` tree for each one bloats the IPC payload from ~50 KB/account
/// to ~6 MB/account. The GUI only needs the event data when the user opens a
/// single match, so the dedicated `get_match_rounds` command reads one full
/// match from SQLite with rounds intact.
pub fn strip_match_rounds(matches: &mut [MatchRecord]) {
    for m in matches {
        for v in &mut m.videos {
            v.rounds.clear();
        }
    }
}

/// Per-account result of scanning one WonderfulDb file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub openid: String,
    pub path: String,
    pub match_count: usize,
    /// In-game display name from the snapshot file, e.g. "超雄小猫咪".
    /// `None` when the snapshot file is missing, empty, or has no records.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nick: Option<String>,
    /// Riot-style short ID / 编号 from `snapshot.ss_nick_id`, e.g. "13949".
    /// Display format: `<nick>#<tag>`. `None` when no snapshot is available.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tag: Option<String>,
    /// WonderfulUI-local display override. Does not write to ACLOS snapshot
    /// data and can be cleared to fall back to `nick` / `tag`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_name: Option<String>,
    /// Per-match MVP/SVP achievements from the snapshot file. Empty when the
    /// snapshot file is missing / empty / has no `match`-type records.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub achievements: Vec<SnapshotAchievement>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Match-level achievement: MVP or SVP from `snapshot.ss_achieve_type`.
/// Only `"mvp"` and `"svp"` values are collected; empty strings are skipped.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotAchievement {
    /// Matches `MatchRecord.matches_id` in the main wonderful-list.
    #[serde(default)]
    pub matches_id: String,
    /// "mvp" or "svp".
    #[serde(default)]
    pub achv_type: String,
    /// Chinese display label, e.g. "MVP" / "SVP" (from `ss_type_str`).
    #[serde(default)]
    pub type_str: String,
}

/// Top-level result of `scan_all`. Mirrors the GUI's `LoadResult` interface.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadResult {
    pub dir: String,
    pub accounts: Vec<Account>,
    pub matches: Vec<MatchRecord>,
    pub total_errors: usize,
}

/// Internal: full parse output for a single file (raw + matches).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WonderfulDbFile {
    pub key: String,
    pub matches: Vec<MatchRecord>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw: Option<serde_json::Value>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_match_rounds_empties_all_video_rounds() {
        let m = MatchRecord {
            matches_id: "m1".into(),
            videos: vec![
                VideoItem {
                    video_id: "v1".into(),
                    rounds: vec![RoundItem {
                        round_id: "0".into(),
                        round_s_time: 1000,
                        ..Default::default()
                    }],
                    ..Default::default()
                },
                VideoItem {
                    video_id: "v2".into(),
                    rounds: vec![RoundItem {
                        round_id: "0".into(),
                        round_s_time: 2000,
                        ..Default::default()
                    }],
                    ..Default::default()
                },
            ],
            ..Default::default()
        };
        let mut owned = m;
        strip_match_rounds(std::slice::from_mut(&mut owned));
        assert!(owned.videos[0].rounds.is_empty());
        assert!(owned.videos[1].rounds.is_empty());
    }

    #[test]
    fn strip_match_rounds_serialize_drops_empty() {
        // After stripping, serializing the match should not emit `"rounds": []`
        // for each video. (skip_serializing_if = "Vec::is_empty".)
        let mut m = MatchRecord {
            matches_id: "m1".into(),
            videos: vec![VideoItem {
                video_id: "v1".into(),
                rounds: vec![RoundItem::default()],
                ..Default::default()
            }],
            ..Default::default()
        };
        strip_match_rounds(std::slice::from_mut(&mut m));
        let value = serde_json::to_value(&m).unwrap();
        let v0 = &value["videos"][0];
        assert!(
            v0.get("rounds").is_none(),
            "rounds should be omitted: {}",
            v0
        );
    }

    #[test]
    fn deserializes_aclos_numeric_strings_like_ts_parser() {
        let video: VideoItem = serde_json::from_value(serde_json::json!({
            "video_duration": "120000",
            "video_fps": "60",
            "video_time": "1710000000000",
            "video_size": "2048",
            "clips_count": "3",
            "is_upload": "1",
            "rounds": [{
                "round_id": 7,
                "round_duration": "45000",
                "round_sTime": "30000",
                "round_clips": [{
                    "clip_id": "c1",
                    "clip_duration": "12000",
                    "clip_sTime": "30000",
                    "clip_events": [{
                        "event_id": "e1",
                        "event_sTime": "2500",
                        "event_type": "kill"
                    }]
                }]
            }]
        }))
        .expect("ACLOS sometimes serializes numeric fields as strings");

        assert_eq!(video.video_duration, 120000);
        assert_eq!(video.video_fps, 60);
        assert_eq!(video.video_time, 1710000000000);
        assert_eq!(video.video_size, 2048);
        assert_eq!(video.clips_count, Some(3));
        assert_eq!(video.is_upload, Some(true));
        assert_eq!(video.rounds[0].round_id, "7");
        assert_eq!(video.rounds[0].round_duration, 45000);
        assert_eq!(video.rounds[0].round_s_time, 30000);
        assert_eq!(video.rounds[0].round_clips[0].clip_duration, 12000);
        assert_eq!(video.rounds[0].round_clips[0].clip_s_time, 30000);
        assert_eq!(
            video.rounds[0].round_clips[0].clip_events[0].event_s_time,
            2500
        );
    }

    #[test]
    fn snapshot_achievement_serializes_camelcase() {
        let achv = SnapshotAchievement {
            matches_id: "m1".into(),
            achv_type: "mvp".into(),
            type_str: "MVP".into(),
        };
        let v = serde_json::to_value(&achv).unwrap();
        assert_eq!(
            v["matchesId"].as_str(),
            Some("m1"),
            "key should be matchesId, got {:?}",
            v
        );
        assert_eq!(
            v["achvType"].as_str(),
            Some("mvp"),
            "key should be achvType"
        );
        assert_eq!(v["typeStr"].as_str(), Some("MVP"), "key should be typeStr");
        // Ensure snake_case keys are absent
        assert!(
            v.get("matches_id").is_none(),
            "snake_case matches_id should be absent"
        );
        assert!(
            v.get("achv_type").is_none(),
            "snake_case achv_type should be absent"
        );
        assert!(
            v.get("type_str").is_none(),
            "snake_case type_str should be absent"
        );
    }
}
