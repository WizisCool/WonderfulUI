# 贡献指南

感谢你愿意帮助改进 WonderfulUI。它是一个面向 Windows x64 无畏契约玩家的个人高光
资料库，贡献应优先改善真实用户的整理、筛选、回看和问题恢复体验。

## 开发环境

- Windows 10/11 x64：运行 Tauri、验证 WebView2、快传、防火墙和 NSIS 需要 Windows。
- Bun 1.3.14：见根目录 `.bun-version`。
- Rust 1.88.0：见 `rust-toolchain.toml`。
- Tauri 2 所需的 Windows SDK、WebView2 和 Rust 工具链。

安装依赖：

```bash
bun install --frozen-lockfile
```

`bun run dev:browser` 可以在普通浏览器中查看固定 mock 数据，适合检查 Vue 结构和
样式；它不读取真实 ACLOS，也不能替代 Windows Tauri smoke test。

## 修改边界

- ACLOS `WonderfulDb`、`snapshot<openid>` 和身份缓存只读；不要修改游戏、Riot、WeGame、
  Vanguard 或 ACLOS 文件。
- 不要把真实 openid、昵称、完整用户路径、NAS 路径、日志、视频或二维码令牌提交到仓库。
- 不要把应用说成完全不联网：正式版本会检查 GitHub Releases，用户主动快传时会启动
  `22357/TCP` 的临时局域网 HTTP 服务。
- 不要在未实现时承诺删除、编辑、导出、备份、手动选择目录、便携运行或云同步。
- 如果只处理文档或用户文案，不要顺手修改业务逻辑、IPC、CSS、依赖、构建配置和工作流。

## 分支、提交和 Pull Request

外部贡献请从最新 `main` 创建短分支，例如：

```text
feat/filter-by-kda
fix/share-firewall-message
docs/clarify-first-run
```

提交信息使用 [Conventional Commits](https://www.conventionalcommits.org/)，例如：

```text
feat(gui): add a performance filter
fix(parser): handle an empty snapshot
docs: clarify local data and network boundaries
```

一个提交应围绕一个可以独立理解和回退的问题域。PR 描述请说明用户影响、验证命令、
Windows 未验证边界，以及是否只有文案/注释变化。

## 验证

按改动范围选择命令；文档-only 改动不需要为了形式运行 Rust 构建。

```bash
bun run typecheck
bun run test:all
bun run assets:check
bun run --cwd packages/gui build
git diff --check
```

Rust/IPC 变化还需要：

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Windows 上的发布前验证还包括 `bun run build`，它生成 NSIS 安装器。GitHub Actions 的
`.github/workflows/ci.yml` 是手动触发的 `Manual Check`，不会自动为每个 PR 或 push 运行。

## 发布

正式 Release 由 GitHub Actions 从 `v*` tag 构建，不手动上传本地产物。版本文件、签名、
tag 和发布边界见 [VERSIONING.md](VERSIONING.md) 与 [docs/UPDATER.md](docs/UPDATER.md)。
不要在普通贡献中运行 `bun run version:*`；该脚本会更新版本文件、提交、创建 tag 并推送远程。

## 问题与安全

- 普通 Bug 请使用 GitHub Issues，附上 ACLOS 版本（如知道）和脱敏日志。
- 功能建议请描述用户问题，不要只提交实现方案。
- 安全问题请参阅 [SECURITY.md](SECURITY.md)，不要公开发 Issue。
- 讨论行为与数据格式前，请先查看 [docs/README.md](docs/README.md) 中的唯一事实源。
