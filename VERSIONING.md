# 版本管理

WonderfulUI 采用 **语义化版本 2.0.0**（`主版本.次版本.修订号`）。

## 发布节奏

不定期发布。当有显著功能变更或修复时发布新版本。

## 版本唯一来源

`src-tauri/tauri.conf.json` 中的 `version` 字段为唯一事实源。
`Cargo.toml`、`package.json` 等文件中的版本通过以下命令同步：

```bash
bun run version:patch    # 0.1.0 → 0.1.1
bun run version:minor    # 0.1.0 → 0.2.0
bun run version:major    # 0.1.0 → 1.0.0
```

每次 bump 会自动：
1. 读取 `tauri.conf.json` 当前版本
2. 计算下一版本号
3. 更新所有配置文件和测试的版本字段（见下方清单）
4. 提交 `chore(release): vX.Y.Z`
5. 创建 git 标签
6. 推送 main 分支和 tag
7. CI（release.yml）自动构建并创建 GitHub Release（`generate_release_notes: true`）

`scripts/version-bump.ts` 会执行 `git add -A`，因此只应在干净的工作树上运行，
且工作树中只能包含本次发布需要提交的版本文件变更。

### 版本一致性检查

`scripts/check-versions.ts` 在 CI 中自动运行（ci.yml 和 release.yml 均有），
确保以下所有文件的版本号与 `tauri.conf.json` 一致：

- `src-tauri/tauri.conf.json`（事实源）
- `src-tauri/Cargo.toml`
- `package.json`
- `packages/parser/package.json`
- `packages/gui/package.json`
- `packages/parser/cli.ts`（`VERSION` 常量）
- `packages/gui/src/utils/version.ts`（`APP_VERSION` 常量）
- `versions.json`
- `packages/parser/tests/cli.test.ts`（CLI 版本测试硬编码值）

如需新增含版本号的文件，必须同步更新 `scripts/check-versions.ts` 和 `scripts/version-bump.ts`。

## GitHub Actions 发布

官方发布产物必须由 `.github/workflows/release.yml` 在 `v*` tag 上构建。

发布顺序：

1. 在干净的 `main` 工作树 bump 版本。
2. 本地运行与发布相关的验证。
3. 推送 `main`。
4. 推送 `vX.Y.Z` tag，触发 Release workflow。

Release workflow 会运行：

```bash
bun install --frozen-lockfile
bun run typecheck
bun run test
cargo test --release --manifest-path src-tauri/Cargo.toml --lib
bun run build
```

成功后会创建 GitHub Release，并上传 Windows x64 NSIS 安装器。

详细执行手册见 `docs/AGENT_WORKFLOW.md`。

## 应用内更新（预留）

Tauri 的 updater 插件已作为脚手架引入但**默认未启用**。详见：

- `src-tauri/Cargo.toml` — `updater` feature（可选）
- `src-tauri/tauri.conf.json` — `plugins.updater` 配置段

启用后需配置签名密钥和更新 endpoint。

## 版本清单

根目录下的 `versions.json` 记录每个发布的版本信息，作为未来 updater manifest 的模板。
