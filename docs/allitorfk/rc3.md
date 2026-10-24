# AllitorFk rc.3（dsh 0.2.1-rc.3）

## 与 rc.2 共存
- applicationId `dsha.AllitorFk_.dsh0_2_1_rc_3`，标签 `DSHA-AllitorFk.`；无 sharedUserId，authorities 均随 `${applicationId}`。
- 端口 3180 / 3181 / 3190（rc.2 用 3080 / 3081 / 3090），数据目录 `DSHA-AllitorFk-rc3` 独立。
- 扩展目录为 rc.3 专用：base 三元组加入 `dshVersion`，rc.2 的 .dshx 会被拒绝。
- 已知共享：深链 `dsha://install`、`https://dsha.cc/install` 与 rc.2/官方版相同，系统会弹出应用选择。

## 新手引导（F5）
1. 首次启动完成环境安装后，打开 Web 界面。
2. 「扩展中心」按需安装工具包（如 jdk21、assetstudio-mcp、allitor-tools）。
3. 打开 `/__dsha/allitor` 控制台：这里审批 AI 接管请求、管理预览、查看批注与插件兼容性。
4. 如需 AI 代理工具：安装 allitor-tools 后，在 DSH 中添加 MCP 服务器，命令 `allitor-mcp`。
5. AI 调用 `allitor_takeover_request` 后，在控制台点「批准」才生效；随时可「撤销」或「全部撤销」。
6. 编译类任务可用 `allitor-build-check --expect 产物 -- 构建命令`：只重试网络/守护进程等瞬时错误。

## 安全模型
- 控制台与 API 走现有 authorizeIndex Cookie；写操作再要求同源 Origin、`x-dsha-allitor: 1` 与 JSON。
- AI 侧经 `/root/.dsh/allitor/agent.sock`（目录 0700，令牌 0600），无任何批准接口；授权只在 Web 进程内存。
- 预览文件以 128 位能力 ID 提供（沙箱 iframe 不携带 SameSite=Strict Cookie），CSP `sandbox`、只读、拒绝符号链接与私有目录。
- 文本浏览器只允许公网 http(s)，DNS 解析后拒绝私网/回环，仅 GET 表单，无 Cookie/JS。

## 未完成（子集）
- 浏览器：无 JS 执行、POST、登录态、截图、下载。
- F3 工具耗时卡片、F4 max_tokens 截断提示：需改 DSH 前端打包产物，未做。
- D1 核心热更新回滚：仅有现成 recovery runtime；未做在线热更新。
- F2 加密备份、D2 设备/Shell 权限分级：基线已有（PortableBackupCrypto AES-256-GCM + CredentialProjection；DeviceGrants/NativeConsentPolicy），未重写。
