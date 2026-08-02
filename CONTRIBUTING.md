# 贡献指南

欢迎参与 WonderfulUI。无论是修复 Bug、补测试，还是把一句难懂的提示改清楚，都可以
提交 Pull Request。

## 开始开发

完整的桌面运行和构建需要 Windows 10/11 x64、Bun 1.3.14、Rust 1.88.0，以及 Tauri 2
所需的 Windows SDK 和 WebView2 环境。

拉取代码后先安装依赖：

```bash
bun install --frozen-lockfile
```

只需要查看 Vue 界面时，可以用固定 mock 数据启动浏览器模式：

```bash
bun run dev:browser
```

它不会读取真实 ACLOS 数据。在 Windows 上运行桌面开发壳或构建 NSIS 安装程序：

```bash
bun run dev
bun run build
```

## 改动边界

- ACLOS 的 `WonderfulDb`、`snapshot<openid>` 和身份缓存都是只读输入。不要修改 ACLOS、
  游戏、Riot、WeGame 或 Vanguard 的文件。
- 不要提交真实 openid、玩家昵称、用户绝对路径、NAS 目录、本地视频、完整日志或快传
  令牌。
- 正式版会检查 GitHub Releases；用户开启快传时会启动 `22357/TCP` 局域网服务。
  文档和界面不能把应用写成完全不联网。
- 不要承诺尚未实现的删除、编辑、导出、备份、自定义数据目录、便携运行或云同步。
- 如果只改文档或界面文案，不要顺手改业务逻辑、IPC、CSS、依赖或构建配置。
- 普通贡献不要运行 `bun run version:*`。这些命令会修改版本、提交、创建 tag 并推送。

## 验证改动

只改 Markdown 时，检查链接并运行：

```bash
git diff --check
```

改动 Vue 组件、样式或用户可见文案时运行：

```bash
bun run typecheck
bun run test:all
bun run assets:check
bun run --cwd packages/gui build
git diff --check
```

改动 Rust 或 IPC 时还要运行：

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

浏览器模式和 macOS 上的检查不能证明 Windows WebView2、NSIS 安装、防火墙/UAC 或
真实 ACLOS 扫描可用。没有 Windows 环境时，在 PR 中把未验证项写清楚即可。

仓库的 `Manual Check` GitHub Actions 工作流只支持手动触发，PR 不会自动运行它。

## 提交 Pull Request

从最新 `main` 创建短分支。提交信息使用
[Conventional Commits](https://www.conventionalcommits.org/)，例如：

```text
feat(gui): add a performance filter
fix(parser): handle an empty snapshot
docs: clarify first use
```

一个提交只处理一个可以独立理解和回退的问题。PR 中说明用户会看到什么变化、实际运行
了哪些检查，以及还有哪些 Windows 行为没有验证。

普通 Bug 和功能建议可以提交 GitHub Issue。安全漏洞请按 [安全策略](SECURITY.md) 使用
GitHub 的私密报告入口，不要公开漏洞细节或敏感数据。
