# 贡献指南

## 开发环境

- **Bun 1.1+** — 前端依赖与构建
- **Rust 1.77+** — 后端编译（通过 rustup 安装）
- **Windows** — ACLOS 仅限 Windows 平台，故本项目仅支持 Windows

```bash
bun install --frozen-lockfile
bunx tauri dev
```

## 分支模型

本项目采用 **GitHub Flow**：

```
main              ← 永远可发布
├─ feat/xxx       ← 新功能
├─ fix/xxx        ← 修 bug
├─ refactor/xxx   ← 重构
└─ docs/xxx       ← 文档
```

所有改动通过 Pull Request 合入 `main`，合并前 CI 必须通过。

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
cargo test --release --manifest-path src-tauri/Cargo.toml --lib  # Rust 测试
```

## 发布流程

正式发布必须由 GitHub Actions 从 tag 构建，不手动上传本地产物。

维护者通常在 release 分支执行：

```bash
bun run version:patch   # bump 版本号（patch/minor/major）
```

该脚本会更新版本文件、提交 `chore(release): vX.Y.Z` 并创建 tag。先通过 PR 合入
`main`，确认 tag 指向合并后的 `main` 提交，再推送 tag：

```bash
git push origin vX.Y.Z
```

`.github/workflows/release.yml` 会运行完整验证、执行 `bun run build`，并自动创建
GitHub Release，上传：

- `WonderfulUI_*_x64-setup.exe`
- `WonderfulUI_*_x64_en-US.msi`

完整 agent/维护者流程见 `docs/AGENT_WORKFLOW.md`。

## 问题报告

- Bug 请使用 GitHub Issues，附上 ACLOS 版本号
- 安全问题请参阅 `SECURITY.md`
- 新功能建议先开 Discussion 讨论
