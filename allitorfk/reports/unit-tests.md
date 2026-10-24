# 单元测试汇总（AllitorFk phase 3）

命令：`./build.sh testStandardDebugUnitTest testLowDebugUnitTest testFullDebugUnitTest`（JDK 17，电脑上 JVM 单测，不是真机）。2026-10-24（UTC+8），含 `SessionLauncherBinaryPinTest`。
数据来自 `app/build/test-results/<variant>/*.xml`。

| 变体 | tests | failures | errors | skipped |
|---|---|---|---|---|
| standard debug | 2148 | 0 | 0 | 1 |
| full debug | 2148 | 0 | 0 | 1 |
| low debug | 2148 | 0 | 0 | 74 |

skipped 是官方测试原有的跳过（推测为 `Assume` 条件，low 跳过较多），本 fork 没有禁用或跳过任何测试。
