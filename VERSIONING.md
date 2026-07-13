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

发布 notes（写入 `versions.json`，并进入应用内 `latest.json`）：

```bash
# PowerShell
$env:WUI_RELEASE_NOTES = @"
- 修复项一
- 新功能二
"@
bun run version:patch
```

或 bump 后、push 前手动编辑 `versions.json` → `releases.vX.Y.Z.notes`。

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

并额外校验生产 updater 配置：

- `plugins.updater.endpoints` 含 GitHub `latest.json` HTTPS URL
- 禁止 committed 的 `localhost` / `http://` endpoint
- 禁止 `dangerousInsecureTransportProtocol: true`
- `pubkey` 非空、`bundle.createUpdaterArtifacts: true`

如需新增含版本号的文件，必须同步更新 `scripts/check-versions.ts` 和 `scripts/version-bump.ts`。

## GitHub Actions 发布

官方发布产物必须由 `.github/workflows/release.yml` 在 `v*` tag 上构建。

发布顺序：

1. 在干净的 `main` 工作树 bump 版本（并写好 notes）。
2. 本地运行与发布相关的验证。
3. 推送 `main`。
4. 推送 `vX.Y.Z` tag，触发 Release workflow。

Release workflow 会运行：

```bash
bun install --frozen-lockfile
bun run scripts/check-versions.ts
bun run typecheck
bun run test
cargo test --release --manifest-path src-tauri/Cargo.toml --lib
bun run build   # 需 TAURI_SIGNING_* secrets
```

成功后创建 GitHub Release，并上传：

- Windows x64 NSIS 安装器 `WonderfulUI_*_x64-setup.exe`
- 签名 `WonderfulUI_*_x64-setup.exe.sig`
- 应用内更新清单 `latest.json`

详细执行手册见 `docs/AGENT_WORKFLOW.md`。自更新细节见 `docs/UPDATER.md`。

## 应用内更新（已启用）

自 v0.1.5 起，正式构建默认启用 `tauri-plugin-updater` + `tauri-plugin-process`：

| 配置 | 位置 |
|---|---|
| feature 默认开 | `src-tauri/Cargo.toml` `default = ["updater", "process"]` |
| endpoint / pubkey | `src-tauri/tauri.conf.json` `plugins.updater` |
| 权限 | `src-tauri/capabilities/default.json` |
| UI / store | `packages/gui/src/stores/update.ts`、`components/update/UpdateModal.vue` |
| 发布清单 | CI 生成并上传 `latest.json` |

私钥仅存 `~/.tauri/wonderfului.key` 与 GitHub secrets，**绝不入库**。

## 版本清单

根目录 `versions.json` 记录每个发布的 `tag` / `date` / `notes`。  
`notes` 是应用内更新说明的首选来源；`assets.url` / `signature` 字段为历史占位，运行时不读（签名与下载 URL 由 CI 写入 `latest.json`）。
