<div align="center">
  <img src="packages/gui/src/assets/logo.svg" width="128" height="128" alt="WonderfulUI Logo">
  <h1>WonderfulUI</h1>
  <p>Windows 无畏契约个人高光资料库</p>
  <p>把散落在本机的高光整理起来，随时查找和回看。</p>
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

WonderfulUI 把已经生成在电脑里的无畏契约高光整理成一个本地资料库。你可以按账户和
对局查找视频，直接播放、查看事件时间轴、截图，或把当前视频快传到同一局域网的设备。
回看时不需要启动游戏或录制客户端。

## 能做什么

- 整理多个本地账户，调整顺序并设置应用内显示名称。
- 按搜索词、英雄、地图、模式、胜负、视频类型、MVP/SVP、日期、击杀和 KDA 筛选对局。
- 在应用内播放视频，按击杀和死亡事件跳转，并支持预卷播放。
- 截取当前画面，或生成临时二维码把视频传到同一局域网的设备。
- 查看账户、对局和视频概览，按需增量刷新或全量重建本地索引。

WonderfulUI 只整理和读取已有高光，不会修改 ACLOS 内容。目前也不提供高光删除或编辑、
资料库导出或备份、自定义数据目录、便携版和云同步。

## 下载与首次使用

从 [Releases](https://github.com/WizisCool/WonderfulUI/releases) 下载最新的 Windows x64
NSIS 安装程序：

```text
WonderfulUI_<version>_x64-setup.exe
```

目前没有 MSI 或解压即用版本。

高光来自腾讯 ACLOS/“无畏时刻”。请先让它在本机生成过高光，WonderfulUI 会读取默认
目录：

```text
%USERPROFILE%\AppData\Roaming\ACLOS\WonderfulDb
```

`WonderfulDb` 和可选的 `snapshot<openid>` 始终按只读数据处理。WonderfulUI 当前不能
手动选择其他数据目录。没有发现高光、视频被移动或网络盘未挂载时，请查看
[故障排查](docs/TROUBLESHOOTING.md)。

## 网络和本地数据

- 高光索引、账户偏好和诊断日志保存在 `%LOCALAPPDATA%\wonderful-ui\`。
- 当前代码没有遥测、账号同步或后台上传。
- 正式版在主界面显示后通过 HTTPS 请求 GitHub Releases 的 `latest.json` 检查更新；
  设置中的手动检查也会访问该地址。
- 快传只在播放器中由用户主动开启。它会在本机临时监听 `22357/TCP`，用带令牌的
  局域网地址提供当前视频下载。
- 资料库浏览读取本地索引和随包资源；应用仍会在上述两种情况下使用网络。

## 从源码运行

桌面端面向 Windows 10/11 x64。开发环境还需要：

- [Bun](https://bun.sh) 1.3.14，版本由 `.bun-version` 固定；
- [Rust](https://rustup.rs) 1.88.0，版本由 `rust-toolchain.toml` 固定；
- Tauri 2 所需的 Windows SDK 和 WebView2 环境。

安装依赖并运行检查：

```bash
git clone https://github.com/WizisCool/WonderfulUI.git
cd WonderfulUI

bun install --frozen-lockfile
bun run typecheck
bun run test:all
bun run assets:check
```

只查看使用固定 mock 数据的前端界面：

```bash
bun run dev:browser
```

在 Windows 上运行桌面开发壳或构建 NSIS 安装程序：

```bash
bun run dev
bun run build
```

本地构建产物位于 `target/release/bundle/nsis/`。浏览器 mock、macOS 类型检查和 Vite
构建不能替代 Windows WebView2、安装器或真实 ACLOS 数据验证。更多开发说明见
[贡献指南](CONTRIBUTING.md)。

## 文档

- [文档索引](docs/README.md)
- [故障排查](docs/TROUBLESHOOTING.md)
- [贡献指南](CONTRIBUTING.md)
- [安全策略](SECURITY.md)
- [贡献者公约](CODE_OF_CONDUCT.md)

## 许可与声明

WonderfulUI 使用 [GNU GPL-3.0](LICENSE) 发布。

本项目与 Riot Games、腾讯、ACLOS、WeGame 或无畏契约官方没有隶属关系。游戏名称、
标识和相关内容归各自权利人所有。
