class VideoItem {
  /** 视频id */
  video_id = '';
  /** 是否在合成处理中 */
  video_isProcessing = false;
  /** 视频地址 */
  video_src = '';
  /** 视频时长 */
  video_duration = 0;
  /** 视频帧率 */
  video_fps = 0;
  /** 视频宽高 */
  video_resolution = '';
  /** 视频名 */
  video_name = '';
  /** 视频封面图 */
  video_poster = '';
  /** 视频格式 */
  video_ext = '';
  /** 视频时间 */
  video_time = new Date().getTime();
  /** 视频容量 */
  video_size = 0;
  /** 当前的视频清晰度 */
  video_level = '';
  /** 类型（全场/合集） */
  video_type = '';
  /** 视频MD5 */
  video_hash = '';
  /** 图片MD5 */
  cover_hash = '';
  /** 模版id */
  template_id = '';
}

class SnapshotItem {
  /** 截图id */
  ss_id = '';
  /** 截图时间 */
  ss_time = 0;
  /** 包装截图地址 */
  ss_package_src = "";
  /** 包装缩略图本地地址 */
  ss_thumb_src = "";
  /** 缩略图cos地址 */
  ss_thumb_path = "";
  /** cos存储地址 */
  ss_cos_path = "";
  /** 截图名 */
  ss_name = "";
  /** 截图宽度 */
  ss_width = 0;
  /** 截图高度 */
  ss_height = 0;
  /** 截图格式 */
  ss_ext = "jpeg";
  /** 截图容量 */
  ss_size = 0;
  /** 截图类型（ 1）手动截图(hotkey)；2）局内(match)；3）夜市翻牌(night)） */
  ss_type = "";
  /** 截图类型提示文案 */
  ss_type_str = "";
  /** 游戏玩家昵称 */
  ss_nick = "";
  /** 游戏玩家昵称-id */
  ss_nick_id = "";
  /** 夜市，皮肤列表 */
    //{
    //       skin_level_id: '',
    //       skin_discount_percent: 0
    //     }
  ss_skin_list = [];
  /**单据内击杀信息*/
    //{
    //       killNum: 3,
    //       count: 2,
    //     }
  ss_kill_list = [];
  /**局内的成就，mvp，svp，""*/
  ss_achieve_type = '';
  /** 截图是否已下载 */
  ss_downloaded = true;
  /** 截图是否已上传 */
  ss_upload = false;
  /** 最终展示截图的hash */
  ss_package_hash = "";
  /** 最终展示缩略图的hash */
  ss_thumb_hash = "";
  /** 升段事件的段位信息 */
  ss_tier_data = {tierBefore: 0, tierAfter: 0};
}

class VideoDetail extends VideoItem {
  /** 视频片段数；（可以从列表中计算） */
  clips_count = 0;
  /** 回合列表 */
  rounds = [];
  /** 是否上传 */
  is_upload = false;
}


class MatchesStats {
  /** 击杀数 */
  kills = 0;
  /** 辅助数 */
  assists = 0;
  /** 死亡数 */
  deaths = 0;
  /** 对局得分 */
  score = 0;
  /** 是否赢 */
  has_won = true;
  /** 对局模式 */
  mode_name = "";
  /** 赢回合数 */
  rounds_won = 0;
  /** 输回合数 （计算比分） */
  rounds_lost = 0;
  /** 当前对局的玩家等级 */
  game_level = '';
}

class Agent {
  /** Agent id */
  agent_id = '';
  /** Agent 名 */
  agent_name = '';
}

class RoundItem {
  /** 回合 id */
  round_id = '';
  /** 回合时长 (可通过计算round_clips的总时长) */
  round_duration = 0;
  /** 回合开始时间 */
  round_sTime = 0;
  /** 回合的片段 */
  round_clips = [];
  /** 回合的荣誉事件 RoundHonor */
  round_honors = [];
  /** 扩展字段用于移动端创编*/
  round_ext = {};
}

class RoundClip {
  /** 片段 id */
  clip_id = '';
  /** 片段时长 */
  clip_duration = 0;
  /** 片段开始时间 */
  clip_sTime = 0;
  /** 片段中的事件（如果有多个事件，前端显示合并事件数） */
  clip_events = [];
}

class RoundHonor {
  /** 荣誉 id */
  honor_id = '';
  /** 荣誉名称 */
  honor_name = '';
  /** 荣誉发生时间 */
  honor_time = '';
}

class EventItem {
  /** 事件id */
  event_id = '';
  /** 事件开始时间 */
  event_sTime = 0;
  /** 事件类型 */
  event_type = "death" | "kill";
  /** 扩展字段用于移动端创编*/
  event_ext = {};
}

class MatchMap {
  map_id = '';
}


class Match {
  matches_id = "";
  matches_time = 0;
  stats = new MatchesStats();
  map = new MatchMap();
  agent = new Agent();
  
  //对局视频列表，一个对局里面可能有多个原始视频
  videos = []; // VideoDetail
}

module.exports = {
  VideoDetail,
  MatchesStats,
  Agent,
  EventItem,
  RoundItem,
  VideoItem,
  RoundClip,
  RoundHonor,
  Match,
  MatchMap,
  SnapshotItem,
};
