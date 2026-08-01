# 版本管理

WonderfulUI 使用语义化版本 2.0.0（`主版本.次版本.修订号`）。发布产物只面向 Windows
x64，当前格式是 NSIS 安装程序，不是 MSI 或便携压缩包。

## 唯一事实源与同步文件

`src-tauri/tauri.conf.json` 的 `version` 是版本事实源。当前同步检查还会核对：

- `src-tauri/Cargo.toml`；
- 根目录 `package.json`；
- `packages/parser/package.json` 和 `packages/gui/package.json`；
- `packages/parser/cli.ts`；
- `packages/gui/src/utils/version.ts`；
- `versions.json`；
- `packages/parser/tests/cli.test.ts` 中的 CLI 版本断言。

使用 `bun run scripts/check-versions.ts` 检查版本、Release tag 和生产 updater 配置。

## 版本脚本

```bash
bun run version:patch
bun run version:minor
bun run version:major
```

`scripts/version-bump.ts` 会从 Tauri 配置计算新版本，更新上述文件，写入
`versions.json`，创建 `chore(release): vX.Y.Z` 提交和 tag，并执行：

```text
git push origin main
git push origin vX.Y.Z
```

因此它只能由明确进行正式发布的维护者在干净工作区运行。普通 Agent、文档整理和
日常贡献不得运行 `bun run version:*`。

## GitHub Actions 发布流程

`.github/workflows/release.yml` 在 `v*` tag 或手动触发时运行：

1. `validate` 在 Windows runner 上安装锁定的 Bun/Rust，执行版本检查、资源检查、类型检查、
   Bun/Vitest 测试和 Rust lib 测试；
2. `build` 生成签名的 Tauri Windows x64 NSIS 产物；
3. tag 发布时，`publish` 根据 `versions.json`/git log 生成 `latest.json`，并创建 GitHub
   Release。

发布文件包括：

```text
WonderfulUI_<version>_x64-setup.exe
WonderfulUI_<version>_x64-setup.exe.sig
latest.json
```

`latest.json` 的 updater endpoint 固定为项目 GitHub Releases 的 HTTPS 地址；不要提交
localhost endpoint、关闭签名校验或把私钥放入仓库。完整签名和更新 UI 约束见
[docs/UPDATER.md](docs/UPDATER.md)。

## 版本说明

`versions.json` 保存历史 release notes，供发布 workflow 生成应用内更新说明。新增版本
时可以在运行 bump 脚本前设置 `WUI_RELEASE_NOTES`；不要为了修改文档而改动已有版本历史。

## 平台边界

macOS 上的类型检查、单元测试、浏览器 mock 和 Vite 构建不等于 Windows WebView2、NSIS
安装、更新安装、Firewall/UAC 或真实 ACLOS 扫描已通过。发布前必须由 Windows workflow
或 Windows 本机完成对应验证。
