# Agent 工作流

本文档是 `AGENTS.md` 的展开说明。它描述 Agent 如何安全地检查、修改、验证和交付
WonderfulUI；产品定义、架构和 ACLOS 字段应分别回到其唯一事实源。

## 1. 开始前

每项任务先执行：

```bash
git status --short --branch
git fetch origin
```

如果工作区有未提交内容，先识别归属。不要 reset、stash、覆盖或删除不属于本任务的
改动；无法安全避开时停在工作区冲突处。

如果任务需要独立审阅流，从最新 `origin/main` 创建 `dev/<description>` 分支；如果
目标分支已存在，使用安全后缀，绝不覆盖或强推。除非用户明确要求，不要向远程 push、
不要创建 PR、不要触发发布。

## 2. 读取正确上下文

| 任务 | 事实源 |
|---|---|
| 产品定位、用户文案 | `README.md`, `PRODUCT.md`, `DESIGN.md` |
| ACLOS 解密、snapshot、事件 | `docs/ACLOS_FORMAT.md` |
| Rust/Tauri/SQLite/IPC/构建 | `docs/ARCHITECTURE.md` |
| Vue、DOM、播放器、筛选和可访问性 | `docs/FRONTEND_CONVENTIONS.md` |
| 更新器、签名、NSIS、latest.json | `docs/UPDATER.md`, `VERSIONING.md` |
| 用户恢复路径 | `docs/TROUBLESHOOTING.md` |
| 提交、PR、发布边界 | `CONTRIBUTING.md`, 本文档 |

改动前用代码、配置和 workflow 验证文档中的版本、路径、脚本和行为。历史计划、日期审查
报告、个人机器数据都不是当前实现的事实源。

## 3. 共同安全边界

- ACLOS `WonderfulDb`、`snapshot<openid>` 和身份缓存只读；不读取、写入或删除 Riot、
  Valorant、WeGame 或 Vanguard 安装文件。
- 不启动、注入或附加到游戏、Riot Client、ACLOS、ACE 或 Vanguard 进程。
- 不提交真实 openid、昵称、标签、绝对路径、日志、视频、令牌或用户截图。
- 不通过硬编码一台机器的样本来修复解析器或 UI；应使用通用格式规则和安全 fallback。
- 文档整理不应扩展到业务逻辑、IPC、数据库、依赖、CSS、构建配置或工作流。现有源码
  只允许无行为影响的用户文案、文档链接和注释修正。

## 4. 标准修改循环

1. **检查**：读取 status、目标文件、引用、附近代码和现有测试。
2. **定义**：写出可验证的用户结果和非目标；对文档任务先确认当前实现。
3. **小步修改**：一次只处理一个问题域，保持路径和结构克制。
4. **验证**：先运行最小检查，再运行会被改动表面实际影响的完整检查。
5. **自审**：以新用户和贡献者视角各读一遍；检查死链、旧路径、平台夸大、敏感数据和
   未实现承诺。
6. **交付**：显式暂存路径，按问题域创建独立提交；只有用户要求时才 push/PR。

移动或删除文档后，必须全仓库搜索旧路径、旧标题和源码注释引用。若耐久事实只存在
于历史计划中，先迁入当前唯一事实源再删除历史过程资料。

## 5. 验证矩阵

### Markdown-only

```bash
git diff --check
```

另行检查所有 Markdown 相对链接，以及新增/删除路径在仓库内的引用。

### Vue 或用户可见文案

```bash
bun install --frozen-lockfile
bun run typecheck
bun run test:all
bun run assets:check
bun run --cwd packages/gui build
```

如果只改了文案/注释，仍然不要把这些命令的结果描述成 Windows 真机验证。浏览器 mock、
Vite 构建和单测只证明对应的本地/浏览器表面。

### Rust/IPC 或发布相关

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib
bun run scripts/check-versions.ts
bun run build
```

`cargo`/Tauri/NSIS/Firewall/UAC/Media Foundation 的完整证据需要 Windows。macOS 不能
编译或运行 Windows NSIS smoke test。

## 6. 提交与 PR

显式暂存本次路径，暂存前后都审阅：

```bash
git diff --stat
git diff
git add <explicit paths>
git diff --cached --stat
git diff --cached
git commit -m "docs: describe the change"
```

对于文档整理，2–4 个按问题域拆分的提交通常足够，例如产品叙事、贡献者上下文、历史
资料清理和纯 GUI 文案。不要每个文件一个提交，也不要把无关改动混进来。

若用户要求 Draft PR，先确认工作区干净、分支已 push，再以 `main` 为 base 创建 Draft PR。
PR 描述应包括：产品定位、文档分层、保留/重写/删除决策、网络与隐私边界、验证命令、
Windows 未验证范围、3–6 个需要维护者重点审阅的决策，以及仓库外 About/Topics/social
preview 建议（只建议，不擅自修改仓库设置）。

## 7. 发布与版本

不要在普通任务中运行 `bun run version:*`。这些脚本会更新版本文件、提交、创建 tag 并
push `main`/tag。正式发布由 `v*` tag 触发 `release.yml`，当前产物只有签名 Windows x64
NSIS 安装程序和 `latest.json`。

`.github/workflows/ci.yml` 名为 `Manual Check`，只在手动 dispatch 时运行；PR/push 不会
自动触发它。`cache-warm.yml` 为 `main` 上的发布和测试缓存预热，不要把缓存细节复制进
产品文档。
