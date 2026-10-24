# DSHA AllitorFk 计划（基线 c750348a / build190，分支 allitorfk/phase1）

写于 2026-10-24（新加坡时间）。标注：【核】已查文件/跑命令；【推】推断；【未】未验证。

## 第 1 阶段（已完成，本地）
- 包名改为 dsha.AllitorFk_.dsh0_2_1_rc_2；命名常量 `app/build.gradle` 的 `ext.dshaReleaseName`（显示名 / APK 文件名 / Release 名，Low 版加 `-low`）。
- 签名身份 = 仓库外的本地测试 key（cert sha256 4578bbcd…b2f7，写在 `ci/release-identity.json`）。是否作为长期身份需老板定。

## 第 2 阶段：bxroot + 冷安装回退 + Low（来源 fix4 e6420cd）
前提【核】：c750348a **不含 bxroot**（docs/runtime-engines.md:9“proot 默认、proroot 显式可选，不迁入 bxroot”，无 tools/bxroot、无 libbxroot*.so）。fix4 树也**没有 proroot**。所以是“三引擎合并”，不是补丁移植。
1. 原生与构建：从 fix4 带入 `tools/bxroot/`（build.py、lock.json、*.S/*.c）、`jniLibs/arm64-v8a/libbxroot{,-runtime,-ulx}.so`、`assets/bxroot-native-lock.json`、`tools/prepare-bxroot-native-proof.py`、许可 `assets/licenses/bxroot-*.txt`；登记进 `assets/managed-runtime-inputs.json`、`tools/asset-deployment.json`，重生 `runtime-descriptor.json`；THIRD_PARTY_NOTICES 增补。
2. 引擎层（实际落地，按代码核对）：新增 `runtime/RuntimeEngine`、`runtime/BxrootRuntime`、`runtime/BxrootPrivateRoot`；冷安装回退在 `runtime/ColdToolsInstaller` + `util/ColdInstallPlan`（+ `util/ColdRuntimeSelection`、`backup/ColdInstallTransaction`）；启动三振在 `util/WebRuntimeFallback` + `core/WebLifecycleController.countEngineStrike`。原计划里的 `EngineSpec`、`RuntimeEngineProbe`、`RuntimeEngineQualification`、`ColdEngineFallback`、`util/RuntimeEnginePolicy` **没有建**（功能并入上面这些类）。
3. 接入点（官方已有，需合并而非覆盖）：`runtime/ContainerRuntime`、`RuntimeLauncher`、`RuntimeExecution`、`RuntimeTools`、`ColdToolsInstaller`、`IsolatedInstallProcess`、`RuntimeHostPorts`、`RuntimeTrial`/`TrialSupport`、`util/ColdRuntimeSelection`、`ColdInstallPlan`、`WebProcSel`、`WebRuntimeFallback`、`core/ConfigStore`（引擎设置：proot/proroot/bxroot 三选，保留动态切换）、`core/EnvironmentMaintenance`、`WebLifecycleController`、`recovery/RecoveryController`、`RecoveryRuntime`、`runtime/RecoveryToolchain`、`ui/ConfigFragment`、`backup/HostRuntimeDiagnostics`。
4. 必带的坑：回退只在预检**明确失败**时 bxroot→proot，超时/未知不重放（fix2）；出生身份放宽沿用官方 `OwnedBirthEvidence`/`ProcessBirthHandshake`/`BoundedGuestSessions`。`libdsha-session.so` **保留官方版**（sha256 12ace2a0…，`strings` 只有 `--birth-handshake`）【核】：全树 Java 只在 `runtime/IsolatedInstallProcess.java:70` 传 `--birth-handshake`，没有任何 Java 传 `--control`（唯一出现在 `tools/bxroot/test-linux.py`，bxroot supervisor 的测试，与此库无关）【核：git grep】。fix3 冷安装失败正是 .so 与 Java 不配套所致，所以不换 V2；由 `runtime/SessionLauncherBinaryPinTest` 锁定 sha256、`--birth-handshake` 支持，并防止 Java 未换库就开始用 `--control`。fix4 的 Web 端口修复官方已有（`util/WebPortPolicy.java`）。
5. 默认引擎：官方默认 proot。是否改默认 bxroot = 老板决定；建议首版默认仍 proot、bxroot 可选+冷安装回退【推】。
6. Low：官方已有 `low` flavor（minSdk 23、GeckoView、`src/low/jniLibs/libproot_legacy.so`）【核】。产物 `<名>-low.apk`。bxroot 在 Android 6/7 是否可用【未】，Low 默认 proot。
7. 测试（实际存在）：`BxrootPrivateRootTest`、`BxrootRuntimeTest`、`ConfigStoreRuntimeSettingsTest`、`ColdInstallPlanTest`、`ColdRuntimeSelectionTest`、`ColdInstallTransactionTest`、`WebRuntimeFallbackTest`、`WebProcSelTest`、`SessionLauncherBinaryPinTest`。原计划的 `ColdEngineFallbackTest`、`RecoverySessionBindingsTest`、`HostRuntimeDiagnosticsTest`、`SessionLauncherBinaryTest` 未带入（对应类不存在或保留官方 .so）。

## 第 3 阶段：内置离线扩展（按 Kxxy 移植评估中的方案 B，全新实现，不抄 Kxxy）
1. 构建期：`tools/extensions/<id>.lock.json`（仿 `tools/ubuntu-tools/packages.lock.json`）、`tools/prepare-extensions.py`（仿 `prepare-ubuntu-tools.py`，qemu chroot 内 apt 解析，绑定 baseStatusSha256）、`assets/ext-catalog.json` 登记到 `tools/asset-deployment.json`；每包 install/purge 往返测试作为门槛。
2. 设备端：`runtime/ExtensionInstaller.java`（仿 `ColdToolsInstaller` + `ColdBundleTransaction` 空间预检）、`assets/install-extension.sh`（仿 `install-ubuntu-tools.sh`）、`assets/dsha-runtime-env.sh` 加 `/opt/dsha-ext/*/bin`。
3. Web：`assets/app-integration/index.js` 注册 `/__dsha/ext/*`，每个端点先 `scoped.connection.authorizeIndex`，写端点再验 Origin/CSRF；**不用 Host 头鉴权**；新增 `extensions.html`；导入走原生 SAF（`ui/` 新 Activity）。
4. 分发：`app/build.gradle` 加 `standardFull` flavor 或 `.dshx` 外置包（`noCompress += 'dshx'`）；GPL/AGPL 源码清单随 Release；THIRD_PARTY_NOTICES 增“扩展包”节。
5. 不做插件、不拼旧版；引擎/端口/ModelSetup 动态切换保持。

## 补充（2026-10-24 04:10 新加坡时间）
### proroot（官方可选引擎，闭源 v1.2.8）在改包名后
- APK 内 7 个 proroot 相关 so 齐全：libproroot{,-runtime,-linker,-stub-loader,-bridge}.so、libdsha-proroot-{compat,linker}.so【核】。
- 路径全部由 `runtime/ContainerRuntime.java:165-295`（Proroot 类）从 nativeLibraryDir/Context 运行时计算，没有写死包名【核：静态】；so 字符串里只有通用的 `/data/data/`、`/data/user/0/` 前缀，没有包名【核】。真机能否启动【未】。
- 第 2 阶段引擎设置做成 proot / proroot / bxroot 三选，保留动态切换；默认值暂不改（仍 proot）。

### “Failed to fetch” 下载 bug（双重压缩），官方 c750348a 中
- DSHA 压缩层：`app/src/main/assets/builtin-plugins/dsh-web-mobile/lib/compress.js:64-234`，改写全局 `ServerResponse.prototype` 的 writeHead/write/end，由 `lib/index.js:74` 挂到 WebServer 端口；只处理 4KiB–1MiB 的 JSON，`isDeferrable`（:21-29）已经会跳过带 Content-Encoding 的响应。注意 `src/compress.ts` 与随包的 `lib/compress.js` 不是同一版。
- 上游压缩层：DSH 运行时内 `@deepseek-ai/dsh-host-webserver/lib/index.js:196-221`（compression 1.8.2 + on-headers 1.1.0），只有 `webServer.compression: gzip` 时启用，默认 `none`（:109）。
- 本机复现（独立复现脚本，两层叠加 + 9 种响应写法 + HEAD）：**没有复现**双重编码，每种都只有一个 Content-Encoding，gzip 校验通过【核】。所以触发点还没找到【未】。下一步要拿到真机上失败请求的 URL 和 `curl -sv` 输出；修法定为“已有 Content-Encoding 就原样透传，并保持 Content-Length 一致”，不关上游压缩。

## 第 2 阶段补充：首页键盘（老板录屏，2026-10-24）
- 根因【核：夹具】`web-integration/ime.js`（c750348a）:56 `offset = min(0, visible - innerHeight)` 对 seat 整体平移整段键盘高度。active 相位的 seat 贴底（sticky）时这样做正确；首页 hero 相位的 seat 由官方 `.wSkVaW_root[data-phase=hero] .wSkVaW_scrollBody{justify-content:center}`（dsh-client-ui-conversation lib/client.js:17325 css$4）居中，seat 包含 HeroShell+工作区行+输入框（:17835-17855）。在真实官方 CSS + 移动插件的夹具里（360×800，键盘 300）：输入卡片被推到键盘上方约 304px（卡片底 196，键盘顶 500），原生末态 resize 后又回落约 150px（即瞬跳）。
- 双重补偿【核：代码】：原生 `WebFullscreenUi.render()`:207-218 在动画结束时按键盘高度 padding（resize）；JS 又按整段键盘高度平移。贴底 seat 时两者等价，居中 seat 时不等价 → 落差与跳变。adjustResize（Manifest:68/151）在 decorFitsSystemWindows=false 且原生消费 insets 时不会再缩一次【推】。
- 左移/上移/竖滚动条：夹具未复现横向溢出【未】；推测为 Chromium 聚焦输入框 scroll-into-view 移动了根文档，根文档本应永不滚动（移动插件 frame 注释）【推】。
- 修复（只改 DSHA 自有 `web-integration/ime.js`）：hero 绝对目标 `min(anchor, visible+lift)`（:89），键盘未碰到前不动，之后贴键盘上沿 8px 随动，末态 resize 后位置不变；根滚动守卫 `clampRoot`（:144）+ `html[data-dsha-root-lock]{overflow-x:hidden}`（:24），只在 frame 存在且未缩放时生效；不支持逐帧桥（无 CSS translate 等）时 hero 用一次 FLIP 过渡（:119），减弱动效时不动画。
- 测试：`tools/test-native-ime.mjs` 新增 hero 开合、根守卫、FLIP/减弱动效；用旧 ime.js 跑新测试会失败（负控）。真机【未】。

## 第 2 阶段补充：侧栏「插件」弹层残留（老板截图）
- 来源【核：检索】：'浏览更多插件' / '创建你的插件' 在 rc.2 运行时（全部 @deepseek-ai 包）、npm rc.3 的 plugin-manager/plugin-market/sidebar、DSHA 全部资产里都找不到；rc.2 的侧栏「插件」是打开面板（dsh-client-ui-plugin-manager lib/client.js:4477 sidebar.panellist → selectPanel），不是弹层。所以该弹层来自设备上另装的插件或别的运行时版本【推】，源码不在本仓【未】。
- 机制【核：夹具】：宿主 primitives `Menu`（lib/index.js:4000）portal 到 body，position:fixed，每帧按锚点重新定位并夹回视口（:4051-4085，MARGIN=12），关闭只认 document pointerdown / Escape / window blur（:4123-4191）。抽屉经返回键、导航等非指针路径关闭时没有 pointerdown，菜单就留着，锚点滑出屏外后被夹在左上可见区，悬在聊天页上。
- 修复（DSHA 自有 `web-integration/ime.js`:186 起的 `__dshaPopoverGuard`）：只在手机 frame 下、抽屉已关闭时，对残留 [role=menu] 发 Escape（宿主自己的关闭路径，与移动插件同一做法）。触发：抽屉关闭、会话切换、popstate/hashchange、外部点按、用户手势滚动（流式自动滚动不算）、resize 时触发器全部不可见。不认 Escape 的第三方弹层只隐藏，不伪造指针事件；再点触发器即撤销隐藏。抽屉开着时不发 Escape，因为那会顺带关掉抽屉。
- 测试：`tools/test-native-ime.mjs` 用真实宿主 Menu 做负控（无守卫时会残留），加守卫后 7 项断言通过。真机，以及老板设备上那个弹层的真实实现【未】。

## 第 3 阶段：离线扩展包 + 扩展中心 + Full 版（分支 allitorfk/phase3）
- 定义 tools/extensions/packs.json（13 包：语言与编译链 / 媒体与文档 / 开发工具），deny：python3/nodejs/unrar/systemd/udev。
- 解析 tools/resolve-extensions.py：在官方 rootfs v10 + ubuntu-tools(5f75c41b…) 的 overlay 里用 apt -s 解出精确包集，写 locks/*.lock.json（每个 deb 的 sha256）。snapshot.ubuntu.com 对 ports 401，改为 ports 池 + launchpad 兜底，按 sha 锁定。
- 打包 tools/build-extensions.py：.dshx = gzip(-9,mtime 0) 包裹的 PAX tar（排序、固定 mtime/uid），含 dshx.json、SHA256SUMS、repo/Packages(.gz)+debs、tree/opt/dsha-ext/<id>、licenses/SOURCES.json；目录 app-integration/ext-catalog.json 为信任根。两次构建逐字节一致。
- 设备侧 app-integration/ext/：dshx.js（只收普通文件/目录的安全解包 + SHA256SUMS 双向核对）、manager.js（目录 sha → 基底绑定 → 空间预检 → 平铺源 apt 精确版本安装 → /opt/dsha-ext + /usr/local/bin 链接 → 冒烟 → 原子状态；失败回滚；移除只清本包新装且无人依赖的包）、routes.js（authorizeIndex + Origin + x-dsha-ext + Content-Type）、extensions.html、cli.mjs。
- 原生：ExtensionsActivity（独立 WebView，无 JS 桥，SAF 选择文件→页面流式上传校验）、ExtensionPacks（rootfs 版本一致才写 base-identity；Full 版懒释放内置包）、配置页“扩展中心”按钮。
- Gradle：full flavor（minSdk 30，复用 standard 源集，generated/fullAssets/ext-packs，dshx 不压缩），输出 -full.apk。
- 盒内验证 tools/verify-extensions.py：qemu chroot 全 13 包启用/运行/移除 + 负向用例 + 包集合复原。

## 第 3 阶段续作（2026-10-24 05:50 起，新加坡时间）
- 单测：p3-unit.log 里两个变体都只有已知环境性失败 AdbWheelPathsTest:198（与第 2 阶段相同），没有新增失败【核】。
- 上一轮 chroot 验证（p3-verify-chroot.json）的问题：run dev-base rc=141（取行管道）、kotlin 只看版本没真编译、jdk21 检查末尾 `|| true` 掩盖失败；移除 media/php/ruby/jdk21/dev-base 失败（EXT_REMOVE_WOULD_TOUCH）。05:50 那次重跑与本轮同时在同一 overlay 上跑过（两个 apt 进程撞锁），结果作废。单独复跑 media+ghostscript 往返全部通过，包集合复原【核：p3-dbg-mg.log】。
- tools/extlib.py overlay()：建 overlay 前先卸载 merged 下残留挂载（被打断的运行会留下 /dev rbind），否则 rm -rf 可能删进宿主 /dev。
- 老板追加范围：新增 `clang`（clang/lld/llvm 走 apt；clang-format/clang-tidy 的 Ubuntu deb 硬依赖 python3，只取 ELF，deb 钉 sha256）、`android-build`（d8 = Google Maven r8-9.5.28.jar 钉 sha256；aapt v1 + android.jar API 23 走 apt；noble 没有 arm64 aapt2）、`texlive`（latex-base/recommended/extra、xetex、lang-chinese、fonts-noto-cjk，禁 *-doc；latex-extra 硬依赖 python3，用本仓库生成的无文件标记包 dsha-python3-external Provides: python3 代替）。共 16 包，Full 仍只内置 dev-base + jdk21（两包重建后与之前逐字节一致）。
- resolve-extensions.py 加 `--reuse-lists`（沿用同一组 InRelease，避免追加包时索引漂移）与 `denySuffix`；build-extensions.py 加 `jar` 上游类型、通用 wrappers、deb-member 保留可执行位、synthetic 标记包（逐字节可复现，sha 与锁核对）。
- verify-extensions.py：每包真编译/真运行并核对输出关键字（clang C/C++ + lld + clang-format/tidy；javac→d8→aapt→zipalign→apksigner sign/verify；kotlinc→java -jar；xelatex+ctex 中文→pdftotext）。

## 第 3 阶段补充：官方 feat/bxroot-runtime（13b2750b）与第 2 阶段 fix4 版 bxroot 逐项对比（2026-10-24 06:20）
来源：布局仓库副本里的 origin/feat/bxroot-runtime（只读，未访问官方远端）。注意它的分叉点是 c8590e8a（2026-09-21），比 c750348a 早 82 个提交，不是基于 build190【核：git merge-base】。
| 项 | 官方分支 | 第 2 阶段（fix4 线） | 取舍 |
|---|---|---|---|
| 原生库 | 5 个：libbxroot.so 658176 B `7d354cba…`、-runtime 251800 B `295b3c84…`、-bridge `8ce48930…`、-linker `b6e2d80d…`、-stub-loader `3d2bc84a…`；上游 bxroot 提交 8803dcc5（09-21），“本仓库源码构建”，无锁文件/源码证明，16 KiB 对齐【核】 | 3 个：libbxroot.so 672256 B `bd337de2…`、-runtime 377440 B `53db5fec…`、-ulx 685320 B `504fb080…`；bxroot 0.2.4 提交 d5f9ac30，tools/bxroot/lock.json 锁源码包 sha、补丁、工具链、每个产物 ELF 特征，构建期 verifyBxrootNative 校验【核】 | **保留第 2 阶段**（更新、可追溯、有构建期校验）。官方二进制不混入（两套 ABI/启动形态不同） |
| 引擎层 | BxrootRuntime.java 136 行 + ProotBootstrap/ConfigStore 小改 | BxrootRuntime + BxrootPrivateRoot + RuntimeEngine 枚举、冷安装能力预检回退 | 保留第 2 阶段 |
| WebProcSel | 新增 isBxrootWebPayload：libbxroot.so 启动器 argv 带 `-r` 且 `-c` 文本含 `exec dsh web` 时**当作 Web 进程** | libbxroot* 启动器任何形态都不当 Web（只认 ULX 加载链还原后的 node 载荷）| 保留第 2 阶段（更严：宁漏杀不误杀启动器）；补测试 neverMistakesBxrootLauncherForWeb（含官方会判为 Web 的 exec 形态）|
| WebRuntimeFallback.shouldRetry | 实验引擎明确退出→proot 重试一次 | 同语义，另拒绝未知引擎名 | 保留第 2 阶段 |
| **三振切回 proot**（956c0fd2 + 13b2750b） | 失败计数用 RestartBudget 的连续失败（含看门狗“三次健康检查无响应”等超时类失败）≥3 → setRuntime("proot")，提示走 startupDiagnostics.message | 无 | **采用，但按 fix4 规则收紧**：独立计数 engine_definite_strikes，只有 `exitOutcome`=DEFINITE_FAILURE（鉴权前、当前代次、退出码已知、无插件等具名失败）才 +1；超时/看门狗/退出码未知/非当前代次一律不计也不清零；拿到鉴权链接清零；手动或自动换引擎清零；只对用户当前选择的引擎计数。提示走 diagnostics.message + DiagnosticLog ENGINE_FORCED_PROOT |
| 测试 | WebProcSelTest（含 bxroot 断言）、WebRuntimeFallbackTest 三振 + proot 自触发负控 | 已有 WebProcSelTest/WebRuntimeFallbackTest/BxrootRuntimeTest/BxrootPrivateRootTest | 合入思路并自写：threeDefiniteFailuresForceProot…、timeoutNeverCountsAsStrike、indeterminateNeverCountsAsStrike、successResetsAndProotOrUnknownNeverForce、neverMistakesBxrootLauncherForWeb |
| selftest.py / flatten-l2s.py / environment-data.py 注释 | 加 bxroot 名称与 l2s 说明 | build190 资产里没有 selftest.py | 不需要 |
| 许可 / NOTICES | MIT，THIRD_PARTY_NOTICES 列 5 个 sha | MIT + glibc LGPL/GCC 例外随包，lock 记 sha | 保留第 2 阶段条目；补“未采用官方分支二进制、只采用三振行为”和三振规则说明；fix4 e6420cd 标“未公开”，公开的是 patches/dsha-fix4-dsh0.2.1-rc.2.patch |

## 三方优点清单：拿了什么、没拿什么（依据对 Kxxy 的阅读报告与三方对比笔记）
**官方 DSHA build190（c750348a）= 基线，全部保留**：proot 默认 + proroot 可选、LanAuth/authorizeIndex 鉴权、插件导入校验、一键备份/导出、WebPortPolicy（含 EADDRINUSE 处理）、符号链接安全删除（RootfsInstaller/ManagedRuntimeAssets 的 NOFOLLOW）、ubuntu-tools 离线 deb 模式（扩展包沿用其锁定思路）、Low flavor 源码。另从官方 feat/bxroot-runtime 采用“三振切回 proot”（收紧为只计明确失败，见上节）。

**fix4 → 已拿（第 2 阶段）**：bxroot 0.2.4（锁文件+源码证明）、冷安装能力预检回退（只在明确失败时 bxroot→proot）、进程出生身份放宽（OwnedBirthEvidence 等）、Low 包（安卓 6+）产出。**没拿**：fix4 的包名 com.dsh.client（冲突）、fix4 的 dsh-runtime.bin（与官方字节不同，用官方的）、debug 签名。

**Kxxy → 已拿（思路，自写代码）**：P1 独立包名（第 1 阶段）；全内置离线扩展的思路 → 改为方案 B：Ubuntu noble arm64 deb + 上游官方 glibc 构建，16 个 .dshx（Full 版内置 dev-base+jdk21）；P9 扩展安装原子化（staging→rename、失败回滚、只删自己装的且无人依赖的包）；P10 离线单测 + 产物结构校验（tools/test-extensions.mjs、qemu chroot 往返 verify-extensions.py）；分类 UI（语言与编译链/媒体与文档/开发工具）。
**Kxxy → 没拿及原因**：
- Host 头鉴权、`approval: never` 默认值：安全倒退（扩展 API 只走 authorizeIndex + Origin + x-dsha-ext + Content-Type；AI 默认权限不变）。
- targetSdk 28 + Termux bionic 直跑、LD_PRELOAD 改写 com.termux 路径：W^X/上架倒退，两套 libc。
- 1.24 GB 全量包池塞进 APK：体积（Full 只内置两包，其余外置导入）。
- goproxy.cn / npmmirror 默认镜像：等于默认联网，且不该替用户选镜像。
- 任何 Kxxy 代码：仓库无 LICENSE。
**Kxxy → 延后（有价值但不便宜，或官方已有等价物）**：
- P2 版本号/提交号写入 BuildConfig：会让构建不可复现，需配合发布流程再做。
- P3 多锚点完整性探针 + 启动自愈、P5 三级崩溃自愈：官方已有 RuntimeInstallationState/recovery-agent，需对照设计，不是小改。
- P4 只替换包内顶层目录：官方删除已不跟随符号链接；“只替换出现的顶层目录”需改冷安装事务，延后。
- P6 token URL 只取本次启动后的日志段：官方已按代次（generation）发布鉴权链接（publishAuthenticatedRun），推定已覆盖【推】。
- P7 EADDRINUSE：官方 WebPortPolicy 已处理【核：util/WebPortPolicy.java:91】。
- P8 zip/epub/音视频文档预览：纯 JS 注入、价值高，但需要按官方 *-patch.json 锚点格式重写和测试，延后。
- P11“需要你确认”通知回路：官方已有 AgentTaskNotifications/NativeConsentPolicy。
- P12 Shizuku 私有目录通道：官方现状待对照【未】。
**本轮顺手加的（便宜且明显有用）**：clang/LLVM 包、android-build 包（d8+aapt+android.jar，可在手机上 javac→dex→apk→签名）、texlive 中文包——均为老板追加范围；`--reuse-lists` 防索引漂移；overlay 残留挂载保护。

## Phase 3 progress 2026-10-24 07:10 (UTC+8)
- Unit tests (p3-unit3.log): standard/full/low each 2147 tests, 0 failed (skipped 1/1/74, pre-existing assumptions). AdbWheelPathsTest:198 fixed: its 4th target came from java.io.tmpdir (/tmp, not under /data/), so on a host it never hit the /data/ rule; now spelled as the Android sibling path /data/data/other-app/files/data.
- Release build p3-build-release2.log OK; 3 APKs verified (aapt2/apksigner), authorities follow applicationId, no dsh.android.client in manifests.
- Chroot run 3: everything PASS except run jdk21 (old zipalign check, fixed) and run texlive (page number "1" glued to the pdftotext output; \pagestyle{empty} added). Rerun those two with --packs.
- Commit ddece73f on allitorfk/phase3 (local only).

## Phase 3 FINAL 2026-10-24 (UTC+8)
- Chroot final (p3-verify-chroot-final.log/.json): SUMMARY 55 pass 0 fail, all 16 packs activate/run/remove, 3 refuse cases, refuse-remove-required, apt-get check before/after, package set restored (upgradedKept = 14 base libs upgraded from noble-updates, kept on purpose).
- texlive smoke now uses only texlive: xelatex+ctex → PDF non-empty, starts with %PDF-, kpsewhich ctex.sty → texlive-pdf-ok (pdffonts/pdftotext belong to documents).
- Only tools/verify-extensions.py changed since the 06:45 APKs → no rebuild needed.
- Not tested: real device (engines under the new package, extensions on the phone, coexistence with the official app).
