# 安全策略

## 私密报告漏洞

发现可利用的漏洞时，请使用仓库页面的
`Security → Advisories → Report a vulnerability` 提交私密报告，不要公开创建包含漏洞
细节的 Issue。

如果页面没有这个入口，请只创建一条不含漏洞细节的 Issue，请求维护者提供私密沟通
方式；取得私密渠道后再发送复现材料。项目目前没有公开的安全邮箱。

报告中请写明：

- 受影响的 WonderfulUI 版本和 Windows 版本；
- 问题会造成什么影响，以及最小复现步骤；
- 是否需要特制 WonderfulDb、本地文件、局域网访问或特殊安装状态。

发送前删去真实 openid、绝对路径、快传 URL 和令牌，以及未经脱敏的日志。安全修复只
面向最新公开版本；旧版本的问题请先在最新版复现。

## 安全边界

- ACLOS 的 `WonderfulDb`、`snapshot<openid>` 和身份缓存只作只读输入。应用不修改
  ACLOS、游戏、Riot、WeGame 或 Vanguard 文件。
- 播放、定位、截图和快传只接受资料库中已经登记并经后端校验的本地视频路径。
- 当前代码没有遥测、账号同步或后台上传。索引、账户偏好和诊断日志保存在本机。
- 正式版通过 HTTPS 请求 GitHub Releases 的 `latest.json` 检查更新，安装包使用签名
  校验。
- 快传仅在用户主动开启时监听 `22357/TCP`，并使用随机令牌、Host 校验和本地子网
  防火墙规则。

## 不要公开的内容

- API key、密码、OAuth/JWT、签名私钥或其它凭据；
- 真实 WonderfulDb、snapshot、ACLOS 身份缓存、日志或视频；
- openid 与真实账户昵称的对应关系；
- 带有个人目录、NAS 地址、快传 URL 或令牌的截图和测试数据。

实现细节见 [架构说明](docs/ARCHITECTURE.md)、[ACLOS 数据格式](docs/ACLOS_FORMAT.md) 和
[自更新系统](docs/UPDATER.md)。
