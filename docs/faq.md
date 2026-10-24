# 常见问题

> 本页内容从瘦身前的首页 README 移来，原文完整保留在 [upstream-readme.md](upstream-readme.md)。

## 和官方 DSHA 能同时装吗？

能。包名 `dsha.AllitorFk_.dsh0_2_1_rc_3` 与官方 `dsh.android.client` 不同，是另一个应用，不会覆盖或替换官方版。能共存靠的是包名不同，与签名无关。

## Standard 和 Low 能一起装吗？

不能。两者包名相同，只能装其中一个。

## 换版本为什么要卸载？

当前是测试签名。以后如果换成不同签名的版本，系统不允许覆盖安装，必须先卸载，卸载会丢数据，请先在 App 里备份。

## 用哪个引擎？

默认 proot（最稳）。proroot、bxroot 是实验引擎，可在「配置」页切换；bxroot 冷安装预检明确失败会退回 proot，实验引擎连续 3 次明确启动失败也会自动切回 proot，超时或结果不明不计数。

## 改动来自哪里？

- 官方 DSHA build190（`c750348a`）为基线。
- bxroot 与冷安装回退：官方 build172 起的 bxroot 整套，加上我们 fix2–fix4 的修复（fix4 仓库 mopth/dsha021-build-fix4，公开的 main 为 `fa71ef4`，本地提交 `e6420cd` 未公开）。
- 官方 `feat/bxroot-runtime` 分支：只采纳“三振切回 proot”，并收紧为只有明确失败才计数。
- DSH-Kxxy：只参考离线扩展中心的思路，代码全部重写（Kxxy 无许可证）。
- 取舍与对照详见 [PLAN.md](../allitorfk/docs/PLAN.md)、[FIX4 笔记](../allitorfk/docs/FIX4_NOTES_bxroot-fallback.md)、[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。

## 哪些还没验证？

没有真机测试记录：三种引擎在新包名下的冷安装、扩展包在手机上的速度与空间占用、一键下载、与官方版同时安装时无障碍/Shizuku/前台服务是否互相干扰。

## 已知限制

诚实列出来，省得你装完才发现：

| 项目 | 状态 | 说明 |
|---|---|---|
| 架构 | ⚠️ 仅 arm64-v8a | 32 位与 x86 设备不支持 |
| 系统 | ✅ Standard 11+ / Low 6+ | 老系统部分能力受系统限制（无线配对需 11+ 等，见 [android-low](android-low.md)） |
| 包体 | ⚠️ 本次 Standard 278.66 MiB | 内置完整 Ubuntu 环境的代价，换来的是免下载、免命令行 |
| bash 工具 | ✅ 可用 | 完整 Ubuntu 的 bash，agent 跑 shell 命令没有限制 |
| bash 的**沙箱隔离** | ⚠️ 不可用 | bubblewrap 要 unprivileged user namespace，Android sepolicy 不给 —— 容器派和 Termux 派都一样绕不过。约束靠 dsh 的权限档位：默认 `danger-full-access`，可在配置页改成 `workspace-write` 或 `read-only`。请自行判断风险 |
| 卓易通 / 鸿蒙 anco | ❓ 未验证 | 理论可行，尚无真机回归 |
| 悬浮条 | ⚠️ 需要授权 | 用 `TYPE_APPLICATION_OVERLAY` 自绘；免 ROOT 拿不到真正的「状态栏歌词」接口 |
| 数据位置 | ⚠️ 需要文件权限 | 「所有文件访问」被拒时数据留在私有目录，卸载即丢（自检会明确告知当前状态） |

## 与同类方案的关系

安卓上跑 dsh 目前有两条路，各有代价，说清楚比互相贴标签有用：

| | **容器派**（DSHA 走这条） | **Termux bootstrap 派** |
|---|---|---|
| 做法 | proot/proroot + 完整 glibc rootfs | 用 Termux 的包在 Android bionic 上裸跑 |
| 装机 | 装 APK 就完事 | 装 Termux → 敲命令 → 装工具链 |
| 环境 | 完整 Ubuntu，`apt` 与原生模块随便用 | 需要为 bionic 逐个打补丁 / 重编 |
| 开销 | 存在系统调用与文件 I/O 转译开销，实际耗时依设备与场景 | 无容器层，理论最快 |
| 沙箱 | 两边都受限 | 两边都受限 |
