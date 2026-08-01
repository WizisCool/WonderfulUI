<div align="center">
  <img src="packages/gui/src/assets/logo.svg" width="128" height="128" alt="WonderfulUI Logo">
  <h1>WonderfulUI</h1>
  <p><strong>Windows 无畏契约个人高光资料库</strong></p>
  <p>整理、搜索、筛选、回看和分享已经生成在本机的高光时刻。</p>
  <p>
    <a href="https://github.com/WizisCool/WonderfulUI/releases">
      <img src="https://img.shields.io/github/v/release/WizisCool/WonderfulUI?style=flat&label=版本" alt="Release">
    </a>
    <a href="https://github.com/WizisCool/WonderfulUI/blob/main/LICENSE">
      <img src="https://img.shields.io/github/license/WizisCool/WonderfulUI?style=flat&label=许可" alt="License">
    </a>
    <a href="https://github.com/WizisCool/WonderfulUI/releases">
      <img src="https://img.shields.io/badge/Windows-x64-blue?style=flat&label=平台" alt="Platform">
    </a>
    <a href="https://github.com/WizisCool/WonderfulUI/stargazers">
      <img src="https://img.shields.io/github/stars/WizisCool/WonderfulUI?style=flat&label=Stars" alt="Stars">
    </a>
  </p>
</div>

---

WonderfulUI 是一个面向 Windows 无畏契约玩家的桌面高光资料库。它读取已经由
ACLOS/“无畏时刻”生成在本机的资料，把分散的对局和视频整理成可以快速查找、回看和
分享的个人库。

它不是录制器、云相册或通用解析框架。查看已有高光时，不需要启动游戏、录制客户端、
Riot Client 或 Vanguard。

> WonderfulUI 以只读方式读取 ACLOS 的 `WonderfulDb` 和可选的
> `snapshot<openid>` 数据，不修改游戏或客户端文件。

## 能做什么

- **整理账户**：查看多个本地账户，调整账户顺序，并设置 WonderfulUI 内部的显示名称。
- **快速定位对局**：按搜索词、英雄、地图、模式、胜负、视频类型、MVP/SVP、日期筛选，
  也可以按击杀、KDA 和视频数量做表现筛选。
- **直接回看**：在应用内播放本地视频，查看击杀/死亡事件时间轴，快速跳转并预卷播放。
- **截图与快传**：从播放器截取当前画面；用户主动开启“快传”后，可用二维码让同一
  局域网中的设备下载当前视频。
- **资料库概览**：在设置中查看账户、对局和视频概览，按需增量刷新或全量重建本地索引。
- **本地优先**：地图、英雄和模式的常用展示资源随应用构建，核心浏览不依赖图片 CDN。

## 下载与安装

从 [Releases](https://github.com/WizisCool/WonderfulUI/releases) 下载最新版本。
当前公开产物是 Windows x64 的 NSIS 安装程序：

```text
WonderfulUI_<version>_x64-setup.exe
```

项目当前不提供 MSI 安装包、便携压缩包或解压即用版本。

安装后首次启动会检查 ACLOS 的默认资料目录：

```text
%USERPROFILE%\AppData\Roaming\ACLOS\WonderfulDb
```

你需要先让 ACLOS/“无畏时刻”在本机生成过高光数据。WonderfulUI 当前不提供手动
选择数据目录；如果资料目录不存在、为空或高光视频已经被移动，请参阅
[故障排查](docs/TROUBLESHOOTING.md)。

## 本地数据、网络与隐私

- 高光、账户和视频路径来自本机 ACLOS 数据；WonderfulUI 的索引、偏好和日志保存在
  `%LOCALAPPDATA%\wonderful-ui\`。应用不会把这些内容上传到 WonderfulUI 的服务器。
- 当前代码没有遥测、账号同步或后台上传功能，也没有云同步。
- 正式版本启动并显示主界面后，会通过 HTTPS 检查 GitHub Releases 的 `latest.json`，
  用于提示应用更新。设置中的“检查更新”也会访问该地址。
- “快传”只在用户主动点击后启动：应用会在本机监听临时的 `22357/TCP` HTTP 服务，
  用带令牌的局域网地址和二维码提供当前视频下载。它不是云上传；Windows 防火墙、
  路由器隔离和企业网络策略仍可能阻止访问。
- 常规资料库浏览不需要联网，但这不等于“完全不联网”或“纯离线”。

## 当前不包含的能力

为避免产生误解，当前版本不承诺以下功能：

- 删除或编辑 ACLOS 高光内容；
- 导出、备份或恢复资料库；
- 手动切换 ACLOS 数据目录；
- 便携解压运行；
- 云同步或跨设备资料库同步。

## 从源码运行

### 开发环境

- Windows 10/11 x64：运行 Tauri 应用和验证 NSIS 安装包需要 Windows。
- [Bun](https://bun.sh) 1.3.14（版本由仓库根目录 `.bun-version` 固定）。
- [Rust](https://rustup.rs) 1.88.0（版本由 `rust-toolchain.toml` 固定）。
- Tauri 2 所需的 Windows SDK 和 WebView2 开发环境。

### 常用命令

```bash
git clone https://github.com/WizisCool/WonderfulUI.git
cd WonderfulUI

bun install --frozen-lockfile
bun run typecheck
bun run test:all
bun run assets:check
```

浏览器调试只启动 Vue/Vite 和固定 mock 数据，不读取真实 ACLOS：

```bash
bun run dev:browser
```

在 Windows 上运行 Tauri 开发壳或构建安装包：

```bash
bun run dev
bun run build
```

`bun run build` 生成的安装产物位于 `target/release/bundle/nsis/`。地图、英雄和模式
资源的维护更新需要显式运行联网命令 `bun run update:valorant-metadata`；普通开发和
发布构建使用仓库中已有的资源来源。

## 文档与贡献

- [文档索引](docs/README.md)：按读者查找用户、贡献者和维护者文档。
- [故障排查](docs/TROUBLESHOOTING.md)：首次扫描、缺失视频、快传、更新和安全提交。
- [贡献指南](CONTRIBUTING.md)
- [安全策略](SECURITY.md)
- [贡献者公约](CODE_OF_CONDUCT.md)

维护者与 Agent 的上下文入口是根目录 [AGENTS.md](AGENTS.md)。产品、设计、架构和
ACLOS 数据格式等长期事实见 [文档索引](docs/README.md)，不要把历史实施计划当作
当前行为说明。

## 许可与声明

WonderfulUI 使用 [GNU GPL-3.0](LICENSE) 发布。

本项目与 Riot Games、Tencent、腾讯 ACLOS、WeGame 或无畏契约官方没有隶属关系。
游戏名称、标识和相关内容归其各自权利人所有。

## 致谢

- [Tauri](https://v2.tauri.app) 和开源依赖的维护者；
- ACLOS/“无畏时刻”提供本地高光数据来源；
- 为本项目提供反馈和测试的玩家。
