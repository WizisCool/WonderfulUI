# 自更新系统 (In-App Updater)

WonderfulUI 的应用内自更新方案。基于 `tauri-plugin-updater`（Tauri 2）+ GitHub Releases 托管，UI 与现有设计系统（暗色 oklch tokens、ShareModal 范式、MiSans 中文、`ph:*` 图标）一致。

> 本文档描述**已落地**行为（自 v0.1.5 起）。决策点：GitHub Releases 托管 / 静默检查+侧栏红点+轻 toast / 2026-06-24 生成的签名密钥。

## 合规性

自更新只与项目自己的 GitHub Release 通信，**不触碰** Riot / Vanguard / ACLOS / `WonderfulDb`，不启动游戏客户端。下载 NSIS 安装包并覆盖安装是普通桌面行为，符合 `CLAUDE.md` 全部硬约束。

## 架构

```
GitHub Release (latest.json + setup.exe + setup.exe.sig)
        ▲ HTTPS check()
[src-tauri] tauri-plugin-updater + tauri-plugin-process
        ▲ invoke 经 Pinia store（组件不直接 invoke）
[packages/gui] useUpdateStore → UpdateModal.vue + 侧栏红点/版本入口 + 关于页
```

- **检查触发**：
  1. 启动 `runBoot()` 显露 UI 之后静默检查一次（失败静默；成功有更新 → 红点；未「跳过此版本」则**自动打开更新弹窗**，可选「更新」/「稍后」/「跳过此版本」）
  1b. 「跳过此版本」写入 `localStorage wui:update.skippedVersion`：同版本不再自动弹窗，红点与设置→关于更新入口保留；手动检查/版本号仍可开窗
  2. 设置 →「关于」→「检查更新」手动检查
  3. 侧栏底部版本号点击 → 打开关于页并手动检查；有 badge 时直接开更新弹窗
  4. 侧栏设置齿轮**始终**打开设置（有 badge 只显示红点，不劫持）；版本号在有 badge 时再开更新弹窗
- **更新执行**：`update.downloadAndInstall(progress回调)` → 安装 → `relaunch()`。
- **安装模式**：perMachine NSIS + `installMode: "passive"`（NSIS 进度小窗 + UAC 提权）。

## 签名密钥

- 公钥：`src-tauri/tauri.conf.json` → `plugins.updater.pubkey`（可入库）。
- 私钥：仓库外 `~/.tauri/wonderfului.key`（**绝不入库**）。
- GitHub secrets：`TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。
- **铁律**：公钥必须与签名私钥同一对；丢失私钥/密码则无法再向旧版本推送更新——务必离线备份。

## 后端 / 构建 / CI

### tauri.conf.json

- `bundle.createUpdaterArtifacts: true`（v2 模式，Windows NSIS 产物 = `WonderfulUI_<ver>_x64-setup.exe` + `.exe.sig`）。
- `plugins.updater.endpoints`：**仅**生产 HTTPS  
  `https://github.com/WizisCool/WonderfulUI/releases/latest/download/latest.json`
- `pubkey` 非空；`windows.installMode: "passive"`。
- **禁止**把 `http://localhost:...` 或 `dangerousInsecureTransportProtocol: true` 提交进仓库。本地联调请用临时改动且**不要提交**；`scripts/check-versions.ts` 会拦截。

### Cargo.toml / lib.rs / capabilities

| 位置 | 状态 |
|---|---|
| `default = ["updater", "process"]` | 已启用 |
| `tauri-plugin-updater` / `tauri-plugin-process` | optional deps，默认 feature 拉入 |
| `lib.rs` `#[cfg(feature=...)]` 注册两插件 | 已落地 |
| `capabilities/default.json` | `updater:default` + `process:default` |

### release.yml

1. `bun run build` 注入签名 secrets。
2. 生成 `latest.json`（version / notes / pub_date / platforms.windows-x86_64）。
3. notes 优先级：`versions.json` → git log 自上 tag → 通用标题。
4. 校验 latest.json 含 version / url / signature 后上传 Release。
5. 产物：`*-setup.exe` + `*-setup.exe.sig` + `latest.json`。

### 版本与 notes

- `versions.json` 维护 `notes` / `date`；`assets.url`/`signature` 仅占位，运行时不读。
- bump 可用环境变量 `WUI_RELEASE_NOTES` 写入 notes；空 notes 时脚本会 WARN。
- `scripts/check-versions.ts` 校验 9 处版本号 + updater 生产 endpoint / pubkey / createUpdaterArtifacts。

### NSIS

- 自定义 `installer.nsi` 含 `/UPDATE`；passive 模式复用。
- 覆盖安装走安装段，不触发 `un.RemoveAppData`。

## 前端

### useUpdateStore (`packages/gui/src/stores/update.ts`)

```ts
status: 'idle' | 'checking' | 'available' | 'downloading' | 'installing' | 'error' | 'uptodate'
errorKind: 'check' | 'download' | null   // 驱动 retry 分流
update: { version, date, body } | null
progress: { downloaded, total, pct }     // total===0 → UI 走 indeterminate
error: string | null
badge: boolean
modalOpen: boolean

checkForUpdate(silent)  // 并发 check 去重；silent 失败不改 status
startUpdate()           // re-check 句柄 → downloadAndInstall → relaunch
retry()                 // check 失败 → checkForUpdate；download 失败 → startUpdate
dismiss()               // 仅 available/error 可关；下载中 no-op
```

### UpdateModal.vue

- z-index 1400；关闭契约同 v0.1.5（下载/安装中不可关）。
- 主按钮使用全局 `btn btn-primary`。
- `total === 0` 时下载态用 shimmer +「已下载 X.X MB」。
- error 重试走 `store.retry()`，不一律 `startUpdate()`。

### 启动静默检查

- `App.vue runBoot()` 在 `booted = true` 之后 `checkForUpdate(true)`。
- 不与后台 scrape 竞争；失败仅 `clientLog`。

## DEV UI 调试（日常 `bun run dev`）

`import.meta.env.DEV` 时启动后**自动** mock 有更新并打开弹窗（红点 +「更新」/「稍后」）。「更新」走假进度，**不** `downloadAndInstall` / `relaunch`。

生产 / CI release（`DEV === false`）仍走真实 `check()`。

可选 console 细调其它态：

```js
__WUI_DEBUG_UPDATE__.play()
__WUI_DEBUG_UPDATE__.error('check')  // 或 'download'
__WUI_DEBUG_UPDATE__.downloading({ total: 0 })
__WUI_DEBUG_UPDATE__.reset()
```

实现：`App.vue` boot 分支 + `utils/update-debug.ts` + `stores/update.ts`。

## 本地调试 updater 真链路（勿提交）

临时把 endpoint 指到本地 static server 可以验证签名下载，但：

1. 不要提交 conf 改动（CI / check-versions 会失败）。
2. 本地包需用同一私钥签名，否则校验失败。
3. 测完立即 `git checkout -- src-tauri/tauri.conf.json`。

## 验证清单

```
1. bun run scripts/check-versions.ts          → 版本 + endpoint 全绿
2. 公钥与 secrets 成对                         → 已发布 v0.1.5+ 有 .sig
3. cargo build / tauri build                   → feature updater 默认开
4. 启动后有新版本 → 红点 + 自动弹窗（更新 / 稍后）
5. 关于页「检查更新」→ checking 文案 → available 弹窗
6. 断网手动检查 → errorKind=check → 重试再 check
7. 下载失败 → errorKind=download → 重试再 startUpdate
8. 发布后 latest.json 可下载且 notes 非空（或 git log 回退）
```

## 风险备忘

- **perMachine + UAC**：passive 会弹 UAC，不可绕过；勿用 `quiet`。
- **私钥丢失 = 无法向旧版本推送更新**。
- **Content-Length 缺失**：进度走 indeterminate，不要误判为卡死。
- 不改 bundle id；无 WebView2 localStorage 迁移问题。
