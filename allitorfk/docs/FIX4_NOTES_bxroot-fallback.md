# fix4 里 bxroot 和冷安装回退的要点（供 DSHA-AllitorFk. 参考）

来源：我们之前的 fix4 公开仓库（mopth/dsha021-build-fix4，提交 e6420cd），以及 dsha-build 中 fix2–fix4 的提交。只读整理，没有改任何代码。

## 1. 来历：bxroot 不是 fix4 加的
- bxroot 来自 dsha-build 的 build172（CHANGELOG 写着“默认与首次升级优先 bxroot，保留 proot 兼容选择……引擎启动失败后才有限回退”）。fix 系列是在这个基础上修的：
  - fix2 `f4d382c`：bxroot 预检失败时回退到 proot（冷安装和应急 DSH 都覆盖），并补充能力回执。
  - fix3 `d12aee3`：把过期的 `libdsha-session.so` 换成可复现构建的 V2（带 `--control`），并加了防过期启动器的检查。
  - fix4 `1d0774c`：Web 端口探测遇到绑定错误不再中止启动，同时修了恢复 agent 的报错细节。
- **要点：** 当时手头的官方 DSHA 副本停在 build171（`467c7eb`），没有 `tools/bxroot`。build190（`c750348a`）里有没有 bxroot，要先核实。如果 build190 已经自带，只需要移植 fix2–fix4 的修复；如果没有，就得把 build172 起的整套 bxroot 一起带过来，工作量会差很多。

## 2. 要带过来的文件（fix 补丁一共 35 个文件，见 dsha-fix4/patches/*.patch）
- 回退核心：`runtime/ColdEngineFallback.java`（只在预检**明确失败**时才 bxroot→proot，生成脱敏原因），配 `ColdEngineFallbackTest`。
- 引擎资格判定和执行：`RuntimeEngineQualification`、`RuntimeExecution`、`RuntimeTools`、`ColdToolsInstaller`、`IsolatedInstallProcess`。
- 进程出生身份（坑最多）：`OwnedBirthEvidence`、`ProcessBirthHandshake`、`NativeTreeControl`、`BoundedGuestSessions`、`BoundedGuestBootRecovery`。fix2 让它在 `/proc` 和 getsid 被拒的手机上也能放行，并把等待改成 15 秒，各类错误分开报告。
- 恢复：`recovery/RecoveryController`、`RecoveryRuntime`、`RecoveryToolchain`、`assets/recovery-agent.js`。
- 原生库：`jniLibs` 里的 `libbxroot*.so`、`libdsha-session.so`（必须是 V2）、`libproot*.so`，加上 `assets/bxroot-native-lock.json` 和 `runtime-descriptor.json`。构建脚本在 `tools/bxroot/`（build.py、lock.json）。
- Web 端口：`util/WebPortPolicy.java`（fix4）。

## 3. 必须带过来的坑
1. **未知结果不能重放。** 回退只在“确定失败”时触发；超时、状态不明一律不自动切换，否则会在半套环境上再装一遍。
2. **`libdsha-session.so` 版本。** V1 不带 `--control`，会导致会话起不来。要用 `SessionLauncherBinaryTest` 卡住。
3. **出生身份校验。** 在部分国产 ROM 上，`/proc` 和 getsid 读不到。照搬旧逻辑会直接判失败，要带上 fix2 的放宽和对应测试。
4. **bxroot 失败的根因 fix4 也没查清。** 真机上仍然是 proot 下冷安装能成功。所以回退这一条必须有，宣传时不要说 bxroot 一定可用。
5. **Low 包**：minSdk 23，带 GeckoView 143（`lowImplementation`），只有 arm64。standard 包 minSdk 30，带 Shizuku。资产由 `tools/prepare-standard-assets.py` 生成，两版共用。

## 4. 改包名、和官方包共存时要注意（fix4 没做，是新坑）
- 改 `applicationId` 就够了，Java 命名空间 `com.deepseekharness.app` 不用动。Manifest 里 provider 的 authorities 用的都是 `${applicationId}`，会自动跟着变。
- **写死的地方要改**：`ui/BrowserOriginRestore.java:13` 里的广播 action `com.dsh.client.ORIGIN_RESTORE_QUIESCE`，两个包同时装时会互相串，必须跟着新包名走。`HttpShellService`、`BridgePathPolicy` 里只是注释提到。`GuestDataResolver` 是按正则取包名，没写死。
- **发布检查会拦**：`ci/release-identity.json` 写死了 `com.dsh.client` 和 E7E3 证书指纹，`tools/check-release-prerequisites.py` 等也写死了。新包名加新签名必须改这些检查，不能为了过检查把它关掉。
- 非 main 目录里还有约 196 处 `com.dsh.client`（debug 审计、网站、测试脚本、文档），不影响 APK，但会让测试失败或误导人。
- 签名：fix4 用的是 debug 签名。AllitorFk 能和官方共存靠的是包名不同，跟签名无关。但以后要覆盖升级，就得一直用同一把 key，所以第一次就要定好。私钥不能进仓库。

## 5. 版本号
- fix4：versionCode 178，versionName `0.2.25-20261018.0230-dsh0.2.1-rc.2-fix4`。新包名是全新安装，versionCode 可以重新起，但建议从大于 190 的数开始，免得混淆。

## 未验证
- build190 的具体内容。
- 新包名下 bxroot 或 proot 冷安装的真机表现。
- 两个包同时装时，无障碍、Shizuku 和前台服务会不会互相干扰。

## 补充核对（整理仓库时，只读）
- build190（`c750348a`）里**没有** `tools/bxroot`，也没有 `ColdEngineFallback`；`WebPortPolicy` 和 `low` 版本（minSdk 23）已有。所以 bxroot 需要整套移植。
- build190 的官方包名是 `dsh.android.client`（不是 fix4 的 `com.dsh.client`），写在 `app/build.gradle`、`util/AppIdentity.java`、`ui/BrowserOriginRestore.java`，以及 `ci/release-identity.json` 和多个发布检查脚本里。
