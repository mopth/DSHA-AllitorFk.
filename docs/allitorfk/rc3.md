# AllitorFk rc.3（dsh 0.2.1-rc.3）

## 与 rc.2 共存
- applicationId `dsha.AllitorFk_.dsh0_2_1_rc_3`，标签 `DSHA-AllitorFk.`；无 sharedUserId，authorities 均随 `${applicationId}`。
- 端口 3180 / 3181 / 3190（rc.2 用 3080 / 3081 / 3090），数据目录 `DSHA-AllitorFk-rc3` 独立。
- 扩展目录为 rc.3 专用：base 三元组加入 `dshVersion`，rc.2 的 .dshx 会被拒绝。
- 深链：rc.3 独占 `dsha-rc3://install`；不再声明 `dsha://` 与 `https://dsha.cc/install`（仍可解析粘贴的旧链接）。

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
- 浏览器两档授权：`browser`（只读 GET）与 `browser_full`（≤60 分钟：POST 表单、按站点隔离的登录会话、下载到 `/root/allitor-downloads`（50 MiB 上限）、Chromium 引擎下执行 JS 与截图）。
  - 文本引擎：DNS 解析后拒绝私网/回环；隐藏字段与密码值不回显给 AI。
  - Chromium 引擎（设备上存在 Chromium 时，或设 `ALLITOR_CHROMIUM`）：每站点独立 user-data-dir，全部流量经本机公网专用出口代理（`--proxy-bypass-list=<-loopback>`，回环也走代理并被拒），禁用 QUIC 与非代理 UDP 的 WebRTC。
  - 控制台可按站点或全部清除会话（同时删除 Chromium 档案）。

## 未完成（子集）
- D1 核心热更新：`CoreHotUpdate`（已验证下载：大小上限 + SHA-256 + 版本白名单 + 最低应用版本；active/previous/staged 槽；试运行 2 次未报健康自动回滚；活动槽每次重新哈希，被篡改即回滚）已实现并有单测。尚未接入启动器：内置核心受签名运行时描述符约束，接入需让描述符承认更新哈希，另起一项。
- F2 加密备份、D2 设备/Shell 权限分级：基线已有（PortableBackupCrypto AES-256-GCM + CredentialProjection；DeviceGrants/NativeConsentPolicy），未重写。
