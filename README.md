<div align="center">
  <img src="packages/gui/src/assets/logo.svg" width="128" height="128" alt="WonderfulUI Logo">
  <h1>WonderfulUI</h1>
  <p><strong>无畏时刻 · 离线高光集锦浏览器</strong></p>
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
  <br>
</div>

---

WonderfulUI 是一个 **离线** 的 Valorant 无畏时刻高光集锦浏览器。它直接从 ACLOS 本地缓存中读取比赛与高光数据，提供快速的 SQLite 索引浏览、击杀/死亡事件时间轴标记、MVP/SVP 成就徽章，以及本地视频播放。**无需启动 Valorant、WeGame、Riot Client 或 Vanguard。**

> ⚠️ 本项目仅以只读方式访问 ACLOS 本地缓存，不会修改任何游戏数据、不会启动游戏客户端、不会触发反作弊系统。

---

## 截图

<div align="center">
  <i>（截图待补充）</i>
</div>

---

## 功能亮点

- **🔍 本地索引** — 将 ACLOS 数据导入 SQLite，支持增量/全量扫描，秒级检索
- **⏱️ 事件时间轴** — 击杀/死亡事件自动识别，进度条可视化标记，2 秒预卷播放
- **🏅 成就徽章** — MVP/SVP 自动识别与筛选（基于 snapshot 数据）
- **🎬 视频播放** — 内置播放器，直接播放本地高光视频
- **📦 纯离线** — 无需网络连接，不收集任何数据
- **🌐 中文界面** — 完整中文语言支持，MiSans 字体

---

## 下载与安装

从 [Releases](https://github.com/WizisCool/WonderfulUI/releases) 页面下载最新版本安装包：

| 文件 | 说明 |
|---|---|
| `WonderfulUI_*_x64-setup.exe` | Windows 安装程序 |
| `WonderfulUI_*_x64_en-US.msi` | MSI 安装包（可选） |

### 系统要求

- Windows 10 / 11（x64）
- ACLOS 无畏时刻已安装且产生过高光数据
- 无需 Valorant / Riot Client / Vanguard 运行

---

## 自行构建

### 前置依赖

- [Bun](https://bun.sh) 1.1+
- [Rust](https://rustup.rs) 1.77+
- [Tauri 2.0+](https://v2.tauri.app) 构建工具链
- Windows SDK（使用 Tauri 构建工具链安装）

### 步骤

```bash
# 克隆仓库
git clone https://github.com/WizisCool/WonderfulUI.git
cd WonderfulUI

# 安装前端依赖
bun install

# 开发模式（热重载）
bun run dev

# 生产构建
bun run build
```

构建产物位于 `src-tauri/target/release/bundle/`。

---

## 使用方法

1. 启动 WonderfulUI
2. 点击 **扫描目录** 或直接使用系统默认的 ACLOS 路径
3. 浏览账户列表，选择比赛查看详情
4. 点击高光视频进行播放
5. 点击进度条上的事件标记跳转到对应击杀/死亡时刻

---

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Vite + TypeScript + DOM API |
| 后端 | Rust + Tauri 2 |
| 存储 | SQLite（bundled via rusqlite） |
| 解析器 | Rust（进程内）+ TypeScript（CLI/测试双实现） |
| 包管理 | Bun |

---

## 项目结构

```
WonderfulUI/
├── packages/
│   ├── gui/         前端（Vite + TS + DOM）
│   └── parser/      ACLOS 格式解析器（TS）
├── src-tauri/       Rust 后端（Tauri 2 shell）
├── scripts/         工具脚本
├── LICENSE          许可协议
├── README.md        说明文档
└── versions.json    版本清单
```

---

## 贡献

欢迎参与贡献！详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

所有贡献者请遵循 [贡献者公约](CODE_OF_CONDUCT.md)。

---

## 许可协议

本项目以 **GNU General Public License v3.0** 许可发布。详见 [LICENSE](LICENSE)。

---

## 致谢

- **[ACLOS / Tencent 无畏时刻](https://www.wegame.com.cn/)** — 数据来源
- **Riot Games** — Valorant 游戏内容
- **[Tauri](https://v2.tauri.app)** — 桌面应用框架
- 所有开源依赖的作者
