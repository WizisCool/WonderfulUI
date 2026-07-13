# 贡献指南

## 开发环境

- **Bun 1.1+** — 前端依赖与构建
- **Rust 1.77+** — 后端编译（通过 rustup 安装）
- **Windows** — ACLOS 仅限 Windows 平台，故本项目仅支持 Windows

```bash
bun install --frozen-lockfile
bunx tauri dev
```

## 开发模型

WonderfulUI 主要是个人维护者项目。维护者的默认路径是：

- 在 `main` 上小步开发
- 按改动范围运行本地验证
- 需要时直接提交；**推送到远程（尤其是 `main`）仅在明确需要发布/同步时进行**
- 自动化 agent / 助手默认只做本地提交，**除非维护者明确要求，否则不要 `git push`**
- 发布时由 `v*` tag 触发 GitHub Actions 构建正式产物

外部贡献仍建议使用短分支和 Pull Request，方便讨论和审阅：

```text
feat/xxx
fix/xxx
docs/xxx
```

`.github/workflows/ci.yml` 不会在 PR 或 push 时自动运行。需要远端 Windows
复验时，维护者可以在 GitHub Actions 手动触发 `Manual Check`；正式发布仍由
`v*` tag 触发 Release workflow。

## 提交规范

采用 [Conventional Commits](https://www.conventionalcommits.org/)，便于自动生成 changelog 和版本 bump：

```
feat(gui): add scan settings modal
fix(parser): handle empty snapshot gracefully
docs: clarify ACLOS legal boundary
chore(release): v0.2.0
test(parser): add fixture for empty snapshot
```

| 前缀 | 对应版本变动 |
|---|---|
| `feat:` | minor |
| `fix:` | patch |
| `BREAKING CHANGE:` / `feat!:` | major |
| `docs:` / `refactor:` / `test:` / `chore:` | 不触发 |

## 开发约束

**不得触碰 ACLOS / Riot / Vanguard 游戏文件。** 本项目只读解析 ACLOS 本地缓存，不会修改任何游戏数据、启动游戏或触发反作弊。

详情见项目根目录下的设计文档。

## 构建验证

提交前请确保以下命令通过：

```bash
bun run typecheck    # TypeScript 类型检查
bun test             # 前端 + 解析器测试
cargo test --manifest-path src-tauri/Cargo.toml --lib  # Rust 测试
```

这些检查主要在本地运行。需要远端 Windows 复验时，可手动触发 `Manual Check`。
该 workflow 默认运行 typecheck、Bun 测试和 Rust lib 测试；需要打包验证时可勾选
`full-build`。正式发布由 Release workflow 从 `v*` tag 执行完整验证和
`bun run build`。

## 发布流程

正式发布必须由 GitHub Actions 从 tag 构建，不手动上传本地产物。

维护者通常在干净的 `main` 上执行：

```bash
bun run version:patch   # bump 版本号（patch/minor/major）
```

该脚本会更新版本文件、提交 `chore(release): vX.Y.Z` 并创建 tag。确认本地验证
通过后，推送 `main` 和 tag：

```bash
git push origin main
git push origin vX.Y.Z
```

`.github/workflows/release.yml` 会运行完整验证、执行 `bun run build`，并自动创建
GitHub Release，上传：

- `WonderfulUI_*_x64-setup.exe`
- `WonderfulUI_*_x64_zh-CN.msi`

完整 agent/维护者流程见 `docs/AGENT_WORKFLOW.md`。

## 问题报告

- Bug 请使用 GitHub Issues，附上 ACLOS 版本号
- 安全问题请参阅 `SECURITY.md`
- 新功能建议先开 Discussion 讨论
