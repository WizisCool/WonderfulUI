# ACLOS 数据格式说明

本文档记录解析器和 GUI 需要长期维护的 ACLOS/WonderfulDb 事实。它是技术参考，不是
普通用户的产品介绍。

## 只读边界

- `WonderfulDb` 和 `snapshot<openid>` 是 ACLOS 的本地缓存输入；解析器只读，不写入、
  重命名、截断或删除它们。
- 不要读取、修改或删除 Riot、WeGame、Valorant、Vanguard 或游戏安装文件来“修复”解析。
- ACLOS 写入期间可能出现不完整文件；遇到解析失败应保留错误并允许用户稍后重试，不能
  用破坏源文件的方式恢复。

## 输入位置和账户枚举

GUI 后端只从用户 profile 推导 ACLOS 默认目录：

```text
%USERPROFILE%\AppData\Roaming\ACLOS\WonderfulDb
```

`HOME` 是非 Windows 测试环境的回退。GUI 当前没有自定义目录选择器；CLI 的 `scan`、
`show` 和 `scan-all` 可以接收显式路径，便于开发和测试。

目录中的账户主文件是没有扩展名、basename 为非空 ASCII 十进制 openid 的普通文件。
目录、符号链接、隐藏说明文件和其它非数字文件不能成为账户。相邻的
`snapshot<openid>` 是可选输入，缺失、为空、损坏或无法解密都不能阻塞高光列表。

与具体用户机器有关的路径、openid、昵称、标签和视频位置不属于格式契约，不能写进
产品逻辑、文档示例或测试特判。

## 编码和解密

已观察到的 ACLOS 数据（包括 2.15.3.449 时代的格式）具有以下形态；版本号是兼容性
观察，不是用户必须安装的 WonderfulUI 版本要求：

1. 文件正文是 `0-9`/`a-f` 的 ASCII 十六进制文本；
2. 十六进制解码后得到 AES-256-CBC 密文，使用 PKCS#7 padding；
3. key/IV 由 account openid 的 SHA-256 十六进制结果派生，具体实现见
   `src-tauri/src/parser/crypto.rs` 和 `packages/parser/src/crypto.ts`；
4. 主文件明文包含 `key_wonderful_list_<openid>`，值是对局数组；
5. snapshot 明文包含 `key_snapshot_list<openid>`，字段子集见 parser model。

Rust parser 是 GUI 的运行时实现；TypeScript parser 仍用于 CLI 和 Bun 测试。两者应
保持相同的字段语义和错误处理，不要让 Tauri command handler 直接绕过 parser 读取源文件。

## 昵称、标签和成就

账户显示名优先来自 ACLOS 身份缓存和 `snapshot<openid>` 的 `ss_nick`/`ss_nick_id`，
再回退到日志/原始 ID 的通用解析，最后才显示 openid 或匿名占位。优先选择带最新
`matches_time`（没有时用 `ss_time`）的记录，避免旧昵称覆盖新昵称。

MVP/SVP 来自 snapshot 的 `ss_type === "match"` 记录：

- `ss_achieve_type` 为 `mvp` 或 `svp`；
- `ss_type_str` 是显示标签；
- `matches_id` 用于连接对局。

snapshot 是可选且有历史缺口的数据源。不能把缺失成就解释成没有成就，也不能把它用于
账户统计、胜率、排序、导出或跨对局聚合；UI 只允许在资料存在时显示并筛选。

## 展示字段和离线资源

已知地图、英雄和模式通过生成的本地 registry 解析名称和图片，避免相同实体受单条
ACLOS 记录影响而出现不同标签。未知实体可以显示 ACLOS 的通用 fallback，但不能为单个
账户或样本添加分支。

- 资源 registry：`packages/gui/src/utils/generated/valorant-metadata.zh-CN.ts`；
- 统一解析：`packages/gui/src/utils/valorant-assets.ts`；
- 维护来源：`packages/gui/assets/valorant-source/`；
- 构建输出：忽略版本控制的 `packages/gui/public/valorant/` WebP。

`bun run update:valorant-metadata` 是维护者显式运行的联网更新命令；
`bun run assets:build` 和 `bun run assets:check` 使用已提交来源在本地构建和校验。应用
运行时不应依赖图片 CDN；未知 HTTP(S)、协议相对和外部 SVG 资源应退化为文字/占位。

用户可见字段优先级：

- 英雄：canonical agent id/name → `career.hero_name` → raw agent name；
- 地图：canonical map id → `career.map_name`/raw map name → path segment；
- 模式：`career.game_mode` 和本地 registry；
- 统计：击杀、助攻、死亡、比分来自 `stats.*`；
- 对局时间：`gameStartTime`/`gameEndTime`。

不要把 raw `map_id`、`agent_id`、`stats.mode_name` 或 `career.battle_id` 直接当成用户标签。

## 视频语义

- `video_type` 为 `击杀集锦` 或 `死亡集锦` 时是 montage；其它类型是 moment，例如
  三杀、四杀、五杀或其它时刻。
- 不要按数组位置或时长猜视频类型；ACLOS 可以调整顺序和时长。
- 清晰度 chip 使用 `video_level`；`video_resolution` 可能含换行或回车，应在显示前规范化。
- Rust `VideoItem.video_is_processing` 必须序列化为 WebView 需要的 `video_isProcessing`。

## 对局、片段和事件

视频事件位于 `videos[].rounds[].round_clips[].clip_events[]`：

- `round_sTime`、`clip_sTime`、`event_sTime` 和 duration 都是毫秒；
- `event_type` 是 `kill` 或 `death`；
- `event_ext` 可能包含 `EventName`、玩家名、`AgentName`、`EventTime`、武器和本地玩家标记。

事件时间必须按视频类型使用共享状态机：

| 视频 | 可见类型 | 视频时间 |
|---|---|---|
| `击杀集锦` | `kill` | `event_sTime` |
| `死亡集锦` | `death` | `event_sTime` |
| 其它 moment | `kill` | `clip_sTime + event_sTime` |

可见事件还必须具备 `EventName=Shot`、可解析且落在对局时间窗口内的 `EventTime`、玩家
名、AgentName、本地玩家标记、受击部位和落在视频时长内的 seek 时间。缺少证据、互相矛盾
或跨对局 Agent 不匹配的行应隔离，不创建列表行、统计数或进度条标记。

ACLOS 的 `KillerIsMe` 在高光视频中可能把队友事件也标成 1，因此事件数量不是本场 K/D。
K/D 必须使用 `m.stats.*`；事件列表只展示通过状态机的可播放事件。共享状态机由
`packages/gui/src/utils/event-state-machine.ts` 与 `src-tauri/src/library/events.rs`
共同维护，UI 负责跨视频去重，parser 仍应忠实返回源数据。

## 本地索引和 IPC

WonderfulUI 将完整 `matches.raw_json` 保留为可回放的权威源，同时把规范化事件写入
SQLite `events` 以便快速读取和未来扩展。批量 `scan_all`/`load_library` 会去掉 rounds，
打开单场详情时通过 `get_match_rounds` 按需读取完整数据。

本地视频相关 command 只能接受 SQLite `videos.path` 中登记、扩展名受支持、当前仍是普通
文件且不是符号链接的路径。播放、资源管理器定位、截图和快传共用这条后端校验；不要用
前端字符串检查替代它。

## 维护规则

- 新增 ACLOS 字段时先更新 parser model、TS/Rust 对齐测试和本文件；
- 不把一次性本机观察、个人账户样本、性能快照或历史方案写入当前契约；
- 对不确定的新字段使用安全 fallback，并保留原始数据供后续分析；
- 任何涉及源文件写入、目录选择或外部网络的新能力都必须重新审查安全策略和产品边界。
