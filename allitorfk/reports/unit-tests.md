# 单元测试汇总（AllitorFk phase 4）

命令：`./build.sh testStandardDebugUnitTest testLowDebugUnitTest`（JDK 17，电脑上 JVM 单测，不是真机）。2026-10-24（UTC+8），分支 allitorfk/phase4。
Full 版已取消，只有 standard 与 low 两个变体。数据来自 `app/build/test-results/<variant>/*.xml`。

| 变体 | tests | failures | errors | skipped |
|---|---|---|---|---|
| standard debug | 2152 | 0 | 0 | 1 |
| low debug | 2152 | 0 | 0 | 74 |

本阶段新增：`ExtensionReleaseLinksTest`（3）、`AllitorFkNamingTest`（1）；`SessionLauncherBinaryPinTest` 改为扫描全部 main 源码。
skipped 是官方测试原有的跳过（推测为 `Assume` 条件，low 跳过较多），本 fork 没有禁用或跳过任何测试。

Node 测试：`tools/test-extensions.mjs` 6 组全部通过（含一键下载：重定向白名单、续传 Content-Range、空闲/总时长超时、sha256 拒绝、空间预检、不跟随符号链接）；`tools/test-native-ime.mjs` PASS；`tools/test-mobile-compress-once.mjs` 7/7。
