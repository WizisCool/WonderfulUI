# 故障排查

## 启动后没有高光

WonderfulUI 默认读取：

```text
%USERPROFILE%\AppData\Roaming\ACLOS\WonderfulDb
```

请按顺序检查：

1. ACLOS/“无畏时刻”已经安装并登录。
2. 客户端已经在对局结束后生成过至少一段高光。
3. 等待高光写入完成，再回到 WonderfulUI 刷新资料库。
4. 仍然没有结果时，在设置中执行一次“全量扫描”。

WonderfulUI 当前不能手动指定其他 ACLOS 数据目录。默认目录不存在、为空或没有有效账户
文件时，首次使用页面会显示检测结果。

## 扫描失败或部分账户缺失

ACLOS 正在写入 `WonderfulDb` 时，WonderfulUI 可能暂时无法解析文件。等待写入完成后
重新刷新；增量扫描仍然失败时，再执行“全量扫描”。全量扫描会重建 WonderfulUI 的
本地索引，不会修改 ACLOS 文件。

详细错误保存在：

```text
%LOCALAPPDATA%\wonderful-ui\logs\wonderful-ui.log
```

可以在设置的日志页面查看最近内容或打开日志目录。发送日志前，删去 openid、账户名、
用户名、绝对路径和其它无关数据。

## 视频无法播放或路径已经变化

WonderfulUI 使用 ACLOS 记录的原始视频路径，不会自动改写移动后的文件位置。

1. 重新挂载保存视频的磁盘、移动硬盘、NAS 或网络盘。
2. 确认视频仍然存在，当前 Windows 账户可以读取。
3. 回到应用执行全量扫描。
4. 如果文件已经被移动或删除，WonderfulUI 无法搜索新位置或恢复原视频。

## 快传无法访问

快传只在播放器中主动开启后监听 `22357/TCP`。扫码设备必须和电脑位于同一局域网。

1. 确认手机和电脑连接同一个 Wi-Fi 或 VLAN，不是访客网络。
2. 检查路由器是否开启 AP 隔离、客户端隔离或设备间访问限制。
3. 确认 Windows 防火墙允许 `WonderfulUI Quick Share` 规则。
4. 确认端口 `22357` 没有被其他程序占用。
5. 首次修复防火墙规则时，按 Windows 提示完成管理员授权。

企业策略、第三方防火墙和路由器隔离可能继续阻止访问，WonderfulUI 不会绕过这些限制。
关闭快传后，临时服务会停止；完整卸载会删除对应的防火墙规则。

## 更新失败

检查和下载更新需要访问 [GitHub Releases](https://github.com/WizisCool/WonderfulUI/releases)。

1. 先确认浏览器可以打开 Releases 页面。
2. 在设置的“关于”页面重新检查更新。
3. 网络不可达或签名校验失败时，应用会保留当前版本。

更新使用 Windows x64 NSIS 安装程序，不会下载 MSI 或便携包。

## 提交 Issue

报告普通问题时，请提供应用版本、Windows 版本、ACLOS 版本、复现步骤和脱敏日志。

不要公开真实路径、openid、昵称、视频文件名、快传 URL 或令牌。安全漏洞按
[安全策略](../SECURITY.md) 私密报告。

## 卸载与本地数据

NSIS 卸载器默认保留 WonderfulUI 的本地资料库和 WebView2 用户数据。需要清理资料库
时，可在卸载确认页勾选对应选项。卸载器不会修改或删除 ACLOS、游戏、Riot 或 Vanguard
目录；完整卸载会清理快传防火墙规则。
