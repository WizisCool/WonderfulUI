# 文档索引

WonderfulUI 的文档按读者分层。根目录 README 是普通用户的入口，下面的技术文档
描述当前实现；已完成的实施计划和日期审查报告等历史过程资料不属于当前行为说明。

## 普通用户

- [根目录 README](../README.md)：产品定位、下载、首次使用、网络与隐私边界。
- [故障排查](TROUBLESHOOTING.md)：首次扫描、视频路径、全量扫描、快传和更新问题。

## 外部贡献者

- [贡献指南](../CONTRIBUTING.md)：开发环境、验证命令、提交和 Pull Request 约定。
- [安全策略](../SECURITY.md)：私密漏洞报告和敏感数据边界。
- [贡献者公约](../CODE_OF_CONDUCT.md)
- [Pull Request 模板](../.github/PULL_REQUEST_TEMPLATE.md)
- [Issue 模板](../.github/ISSUE_TEMPLATE/)

## 维护者与 Agent

- [AGENTS.md](../AGENTS.md)：每次修改前应读取的短规则和事实入口。
- [Agent 工作流](AGENT_WORKFLOW.md)：检查、分支、提交、可选 PR 和发布边界。
- [版本管理](../VERSIONING.md)：版本唯一来源、同步检查和 Release workflow。
- [产品定义](../PRODUCT.md)：用户、能力、非目标和网络边界。
- [设计系统](../DESIGN.md)：视觉、组件、无障碍和文案约束。
- [架构说明](ARCHITECTURE.md)：Tauri、Vue、SQLite、IPC、扫描和构建事实。
- [ACLOS 数据格式](ACLOS_FORMAT.md)：只读数据源、字段语义和事件状态机。
- [前端约定](FRONTEND_CONVENTIONS.md)：DOM、播放器、筛选、图标和模态交互规则。
- [自更新系统](UPDATER.md)：GitHub Releases、NSIS、签名和更新 UI。

## 文档维护规则

- 产品和用户文案服从当前代码，不以历史计划或旧截图为事实。
- 与实现绑定的规则放在唯一的技术文档中，其他入口只链接过去。
- 不在仓库中保留个人机器路径、真实账户数据、一次性性能快照或已经完成的实施计划。
- 修改路径或删除文档后，先全仓库搜索旧路径，再运行 Markdown 相对链接检查。
