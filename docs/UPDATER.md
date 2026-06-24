# 自更新系统 (In-App Updater)

WonderfulUI 的应用内自更新方案。基于 `tauri-plugin-updater`（Tauri 2）+ GitHub Releases 托管，UI 与现有设计系统（暗色 oklch tokens、ShareModal 范式、MiSans 中文、`ph:*` 图标）一致。

> 本文档是实施权威依据。决策点已与用户确认：GitHub Releases 托管 / 静默检查+侧栏红点 / 2026-06-24 生成的新签名密钥（旧的 `WUI_UPDATER_KEY` secret 已删除）。

## 合规性

自更新只与项目自己的 GitHub Release 通信，**不触碰** Riot / Vanguard / ACLOS / `WonderfulDb`，不启动游戏客户端。下载 NSIS 安装包并覆盖安装是普通桌面行为，符合 `CLAUDE.md` 全部硬约束。

## 架构

```
GitHub Release (latest.json + setup.exe + setup.exe.sig)
        ▲ HTTPS check()
[src-tauri] tauri-plugin-updater + tauri-plugin-process
        ▲ invoke 经 Pinia store（组件不直接 invoke）
[packages/gui] useUpdateStore → UpdateModal.vue + 侧栏红点徽标 + 关于页入口
```

- **检查触发**：① 启动 boot 抓取结束、UI 显露后静默检查一次（失败静默）；② 设置 →「关于」页「检查更新」手动检查。
- **更新执行**：`update.downloadAndInstall(progress回调)` → 安装 → `relaunch()`。
- **安装模式**：perMachine NSIS + `installMode: "passive"`（NSIS 自带进度小窗 + 自动 UAC 提权，前端无需处理提权）。

## 签名密钥（已落地 2026-06-24）

- 公钥已写入 `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`（可入库）。
- 私钥保存在仓库外 `~/.tauri/wonderfului.key`（**绝不入库**）。
- GitHub repo secrets：`TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`（仅 CI 用）。
- 旧的 `WUI_UPDATER_KEY` secret 已删除（无对应公钥进过仓库，属未启用备用项，无遗留用户依赖）。
- **铁律**：`tauri.conf.json` 公钥必须与签名私钥同一对；丢失私钥/密码则无法再向旧版本推送更新——务必离线备份 `~/.tauri/wonderfului.key` 与密码。

## 后端 / 构建 / CI

### tauri.conf.json（已完成）
- `bundle.createUpdaterArtifacts: true`（v2 模式，Windows NSIS 产物 = `*-setup.exe` + `.exe.sig`，不打 `.nsis.zip`）。
- `plugins.updater`: `endpoints` 指向 `https://github.com/WizisCool/WonderfulUI/releases/latest/download/latest.json`；`pubkey` 填公钥内容；`windows.installMode: "passive"`。
- v2 无 `active` 开关——插件注册即生效，是否检查由前端 `check()` 决定。已移除旧的 `active/dialog` 字段。

### Cargo.toml（待办）
- `[features] default = ["updater"]`（正式构建默认带更新能力）。
- 新增 `tauri-plugin-process` 依赖（用于 `relaunch`）。
- `lib.rs:54` 的 `#[cfg(feature="updater")]` 注册块已就绪；补注册 `tauri_plugin_process::init()`。

### capabilities/default.json（待办）
- `permissions` 增加 updater 与 process 插件权限，以构建后 `gen/schemas` 生成的标识为准核对（如 `updater:default` / `process:default`）。

### release.yml（待办）
1. `bun run build` 前注入 `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secrets env。
2. build 后读取 `target/release/bundle/nsis/*-setup.exe.sig` 内容。
3. 生成 `latest.json`：
   ```json
   {
     "version": "0.1.5",
     "notes": "<来自 versions.json 该版本>",
     "pub_date": "<ISO8601>",
     "platforms": { "windows-x86_64": { "signature": "<.sig 内容>", "url": "<setup.exe Release URL>" } }
   }
   ```
4. `softprops/action-gh-release` 附 `latest.json` + `*-setup.exe` + `*-setup.exe.sig`。
- **核对**：v2 模式 NSIS 产物文件名需本地 `bun run build` 实测 `bundle/nsis/`。

### 版本脚本（待办）
- `versions.json` 仅维护 `notes` / `date`；`assets.url`/`signature` 不再手填，由 CI 在发布时回填 `latest.json`。
- `scripts/check-versions.ts` 仍校验 9 处版本号一致（不涉及 latest.json）。

### NSIS 兼容
- 自定义 `installer.nsi` 已含 `/UPDATE` 静默更新参数，updater passive 模式调起 setup.exe 时复用。
- 覆盖安装走安装段，不触发 `un.RemoveAppData`（仅显式卸载才触发），用户数据安全。

## 前端

### useUpdateStore (`packages/gui/src/stores/update.ts`，第 7 个 store)
```ts
state: {
  status: 'idle' | 'available' | 'downloading' | 'installing' | 'error' | 'uptodate',
  update: { version, date, body } | null,
  progress: { downloaded, total, pct },   // pct = downloaded/total
  error: string | null,
  badge: boolean,                          // 侧栏红点：有可用更新且未处理
}
actions:
  checkForUpdate(silent)   // silent=true(启动)失败静默; false(手动)失败 toast
  startUpdate()            // downloadAndInstall + 进度回调 + relaunch
  dismiss()                // 关闭弹窗，badge 保持
```
- 进度回调映射 `Started→total`、`Progress→downloaded+=chunk`、`Finished→installing`。
- 所有 `@tauri-apps/plugin-updater` / `plugin-process` 调用封装在 store action 内，组件不直接 invoke。

### UpdateModal.vue (`packages/gui/src/components/update/UpdateModal.vue`)
遵循 ShareModal 范式：
- `Teleport to="body"` + `<Transition name="update-modal">`。
- backdrop：`fixed inset-0; flex center; background: oklch(0 0 0 / 0.66)`，**z-index: 1400**（高于 Settings 1300，低于 Toast 1500）。
- 卡片：`width: 400px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: 0 16px 48px rgba(0,0,0,0.5)`。
- 动画：`cubic-bezier(0.16, 1, 0.3, 1)` 170ms，`scale(0.96) translateY(8px) → 1`；出口 120ms ease-in。`prefers-reduced-motion` 全局压缩到 1ms（项目已支持）。
- 关闭契约：Esc（capture）+ backdrop `@click.self` + `×`（`ph:x`）——**仅 `available`/`error` 态可关**；`downloading`/`installing` 禁用关闭以防丢失 update 句柄。

四态视图（同卡片内 `v-if` 切换，**无嵌套卡片**）：

| 态 | 头部 | 主体 | 底部按钮 |
|---|---|---|---|
| `available` | `ph:arrows-clockwise` + "发现新版本" | 版本对比 `v{当前} → v{新版}`（当前 `--ink-3`，新版 `--accent` 加粗）；其下 release notes（`--font-sans`/MiSans，**非 mono**；`max-height:220px; overflow:auto; color:var(--ink-2); white-space:pre-wrap`） | `立即更新`(`.btn-primary`) + `稍后`(`.btn` ghost) |
| `downloading` | "正在下载" + `pct%` | 复用 ShareModal/BootOverlay 进度条：6px 高、`border-radius:999px`、轨道 `var(--surface-2)`、填充 `var(--accent)`、`transform: scaleX(pct)`、`transform-origin:left`、`500ms cubic-bezier(0.4,0,0.2,1)`；下方 `已下载 X.X / Y.Y MB`（`--ink-3`、`--font-mono`） | 禁用「下载中…」(`.btn` disabled) |
| `installing` | "正在安装" | 进度条切 **indeterminate shimmer**（复用 `share-progress-shimmer` 1.6s 循环光带）+ "安装完成后将自动重启" | 禁用「安装中…」或无 |
| `error` | `ph:warning`(`--loss`色) + "更新失败" | 错误信息（`--ink-2`，可选中复制）；网络错误给"无法连接到更新服务器，请检查网络后重试" | `重试`(`.btn-primary`) + `关闭`(`.btn` ghost) |

- `uptodate` 不开弹窗：手动检查命中时 `ui.showToast('已是最新版本', 'ok')`。
- 焦点：弹窗挂载后聚焦主按钮。

### 侧栏徽标 + 关于页入口
- `AccountSidebar.vue` 齿轮 `ph:gear` 加红点：`position:absolute; 8px; border-radius:50%; background:var(--accent); border:2px solid var(--surface)`，`v-if="update.badge"`。
- `SettingsModal.vue` 关于页加「检查更新」行：`.settings-action` 紧凑 bordered 按钮 + `ph:arrows-clockwise`，点击 → `update.checkForUpdate(false)`。`badge` 为 true 时文案变「有新版本 vX.Y.Z →」直接打开 `UpdateModal`。

### 启动静默检查
- `App.vue runBoot()` 显露 UI 之后调用 `update.checkForUpdate(true)`（**不与后台抓取竞争**，避开启动竞争坑；失败静默）。

### 前端依赖
- `packages/gui`：`bun add @tauri-apps/plugin-updater @tauri-apps/plugin-process`。

## 验证清单
```
1. 密钥生成与配置（已完成）→ verify: gh secret list 含 TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)
2. tauri.conf.json updater 块（已完成）→ verify: 公钥非空
3. Cargo.toml + lib.rs process 注册 → verify: cargo build --features updater 通过
4. capabilities 权限 → verify: 启动无权限报错
5. release.yml latest.json → verify: 触发 release 后 releases/latest/download/latest.json 可下载且合法
6. update store + UpdateModal + 徽标 + 关于页 + 启动检查 → verify: bun run --cwd packages/gui test:components；bunx tauri dev 手动走 available→downloading→installing；断网走 error 重试
7. 版本一致性 → verify: bun run scripts/check-versions.ts
```

## 风险备忘
- **v2 NSIS 产物文件名**：文档对 v2 Windows 描述较简略，本地 `bun run build` 必须实测 `bundle/nsis/` 产物名。
- **perMachine + UAC**：passive 模式弹 UAC 提权小窗（Windows 安全机制，不可绕过）；勿用 `quiet`（perMachine 写 Program Files 静默安装会失败）。
- **启动检查时机**：必须在 `runBoot()` 显露 UI 之后，不与后台抓取竞争；失败静默。
- **私钥丢失=无法再向旧版本推送更新**——离线备份 `~/.tauri/wonderfului.key` 与密码。
- 不改 bundle id，无 WebView2 localStorage 迁移问题。
