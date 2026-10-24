# AllitorFk 自有资料（计划与进度）

这个文件夹放的是 **DSHA-AllitorFk.** 这个 fork 自己的资料。上游 DSHA 的文件都留在原来的位置，没有移动或删除，方便以后继续同步官方更新。

> 非官方修改版，不是官方发布，未经上游作者审核。上游 MIT 许可和版权声明原样保留，见仓库根目录 [LICENSE](../LICENSE)。
> *Unofficial fork material; not an official DSHA release and not reviewed by the upstream author.*

## 📌 基本信息
| 项目 | 内容 |
|---|---|
| 基线 | 官方 DSHA build190（`0.2.1-rc.2`），提交 `c750348a4d4b18edcb165a93b4ca66403b040b4c` |
| 包名 | `dsha.AllitorFk_.dsh0_2_1_rc_2`（官方 build190 的包名是 `dsh.android.client`，两者不同，可以同时安装） |
| 显示名 | 手机上显示 `DSHA-AllitorFk.`（不带版本号） |
| 文件名 | `DSHA-AllitorFk.-dsh0.2.1-rc.2`（APK 与以后的 Release 标题；已发布的测试版 Release 仍是小写 `dsha-…`，不改动） |
| 安装包 | 标准版 `DSHA-AllitorFk.-dsh0.2.1-rc.2.apk`（安卓 11+）；低版本 `DSHA-AllitorFk.-dsh0.2.1-rc.2-low.apk`（安卓 6+）；均为 arm64。Full 版已取消：16 个 .dshx 作为 Release 附件，扩展中心可导入或一键下载 |
| 签名 | 与官方不同（能与官方共存靠的是包名不同，与签名无关）。以后每次发布都要用同一把签名密钥，私钥绝不进仓库 |
| 发布状态 | 测试版 Release 已发布（测试签名，未经真机验证） |

## 🧩 已做内容
1. **改包名与官方共存**：只改 `applicationId`，并同步改掉 `app/src/main` 里写死包名的地方；provider authorities 跟随 `${applicationId}`。
2. **三引擎**：proot 仍是默认；proroot（官方，闭源上游二进制）与 bxroot（fix4 线，0.2.4，MIT，带锁文件）可在「配置」页选择。
3. **自动回退**：冷安装时 bxroot 预检**明确失败**才退回 proot；proroot/bxroot 连续 3 次**明确**启动失败（鉴权前进程以已知退出码退出）自动切回 proot。超时、看门狗、结果不明一律不计数、不自动切换，避免在半装好的环境上重装。
4. **Low 包**（安卓 6+，minSdk 23）。
5. **离线扩展中心**：参考 DSH-Kxxy 的思路重新编写，**不复制 Kxxy 的代码**。16 个扩展包（`.dshx`）：开发基础包、Clang/LLVM、JDK 21、Go、Rust、Android 构建工具（d8/aapt/apksigner/zipalign）、Kotlin、Gradle、Maven、Ruby、PHP、媒体、文档、TeX Live（含中文）、Ghostscript（AGPL，单独成包）、开发工具。全部是 Ubuntu 24.04 arm64 软件包（按 sha256 锁定）或官方上游构建（按 sha256 锁定），装进容器内的 Ubuntu；扩展 API 只走官方鉴权（authorizeIndex），不看 Host 头；AI 的默认权限不变。

## 📊 当前进度
- [x] 整理仓库结构（本文件夹、README 顶部说明）。
- [x] 代码改动（本地提交；累计改动可用 `git diff main allitorfk --` 查看）。
- [x] 本地构建三个 APK、单元测试、扩展包在 qemu chroot 里逐包启用/运行/移除验证。
- [ ] 真机测试（报告放 `reports/`）。
- [x] 测试版 Release（两个 APK + 16 个 .dshx）。
- [ ] 扩展中心一键下载（本地分支 allitorfk/phase4，待评审）。

已核实（只读核对 build190）：
- build190 已有 `low` 版本（minSdk 23）和 `WebPortPolicy`（fix4 的 Web 端口修复）。
- build190 里**没有** `tools/bxroot`，也没有 `ColdEngineFallback`；bxroot 是整套移植的。
- build190 的包名写在 `app/build.gradle`（`applicationId`）、`util/AppIdentity.java`、`ui/BrowserOriginRestore.java`（广播 action），以及 `ci/release-identity.json` 和 `tools/` 下若干发布检查脚本中。

## 📁 文件夹说明
- `docs/`：说明与笔记。[PLAN.md](docs/PLAN.md)（分阶段计划、三方优点取舍、官方 bxroot 分支对照）、[FIX4_NOTES_bxroot-fallback.md](docs/FIX4_NOTES_bxroot-fallback.md)（fix4 里 bxroot 与冷安装回退的要点）。
- `patches/`：累计补丁（基线 `c750348a` → AllitorFk）。发布时再生成放入。
- `reports/`：构建与测试报告。

## ⚠️ 未验证
- 没有任何真机测试记录：新包名下 proot / proroot / bxroot 冷安装、扩展包在手机 proot 里的启用速度与空间占用都未知。
- 两个包同时安装时，无障碍、Shizuku、前台服务是否互相干扰未知。
- 扩展包只在电脑上的 qemu chroot 里验证过功能，不代表手机上的性能。

## 🤝 协作规则
- 不移动、不删除上游文件；README 只在顶部加说明，下面的原文保持不变。
- 本 fork 自己的文档、补丁、报告都放在 `allitorfk/` 下。
- 仓库里不放 APK、扩展包二进制、私钥、令牌、账号或个人路径。
