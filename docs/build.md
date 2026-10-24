# 从源码构建

> 本页内容从瘦身前的首页 README 移来，原文完整保留在 [upstream-readme.md](upstream-readme.md)。

## AllitorFk 构建要点

- 两个 flavor：standard（minSdk 30）与 low（minSdk 23，带 GeckoView）。Full 版已取消。
- 产物另存为 `app/build/outputs/allitorfk/DSHA-AllitorFk.-dsh0.2.1-rc.2.apk` 与 `-low.apk`。
- 签名：Release 用本 fork 自己的测试密钥（与官方不同）；私钥不进仓库。
- 扩展包：`tools/resolve-extensions.py` 在官方 rootfs 的 qemu chroot 内解析并锁定版本，`tools/build-extensions.py` 可复现地打包，`tools/verify-extensions.py` 在 chroot 里逐包验证。扩展包不进 APK。
- 修改了 `app-integration` 等受管资产后需运行 `python3 -B tools/prepare-runtime-descriptor.py --write`。
- 测试报告：[单元测试](../allitorfk/reports/unit-tests.md) · [扩展包验证](../allitorfk/reports/ext-verify.md)。Node 测试：`node tools/test-extensions.mjs`、`tools/test-native-ime.mjs`、`tools/test-mobile-compress-once.mjs`。

## 上游构建说明（原文）

### 构建

本地构建需要 JDK 17、Android SDK（API 37）、NDK 26 与 Python 3.9+，详见 [BUILD.md](../BUILD.md)：

```bash
bash build.sh                                # 默认构建 Standard Debug
bash build.sh :app:assembleLowRelease        # 构建 Low Release
bash build.sh :app:testStandardDebugUnitTest # 纯逻辑单测
python tools/verify-stability.py             # 稳定性验收门禁
```

离线 rootfs 不提交 Git；发布流程（签名、门禁、真机验收、产物替换）见 [BUILD.md](../BUILD.md) 与 [docs/releases/](releases)。
