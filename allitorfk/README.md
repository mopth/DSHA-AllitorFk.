# AllitorFk 自有资料（计划与进度）

这个文件夹放的是 **DSHA-AllitorFk.** 这个 fork 自己的资料。上游 DSHA 的文件都留在原来的位置，没有移动或删除，方便以后继续同步官方更新。

> 非官方修改版，不是官方发布，未经上游作者审核。上游 MIT 许可和版权声明原样保留，见仓库根目录 [LICENSE](../LICENSE)。
> *Unofficial fork material; not an official DSHA release and not reviewed by the upstream author.*

## 📌 基本信息
| 项目 | 内容 |
|---|---|
| 基线 | 官方 DSHA build190（`0.2.1-rc.2`），提交 `c750348a4d4b18edcb165a93b4ca66403b040b4c` |
| 包名 | `dsha.AllitorFk_.dsh0_2_1_rc_2`（官方 build190 的包名是 `dsh.android.client`，两者不同，可以同时安装） |
| 显示名 / 文件名 | `dsha-AllitorFk.-dsh0.2.1-rc.2` |
| 安装包 | 标准版 `dsha-AllitorFk.-dsh0.2.1-rc.2.apk`（安卓 11+）；低版本 `dsha-AllitorFk.-dsh0.2.1-rc.2-low.apk`（安卓 6+）；均为 arm64 |
| 签名 | 与官方不同（能与官方共存靠的是包名不同，与签名无关）。以后每次发布都要用同一把签名密钥，私钥绝不进仓库 |
| 发布状态 | **尚未发布** |

## 🧩 计划内容
1. **bxroot 引擎 + 冷安装自动回退**（来自我们之前的 fix4）：bxroot 预检明确失败时自动退回 proot；结果不明时不自动重试。
2. **Low 包**（安卓 6+，minSdk 23）。
3. **内置离线扩展**：参考 DSH-Kxxy 的思路重新编写，**不复制 Kxxy 的代码**。
4. **改包名与官方共存**：只改 `applicationId`，并同步改掉写死包名的地方（见 [docs/FIX4_NOTES_bxroot-fallback.md](docs/FIX4_NOTES_bxroot-fallback.md) 第 4 节）。

## 📊 当前进度
- [x] 整理仓库结构（本文件夹、README 顶部说明）。
- [ ] 代码改动（另行进行，完成后补丁放 `patches/`）。
- [ ] 构建与真机测试（报告放 `reports/`）。
- [ ] 发布。

初步核对（只读，未改代码）：
- build190 已有 `low` 版本（minSdk 23）和 `WebPortPolicy`（fix4 的 Web 端口修复）。
- build190 里**没有** `tools/bxroot`，也没有 `ColdEngineFallback`，所以 bxroot 需要整套移植，不只是 fix2–fix4 的小修复。
- build190 的包名写在 `app/build.gradle`（`applicationId`）、`util/AppIdentity.java`、`ui/BrowserOriginRestore.java`（广播 action），以及 `ci/release-identity.json` 和 `tools/` 下若干发布检查脚本中，改包名时都要处理。

## 📁 文件夹说明
- `docs/`：说明与笔记。现有 [FIX4_NOTES_bxroot-fallback.md](docs/FIX4_NOTES_bxroot-fallback.md)（fix4 里 bxroot 与冷安装回退的要点）。
- `patches/`：累计补丁（基线 `c750348a` → AllitorFk），方便审阅改动。暂为空。
- `reports/`：构建与测试报告。暂为空。

## ⚠️ 未验证
- 尚无任何构建，也没有真机测试记录。
- 新包名下 bxroot / proot 冷安装的真机表现未知。
- 两个包同时安装时，无障碍、Shizuku、前台服务是否互相干扰未知。

## 🤝 协作规则
- 不移动、不删除上游文件；README 只在顶部加说明，下面的原文保持不变。
- 本 fork 自己的文档、补丁、报告都放在 `allitorfk/` 下。
- 仓库里不放 APK、私钥、令牌、账号或个人路径。
