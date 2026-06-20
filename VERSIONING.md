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
3. 更新所有配置文件的版本字段
4. 提交 `chore(release): vX.Y.Z`
5. 创建 git 标签

## 应用内更新（预留）

Tauri 的 updater 插件已作为脚手架引入但**默认未启用**。详见：

- `src-tauri/Cargo.toml` — `updater` feature（可选）
- `src-tauri/tauri.conf.json` — `plugins.updater` 配置段

启用后需配置签名密钥和更新 endpoint。

## 版本清单

根目录下的 `versions.json` 记录每个发布的版本信息，作为未来 updater manifest 的模板。
