# WonderfulUI 架构说明

本文档描述当前代码的运行形态和边界。产品定位、用户文案和 ACLOS 字段分别见
`PRODUCT.md`、`DESIGN.md` 和 [ACLOS 数据格式](ACLOS_FORMAT.md)。

## 当前形态

- 目标平台：Windows 10/11 x64；桌面壳是 Tauri 2，运行时 WebView2。
- 前端：Vue 3 `<script setup lang="ts">`、Pinia、Vue Router 和 Vite。
- 后端：Rust 进程内解析器、Tauri command 和本地 SQLite（`rusqlite` bundled）。
- 工具链：Bun 1.3.14，Rust 1.88.0；版本分别由 `.bun-version` 和
  `rust-toolchain.toml` 固定。
- 运行索引：`%LOCALAPPDATA%\wonderful-ui\library.db`；日志：
  `%LOCALAPPDATA%\wonderful-ui\logs\wonderful-ui.log`。
- 构建：`bunx tauri build`/`bun run build`，当前 Windows bundle 目标只有 NSIS。
- Parser：GUI 使用 Tauri 内的 Rust parser；TypeScript parser 保留给 CLI 和 Bun 测试。

## 浏览器调试边界

`bun run dev:browser` 只启动 `packages/gui` 的 Vite 开发服务器。没有 Tauri runtime 时，
`packages/gui/src/tauri-adapter.ts` 提供固定的 mock 账户、对局、统计、日志和安全假路径，
用于检查 DOM、样式、动画和组件状态。

浏览器 debug 不读取 ACLOS、不播放真实视频、不检查 Windows 防火墙，也不执行真实 updater
或快传；它不能被描述成 Windows Tauri smoke test。

## 数据流

```text
ACLOS WonderfulDb / snapshot<openid> (read-only)
        │
        ▼
Rust parser + library scraper
        │
        ▼
SQLite library.db (WonderfulUI-owned index and preferences)
        │
        ├── rounds-stripped library view → Vue/Pinia
        └── full matches.raw_json → get_match_rounds (on-demand)
```

后端从用户 profile 推导默认的 `%USERPROFILE%\AppData\Roaming\ACLOS\WonderfulDb`。GUI
没有自定义目录选择器，也没有让 renderer 传入任意源目录的 command。

扫描器会把完整 `matches.raw_json` 保留为原始回放数据，把通过共享事件状态机规范化的
事件写入 `events` 表。SQLite 还保存账户顺序、WonderfulUI 内部账户显示名、源文件
size/mtime、解析错误和资源缓存元数据；这些内容不写回 ACLOS。

## Parser 和 library 层

- `src-tauri/src/parser/`：hex 解码、AES 解密、WonderfulDb/snapshot model 和 reader；
- `packages/parser/`：等价的 TypeScript parser、CLI 和测试；
- `src-tauri/src/library/scraper.rs`：唯一的生产 ACLOS source adapter；
- `src-tauri/src/library/db.rs`：数据库路径、迁移、library view、raw JSON 和视频路径授权；
- `src-tauri/src/library/events.rs`：事件过滤、去重键和播放时间的 Rust mirror；
- `src-tauri/src/library/aclos_identity.rs`：从 ACLOS 身份缓存、snapshot 和日志中读取显示名，
  必须使用临时只读副本打开 LevelDB；
- `src-tauri/src/library/model.rs`：发送给 GUI 的 IPC shape。

批量加载会省略每个视频的 `rounds`，详情打开时再读取单个 match。解析失败的账户保留
错误状态；损坏的 raw match 不应把其余资料库伪装成空库。

## 主要 Tauri commands

### 启动和扫描

- `aclos_status`：只读检查默认 WonderfulDb 目录和数字账户文件，用于首次使用页面；
- `scan_shell`：读取已有 SQLite 账户壳并启动后台源刷新；
- `scan_all`：启动时的增量刷新并返回 rounds-stripped view；
- `scrape_library(mode)`：用户触发的 `incremental` 或 `full` 扫描；
- `load_library`：只读现有 SQLite view，不重新读取 WonderfulDb；
- `get_match_rounds(openid, match_id)`：从 SQLite 读取单场完整 rounds。

扫描模式和触发来源由后端校验，不信任 renderer 传入的审计文字。启动、手动刷新和全量
扫描串行化 SQLite 写入，避免后台任务覆盖较新的手动结果。

### 本地资料库和视频

- `save_account_order`：以事务保存账户顺序；合成的“全部账户”不写入数据库；
- `rename_account`：保存 WonderfulUI 内部的显示名覆盖；
- `get_library_stats`：读取账户、对局、视频和应用-owned storage 统计；
- `play_video`：Windows 上调用 `ShellExecuteW` 交给默认播放器；
- `reveal_in_explorer`：用 `explorer.exe /select` 定位文件；
- `capture_video_frame`：Windows Media Foundation 读取当前视频帧，返回 PNG base64；
- `get_log_status`/`reveal_logs_dir`：读取有限日志尾部或打开应用日志目录。

播放、资源管理器、截图和快传 command 都要求路径精确匹配 SQLite `videos.path`，扩展名
受支持、当前是非符号链接普通文件。asset protocol 的可见性不能替代 command 授权。

### 外链、资源和网络

- `open_external_url`：只允许明确的 HTTPS GitHub/许可证地址；
- `cache_asset(s)`：保留的兼容资源缓存边界，只允许固定资源类型和允许的 HTTPS 来源；
  当前 canonical 地图、英雄和模式资源由仓库构建，正常扫描通常不产生 CDN 下载；
- `start_share_server`/`stop_share_server`/`share_server_status`：见下文快传边界。

当前应用没有遥测、账号同步或后台上传 command。更新检查由 updater plugin 访问 GitHub
Releases，不经过这些本地资料库 command。

## 快传架构

用户从播放器主动开启“快传”后，Rust 在 `0.0.0.0:22357/TCP` 启动一次性 HTTP 服务：

- 只接受已登记的本地视频；
- 随机生成 URL-safe token，路径为 `/w/<token>`；
- QR URL 使用启动时选定的 LAN IPv4；Host 必须匹配 localhost、loopback 或该 LAN IP；
- 传输完成后才计数并发出 `wui://share_downloaded`；
- 前端模态挂载时启动、卸载时停止；Rust 的 3 分钟 idle timeout 是兜底；
- session 使用 UUID v4，旧 session 的 stop/event 不能影响替代服务；
- 关闭服务不会立即删除持久防火墙规则，完整卸载才清理规则。

Windows NSIS 安装、覆盖安装和 updater `/UPDATE` 会幂等配置名为
`WonderfulUI Quick Share` 的窄范围入站规则：已安装 exe、TCP 22357、LocalSubnet。规则
不绕过企业组策略、第三方防火墙或路由器 AP 隔离；缺失或不正确时，首次使用可能请求一次
受限 UAC 修复。

## 更新器

正式构建启用 `tauri-plugin-updater` 和 `tauri-plugin-process`：

- endpoint 是项目 GitHub Releases 的 HTTPS `latest.json`；
- `App.vue` 在 UI 显示后进行一次静默检查；
- `useUpdateStore` 管理检查、可用、下载、安装、错误和最新状态；
- 下载的是签名 NSIS 安装器，完成后由 updater 安装并 relaunch；
- 公钥入库，私钥只存在仓库外和 GitHub secrets。

实现细节和发布清单见 [UPDATER.md](UPDATER.md)。不要在本地提交 localhost endpoint 或
关闭安全校验的临时配置。

## Tauri 安全边界

- 生产 CSP 明确限制脚本、样式、字体、图片、媒体和 IPC；devCsp 为空只是开发调试需要；
- asset protocol 不使用全局 `"**"` scope，应用缓存和经 SQLite 授权的媒体分别受限；
- screenshot Save As 只用对话框提供的单路径写权限，不授予 renderer 全盘读取；
- LevelDB 身份读取在临时副本上进行，避免在 ACLOS 活跃目录中产生 LOCK/日志副作用；
- 前端日志不写入原始 WonderfulDb、raw match JSON、完整事件树或视频路径库存；
- Media Foundation frame capture 对 buffer 长度、stride、乘法和时间戳转换执行边界检查。

## 前端结构

```text
packages/gui/src/
├── App.vue                 # boot、更新检查、模态层
├── components/
│   ├── common/             # onboarding、账户栏、boot、toast、图标
│   ├── event/              # 事件列表
│   ├── layout/             # top bar
│   ├── match/              # 卡片、筛选、日期
│   ├── player/             # 播放器、控制条、进度条
│   ├── settings/           # 资料库概览、日志、关于
│   ├── share/              # 快传模态
│   └── update/             # 更新模态
├── stores/                 # account、detail、filter、player、settings、share、update、ui
├── utils/                  # 纯逻辑、事件状态机、资源解析、平台适配
└── views/                  # Home、Detail、Settings
```

稳定 DOM、虚拟滚动、模态层级、播放器状态和图标约定见
[前端约定](FRONTEND_CONVENTIONS.md)。

## 开发和验证命令

依赖和本地前端检查：

```bash
bun install --frozen-lockfile
bun run typecheck
bun run test:all
bun run assets:check
bun run --cwd packages/gui build
```

浏览器 mock：

```bash
bun run dev:browser
```

Rust lib 测试：

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Windows Tauri 开发和完整 NSIS 构建：

```bash
bun run dev
bun run build
```

`.github/workflows/ci.yml` 是手动的 Windows `Manual Check`；`release.yml` 在 `v*` tag
上运行发布验证、签名 NSIS 构建和 `latest.json` 发布。macOS 的浏览器、类型、单测或
Vite 证据不能替代这些 Windows 行为验证。
