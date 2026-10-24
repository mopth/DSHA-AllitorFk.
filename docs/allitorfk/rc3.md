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

## 授权 Cookie 签名密钥核查（审查项 3）
- 结论：**可读**。DSH 的浏览器会话签名密钥存于 `/root/.dsh/.credentials.yaml`（0600，属主 root），而 AI 的 shell 工具在同一 proot 内以 root 运行，因此能读到密钥并伪造 authorizeIndex Cookie；启动令牌同理可从进程信息取得。仅靠 Cookie + Origin 不能证明是人点击。
- 修复：批准接管（`/api/takeover/decide` 且 approve=true）额外要求 Android 原生弹窗确认——Web 进程经设备桥 `/app/ask` 请宿主 App（proot 外）弹出「批准 / 拒绝」，只有用户点「批准」才生效；桥不可用、App 在后台、超时或关闭弹窗一律按拒绝处理（fail closed）。拒绝、撤销等收紧方向的操作仍只需 Cookie。
- 残余风险：AI 若另获无障碍/虚拟屏点击能力，理论上可尝试点击该弹窗；这些能力本身另有原生授权，建议接管期间不要同时授予。持有伪造 Cookie 的 AI 仍可添加批注、停止预览、清除会话（均不扩大权限）。

## browser_full 下载与 GitHub 白名单
- 应用其它下载路径（插件、扩展、更新）仍只允许既有的 GitHub 白名单来源。`browser_full` 的「下载到沙箱」是**单独授权的例外**：仅在用户对该次 `browser_full` 请求批准（含原生弹窗确认）后、在其时限内可用，任意公网 http(s) 来源，落到 `/root/allitor-downloads`，50 MiB 上限，不会被自动安装或执行。

## 未完成（子集）
- D1 核心热更新：`CoreHotUpdate`（已验证下载：大小上限 + SHA-256 + 版本白名单 + 最低应用版本；active/previous/staged 槽；试运行 2 次未报健康自动回滚；活动槽每次重新哈希，被篡改即回滚）已实现并有单测。尚未接入启动器：内置核心受签名运行时描述符约束，接入需让描述符承认更新哈希，另起一项。
- F2 加密备份、D2 设备/Shell 权限分级：基线已有（PortableBackupCrypto AES-256-GCM + CredentialProjection；DeviceGrants/NativeConsentPolicy），未重写。
