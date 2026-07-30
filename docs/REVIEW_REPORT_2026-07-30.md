# WonderfulUI 全量深度 Review 报告（2026-07-30）

## 结论

本轮 Review 从 `origin/main` 的 `v0.1.9`（`e61a9b3`）开始，在独立分支
`codex/deep-review-offline-assets-20260730` 上形成 73 个可独立回退的原子提交。
覆盖 Rust/Tauri 边界、ACLOS 只读适配、SQLite、分享服务、Windows 帧捕获、
Vue/Pinia 异步状态、播放器、弹窗/焦点/键盘、筛选、构建/Release、离线资源、
测试和上下文文档。

没有启动、修改或干扰 ACLOS、Valorant、Riot 或 Vanguard；ACLOS 源目录相关
代码保持只读。当前执行环境为 macOS，报告不会把静态分析或浏览器 mock 验收
表述为 Windows/Tauri 真机通过。

## 离线 Valorant 资源专项

### 问题与根因

- 旧地图离线资源曾使用约 `456×100` 的 `listViewIcon` 横幅，放入现有封面容器后
  必须放大裁剪，造成模糊；这不是安装包大小问题，而是选错 canonical 图像字段。
- 图片 URL、特工名和地图名曾受单条 ACLOS 记录影响，同一实体可能出现不一致。
- 原始地图 PNG 可达数 MiB，直接进入 `public/` 会放大安装包。
- “基础训练”和“靶场”等记录可引用完全相同的源图，按实体文件名保存会重复打包。
- 仅检查 `http(s)://` 不足以保证离线；`//host/x`、`/\\host/x` 等浏览器 URL
  语义仍可能跨源请求。

### 当前实现

- 所有已知实体以稳定 UUID、map URL、内部模式路径为主键，从生成的 canonical
  registry 统一解析名称和图片；不包含账号、对局、地图或特工样本特判。
- 地图维护源使用 Valorant API 的 16:9 `splash` 原图，而不是横幅形
  `listViewIcon`；特工和模式同样保留 canonical 原始 PNG 作为维护输入。
- `bun run update:valorant-metadata` 是唯一联网维护步骤；下载、元数据发布和旧源
  清理是事务式的，任一下载/发布失败不会留下半更新 registry。
- `bun run assets:build` 完全离线，按内容 SHA-256 去重并统一编译：
  - 地图：`640×360 WebP`，quality 84；
  - 特工：`256×256 WebP`，quality 88；
  - 模式：`128×128 WebP`，quality 90。
- 约 72 MiB 原始 PNG 位于 `packages/gui/assets/valorant-source/`，不在
  `public/`，因此不进入 Vite `dist` 或 Windows 安装包。
- 70 条 registry 记录只生成 60 个唯一运行时 WebP，总计 1.28 MiB。
- “基础训练”和“靶场”共享源 SHA-256
  `6eeea7e5000e4423b3a01fdee0afa1d16622484aa431acf6dc4d911266a70a99`，
  运行时只打包一个约 29 KiB 地图文件，不再重复两份约 3.8 MiB PNG。
- `bun dev`、浏览器调试、CI、Release 和生产 Vite build 共用同一 build/check
  管线；构建后会再次核对 `dist`。
- 未知实体只允许浏览器验证为同源的根路径或自包含 raster data URL；HTTP(S)、
  协议相对、反斜杠 host 和 SVG data URL 均退化到文字/占位图，不会自动联网。

代表提交：`aacbcb0`、`c787d9c`、`d6d1a04`、`ba16a5d`、`64ac30a`、
`c13d776`、`64905f2`。

## 主要修复

### 数据、SQLite 与 ACLOS

- 资料库刷新、账户写入和扫描结果改为事务/修订号约束，避免部分写入、晚到结果
  覆盖新扫描数据或部分排序丢失账户。
- SQLite 短写锁增加有界等待；损坏 match row 和部分账户解析失败不再伪装成空库
  或无条件成功，而是保留可恢复 UI 与本地日志证据。
- LevelDB 身份读取先复制到应用临时目录再打开，ACLOS 源保持严格只读。
- 扫描模式、触发器、账户偏好、match rounds、视频路径等 IPC 输入执行长度、集合、
  已知实体和 canonical 值校验；WonderfulDb 路径由后端固定推导并失败关闭。

代表提交：`152bed5`、`0c22979`、`abfaeb5`、`201d475`、`5856783`、
`fe6cab3`、`c068275`、`74e001a`、`79bb8ce`。

### Windows、文件与本地服务边界

- Windows 帧捕获对 pitch、扫描线、缓冲区大小、时间戳换算和整数溢出增加校验，
  防止越界复制或时间换算 wraparound。
- 本地视频、截图 Save As、资源管理器、日志目录和外部 URL 命令均限制到已登记路径
  或固定允许目标；未授予 renderer 全局文件系统 scope。
- LAN 分享 token/Host/端口/session 均按当前服务实例校验，停止旧 session 不会误停
  替代服务；待取消集合有界，错误不向 UI 暴露本地路径。
- 日志记录单条有界、换行被压平，轮转/写入共享锁，避免并发压缩与追加互相覆盖。

代表提交：`0532014`、`015ae33`、`cb32555`、`369f55b`、`f064b3c`、
`6326080`、`b6362fb`、`f7d8e9b`、`5b592e6`。

### 前端状态、竞态和恢复路径

- 启动刷新订阅早于 native job，终态区分成功/降级/失败/超时；超时后保留单个终态
  监听并按 `libraryRevision` 做晚到回载，App 卸载会取消前端等待和监听。
- Boot 事件注册、扫描、日志/统计读取、更新检查等均 single-flight；旧异步播放会话、
  图片失败缓存、定时关闭和 rounds 请求不能污染新对象/新会话。
- Toast 使用单调序号，相同文案的连续事件也会显示；更新二次检查无更新时关闭旧弹窗。
- 账户筛选零命中显示 `0 / total`，与弱化样式和 tooltip 一致。
- 虚拟列表在账户/筛选缩短列表时同步钳制 DOM 与响应式 `scrollTop`，避免旧偏移造成
  空白 viewport。
- 设置读取可处理 string、`null`、`undefined` 等任意 rejection，不在 `catch` 内二次
  抛错；统计刷新会等待旧快照后再读一次。
- 更新进度、音量和视频进度均建立 finite/clamp 不变量；零宽响应式轨道不再发出
  `NaN` seek。
- 持久化筛选只接受合法类别和有限范围，去重并排序倒置区间；单边日期范围正确显示、
  定位和原样关闭。

代表提交：`4f85a7e`、`a799fef`、`a3edae8`、`f33af13`、`e492319`、
`5a3ec78`、`e68aeb7`、`35ecc00`、`30c9300`、`25ee29b`、`e3367cf`、
`fefbe89`、`5514c28`、`22bef94`。

### UI、键盘、焦点和响应式

- 账户列表、筛选和对局 listbox 补齐稳定 active descendant/roving tabindex、方向键、
  Home/End、Enter/Space 与焦点可见性；输入框/嵌套按钮不会被外层快捷键误处理。
- 模态层的 Escape、Tab trap 和焦点恢复按实际 z-index 归属，播放器、事件列表、设置、
  更新和分享不会因监听注册顺序互相抢键盘。
- 设置页仍为 lazy chunk；960×600 下筛选结果优先获得详情栏空间，页面整体无横向或
  纵向溢出。
- 删除无生产引用的旧分享平台 registry、旧日期选择器 DOM 实现和未使用 composable，
  降低“看起来可用但无真实入口”的误导耦合。

代表提交：`9c064f1`、`8cadfc1`、`417e942`、`81f318c`、`0a5ca2c`、
`a5136da`、`da9c7a7`、`88e411f`。

### 构建、Release 与文档

- 固定 Rust 1.88 工具链；Vue template 纳入 `vue-tsc` 门禁。
- 生产构建关闭 JS/CSS source map；Release tag 必须与 canonical 版本一致，防止
  跨版本产物生成错误 `latest.json`。
- 版本、架构、ACLOS 字段语义、前端约束、离线资源流程、Updater 和 Agent 工作流
  文档已与当前实现同步。

代表提交：`fc15e78`、`f7546d6`、`470ca36`、`6d8d899`、`3ead5d2`。

## 验证证据

### 已实际运行

- `bun run test:all`
  - Bun：220 passed，6 skipped，0 failed；
  - Vitest：142 passed，0 failed。
  - 6 个 skip 均依赖本机不存在的真实 ACLOS/WonderfulDb 样本。
- `bun run typecheck`：通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`：88 passed。
- `cargo fmt --all -- --check`：通过。
- `cargo check --workspace --all-features --locked`：通过。
- `cargo clippy --workspace --all-features --locked`：退出码 0；保留 55 条非阻断
  风格/复杂度警告，见“已知限制”。
- `bun run scripts/check-versions.ts`：canonical 版本和 updater 配置全部一致。
- `bun run assets:build`：60 unique WebP / 70 records / 1.28 MiB。
- `bun run assets:check`：60 source PNG、60 compiled WebP、checksum/尺寸/格式/大小/
  去重/registry parity 全部通过。
- `bun run --cwd packages/gui build`：Vite production build 通过，构建后 `dist`
  资源复检通过；`dist/valorant` 恰好 60 个文件，未生成 `.map`。

### 浏览器调试验收

使用项目 `http://127.0.0.1:1420/` mock 数据，在 960×600 视口验证：

- 页面整体 `scrollWidth == clientWidth`、`scrollHeight == clientHeight`，无页面级溢出。
- 可见地图图片 natural size 为 `640×360`，特工为 `256×256`，模式为 `128×128`；
  均来自 `127.0.0.1:1420/valorant/...webp`，0 破图。
- 页面资源清单 128 项，跨源自动资源 0 项；console warning/error 0 条。
- 零命中 query 实际渲染为全部账户 `0 / 2`、两个账户各 `0 / 1`，列表显示
  `0 / 2` 和“没有匹配”。
- 设置弹窗在最小视口内无内部横向溢出，关闭后焦点回到设置按钮。
- 视觉检查确认地图以 16:9 封面显示，没有横幅图被放大产生的明显模糊。

## 无法在当前环境完成的验证

- 未运行 Windows WebView2/Tauri 桌面二进制、真实 Media Foundation 帧捕获、
  Explorer、系统 Save As、UAC 或 NSIS 安装/卸载/升级。
- 未读取真实 WonderfulDb、snapshot 或 LevelDB 数据；相关源数据不存在，且即使存在
  也只允许只读验证。
- 未实际下载安装 updater，也未启动真实 LAN 分享给另一台设备。
- 上述路径通过条件编译代码审查、纯逻辑/Rust 单元测试、IPC 权限/输入边界测试、
  构建配置和浏览器 mock 验证降低风险，但仍需 Windows 人工 smoke test 才能关闭平台风险。

## 已知限制与后续人工检查

- Vite production build 仍提示主 chunk 约 511 KiB（gzip 约 180 KiB）超过默认
  500 KiB 提示线；设置/ECharts 已延迟为独立 chunk。继续拆分会改变加载拓扑，当前
  离线桌面体量可接受，建议在真实 WebView2 启动指标支持下再做。
- Clippy 仍报告 55 条非阻断 warning，主要是旧式 format 参数、needless borrow、
  函数参数/类型复杂度和文档缩进；本轮没有为清零告警而大面积机械改写稳定 Rust
  路径。后续可单独建立纯 lint cleanup 分支。
- 兼容用 `cache_asset(s)` IPC 仍存在且可访问严格白名单远端，但当前 GUI resolver
  产生零下载任务；保留它是兼容决定，不是当前离线运行依赖。
- 推送后建议在 Windows 11 + WebView2 上执行：首次启动、增量/全量扫描、账户重命名/
  排序、播放器 seek/逐帧/截图、LAN 分享、更新失败恢复、NSIS 覆盖升级与卸载保留数据。

## Git 审计

- Review base：`e61a9b3`（`origin/main`, tag `v0.1.9`）。
- 分支：`codex/deep-review-offline-assets-20260730`。
- 原子提交数：73（本报告提交前）。
- 完整清单可用以下命令核验：

```bash
git log --reverse --oneline e61a9b3..codex/deep-review-offline-assets-20260730
git diff --check e61a9b3..codex/deep-review-offline-assets-20260730
```
