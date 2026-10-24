# 安装与使用（DSHA-AllitorFk.）

> 本页内容从瘦身前的首页 README 移来，原文完整保留在 [upstream-readme.md](upstream-readme.md)。

## 下载

- Release：[https://github.com/mopth/DSHA-AllitorFk./releases/latest](https://github.com/mopth/DSHA-AllitorFk./releases/latest)（tag `dsha-AllitorFk.-dsh0.2.1-rc.2`）。
- Standard：`DSHA-AllitorFk.-dsh0.2.1-rc.2.apk`（Android 11+，minSdk 30，arm64，293,038,835 字节）。
- Low：`DSHA-AllitorFk.-dsh0.2.1-rc.2-low.apk`（Android 6+，minSdk 23，arm64，368,459,527 字节，内置 GeckoView）。
- 16 个离线扩展包 `.dshx` 也在同一个 Release；校验值见 Release 里的 `SHA256SUMS.txt`（`sha256sum -c SHA256SUMS.txt`）。
- 手机上显示名为 `DSHA-AllitorFk.`；包名 `dsha.AllitorFk_.dsh0_2_1_rc_2`，与官方 `dsh.android.client` 不同，可同时安装。
- Standard 与 Low 包名相同，只能装其中一个。
- 测试签名、尚未做真机验证。以后换不同签名的版本需先卸载（会丢数据，请先备份）。

## 本 fork 的主要内容

> ⚠️ 这是基于 [DSH-APP/DSHA](https://github.com/DSH-APP/DSHA) 的非官方修改版（fork），不是官方发布，未经上游作者审核，与上游作者无关。风险自负。

- 基于官方 DSHA build190（`0.2.1-rc.2`），提交 `c750348a`。
- 引擎：proot 仍是默认引擎，proroot、bxroot 可在「配置」页选择；bxroot 来自 fix4，带冷安装自动回退（预检明确失败才退回 proot）；实验引擎连续 3 次明确启动失败自动切回 proot（超时或结果不明不计）。详见 [runtime-engines.md](runtime-engines.md) 与 [FIX4 笔记](../allitorfk/docs/FIX4_NOTES_bxroot-fallback.md)。
- Low 包（安卓 6+）。
- 参考 DSH-Kxxy 思路重新编写的离线扩展中心（16 个扩展包，Ubuntu 24.04 arm64 软件包 + 官方上游工具链，未复制 Kxxy 代码），见 [extensions.md](extensions.md)。
- 本 fork 自己的资料放在 [`allitorfk/`](../allitorfk/README.md)，上游文件位置不变。

## 上游安装说明（原文）

### 上游 DSHA 下载与开始使用

当前正式版 **[v0.2.1-rc.2 · build190](https://github.com/DSH-APP/DSHA/releases/tag/v0.2.1-rc.2)** · Standard 标准版，Android 11+ / arm64 · **278.66 MiB**。

[下载 APK](https://github.com/DSH-APP/DSHA/releases/download/v0.2.1-rc.2/dsha-0.2.1-rc.2.apk) · [SHA-256](https://github.com/DSH-APP/DSHA/releases/download/v0.2.1-rc.2/dsha-0.2.1-rc.2.apk.sha256) · [完整源码与固定离线构建输入](https://github.com/DSH-APP/DSHA/releases/download/v0.2.1-rc.2/DSHA-0.2.1-rc.2-20261022.2100-source.zip) · [发布说明](releases/v0.2.1-rc.2-notes.md)

- **新旧共存**：新版包名 `dsh.android.client`，可与旧版 `com.dsh.client` 并排安装；数据和授权独立，需要迁移时使用备份导出/恢复。同时运行两套服务仍可能遇到设备端口冲突。
- **虚拟屏与全局授权**：实验性虚拟屏通过已授权的 ADB / Root / Shizuku 通道操作；确认策略支持全部手动、按应用和全部允许，仅控制 DSHA 确认，不代替系统授权或系统沙箱。
- **环境与交互更新**：内置 DSH **0.2.1-rc.2**、移动 UI **3.2.1**，默认 **proot**、可选 **proroot**；修复插件启动/管理、局域网与登录、键盘衔接和后台恢复等路径，会话单击切换。画中画**默认关闭**，由用户主动开启。
- **备份与数据保护**：一键备份/导出，保留用户数据；移除危险的彻底重装，外置工作区内容保留。

完整版本名 `0.2.1-rc.2-20261022.2100-dsh0.2.1-rc.2` / code190，E7E3 正式签名、非调试。保留 APK 原版本字符串，本次发布为 **GitHub 正式版 / Latest**。本次提供 Standard APK；旧 Low 发布保留，不新增 Low APK。

### 开始使用

1. 安装标准版 APK，首次启动准备内置离线环境。
2. 解压完成进入主页，Web 在后台启动；就绪后进入 Web UI，在网页中配置模型。
3. 从旧包迁移请先导出备份，再在新包恢复；以后同包覆盖更新前，请先正常停止 DSH。

精确 APK 已在 Android 13 对两种运行时、旧会话、插件状态及立即息屏启动做有限检查；页面延迟仍有波动，不承诺所有机型普遍提速或完整 Doze/功耗验收。详见[验证范围与已知限制](releases/v0.2.1-rc.2-notes.md)。[下载校验](download-verification.md)；官网与应用内更新清单独立于本次 GitHub 发布。

<details>
<summary>历史版本介绍（原文保留）</summary>

下表属于上一 build170 版本的比较说明；v1.1.10 及更早的 Release 正文和历史标签继续保留。

| 以前发布的版本 | 本版主要增加 |
|---|---|
| [v0.1.7-rc2 / 147，上一正式版](https://github.com/DSH-APP/DSHA/releases/tag/v0.1.7-rc2) | DSH 0.1.7 → 0.2.0 rc2、移动 UI 3.0.3 → 3.0.5，以及上面的文件、草稿、ADB、shell、插件和备份改进。 |
| [v0.1.5-rc2 / 129](https://github.com/DSH-APP/DSHA/releases/tag/v0.1.5-rc2) | 还累积加入自动备份、独立应急、按需录音、PiP、Standard 实验性虚拟屏及受管更新改进。 |
| [v1.1.10 及更早版本](https://github.com/DSH-APP/DSHA/releases/tag/v1.1.10) | 已转为双 APK、受管 Ubuntu/DSH 更新与宿主备份恢复；完整直接升级矩阵尚未重新验证，原版说明保留在历史标签。 |

</details>

## ADB 无线配对（设备 Shell 能力）

配好之后 agent 就能直接操作这台手机，**不需要 Shizuku**。

**首次配对（约 1 分钟）**

1. 系统设置 →「关于手机」→ 连点「版本号」7 次开启开发者选项
2. 开发者选项 → 打开「无线调试」
3. 进入「无线调试」→「使用配对码配对设备」，记下 **IP:端口** 与 **6 位配对码**
4. 回到 DSHA →「设备能力授权」页 → 填入 → 配对

> 无线调试的配对码需要 Android 11+；老系统可走 Shizuku / Root 通道，或直接用无障碍能力（读屏、点按、输入不需要任何配对）。

无线调试尚未开启时，“验证已有连接”可以先准备内置离线依赖；出现 `ADB_OFFLINE_READY` 仅表示依赖就绪。之后仍需打开无线调试并完成配对或连接验证。

**配对之后**：DSHA 自己维护连接（保活 + 重连），重启手机后也会自动恢复，不用再操作。

**验证**：内置终端里跑 `adb shell id`，输出 `uid=2000(shell)` 即成功。

**让 agent 用起来**：把技能包复制到 agent 的技能目录：

```bash
cp -r agent-skills/device-shell ~/.agents/skills/
cp -r agent-skills/screen-ocr-operator ~/.agents/skills/
```

`device-shell` 覆盖 ADB / Shizuku / Root 三通道的命令用法；
`screen-ocr-operator` 提供截屏 + OCR + 批量屏幕操作（无障碍读屏拿不到内容的 WebView / 游戏画面用）。

更多：[install-and-maintenance.md](install-and-maintenance.md)、[download-verification.md](download-verification.md)。
