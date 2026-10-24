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

## 接管审批防自批（二上级增量审查 T1/T2）
- **T1 屏幕自操作封锁**：审批框（及所有 /app/ask 提问框）显示期间，设备桥拒绝 `/app/ui/*` 与 `/app/vscreen/*`（`SELF_WINDOW_APPROVAL_OPEN`）；DSHA 自身 Activity 在前台时拒绝 `/app/ui/*`，目标窗口或 vscreen 启动包为 DSHA 自身时一律拒绝（`SELF_WINDOW_PROTECTED`）。无障碍层 `validateActionRoot` 与手势派发前再次检查（审批框打开或 DSHA 应用窗口可见即拒绝）。审批框 `FLAG_SECURE`，按钮 `setFilterTouchesWhenObscured(true)`、拒绝遮挡/部分遮挡触摸与 deviceId≤0 的注入事件、拒绝无障碍 ACTION_CLICK、对无障碍隐藏。
- **T2 签名审批**：新专用路由 `/app/allitor/approve`。原生侧自行校验 id(UUID)/scope/minutes(≤上限)/nonce(128 位)，用这些字段原生拼出对话框文字（含请求 ID；AI 理由标注“未经核实”并去除控制字符），真实点按后用 Android Keystore 不可导出 EC P-256 私钥对 `allitor-approval-v1|id|scope|minutes|nonce` 签名。web 侧每次生成新 nonce，只持有公钥（原生写入 `/root/.dsh/.allitor_approval_pub`，web 启动时读入并钉在内存，之后换文件无效）。抢占 127.0.0.1:3190 的进程或返回 “批准” 文本均无法通过验签；重放旧签名因 nonce 不同失败。
- **根本限制（需老板决策）**：授权状态（takeover grant）与公钥钉扎都在 proot 内的 web 进程内存里。同 UID 的 proot root 可经 `/proc/<pid>/mem` 或 ptrace 直接改写内存（把请求标为 granted、换公钥），也可在 web 启动前替换公钥文件。签名审批消除了“伪造 cookie + 伪造审批应答”这条路径，但**最终执法尚未移出 proot**。可行方案：由原生侧签发短时凭据并在原生侧执法（例如把 egress 代理搬到 Android 进程、仅对持有原生签发且未过期凭据的连接放行；预览分享同理由原生端口转发执法）。工作量较大，rc.3 未实施，请老板决定是否列入 rc.4。
- **同 UID 可读**：egress 代理的每次启动 token、Chromium CDP 管道均可被同 UID 进程经 `/proc/<pid>/fd`、`/proc/<pid>/environ|cmdline` 读到/接管；它们只防跨 UID 与误用，不防 proot 内 root。
- **会话清理**：browser_full 被撤销或到期（15 秒内的轮询）时自动清空全部站点 cookie 与 Chromium 配置；仍建议用后手动“清除会话”。
- localhost/.local/.internal 判断容忍末尾点（如 `localhost.`）。

## 未完成（子集）
- D1 核心热更新：`CoreHotUpdate`（已验证下载：大小上限 + SHA-256 + 版本白名单 + 最低应用版本；active/previous/staged 槽；试运行 2 次未报健康自动回滚；活动槽每次重新哈希，被篡改即回滚）已实现并有单测。尚未接入启动器：内置核心受签名运行时描述符约束，接入需让描述符承认更新哈希，另起一项。
- F2 加密备份、D2 设备/Shell 权限分级：基线已有（PortableBackupCrypto AES-256-GCM + CredentialProjection；DeviceGrants/NativeConsentPolicy），未重写。
