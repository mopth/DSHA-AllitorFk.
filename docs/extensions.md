# 扩展中心（离线扩展包）

> 本页内容从瘦身前的首页 README 移来，原文完整保留在 [upstream-readme.md](upstream-readme.md)。

扩展中心在 App 里打开，用来安装编译器、语言运行时和工具。扩展包是 `.dshx` 文件（gzip 压缩的 tar），装进容器内的 Ubuntu。

## 两种安装方式

1. **一键「下载并安装」**：App 从本 fork Release 的固定地址 `https://github.com/mopth/DSHA-AllitorFk./releases/download/<tag>/<id>.dshx` 下载，校验后安装。断网后再点一次会接着下（断点续传）。
2. **「在浏览器中下载」+「从文件导入」**：在系统浏览器里下载 `.dshx`，到手机「下载」文件夹找到它，回到扩展中心点「从文件导入」选中，再点「启用」。

## 16 个扩展包

dev-base（gcc/g++、python3.12、cmake、make、jq）、clang（clang/lld/llvm、clang-format、clang-tidy）、jdk21、go、rust、android-build（d8/aapt/apksigner/zipalign）、kotlin、gradle、maven、ruby、php、media、documents、texlive（含中文，xelatex + ctex）、ghostscript（AGPL-3.0，单独成包）、devtools。每个包 7–251 MB（下载大小）。

## 安全模型

- **信任根**：随 APK 内置的 `ext-catalog.json` 记录每个包的大小与 sha256。无论下载还是导入，都先核对大小和 sha256，不符即删除并拒绝；解包后再按包内 `SHA256SUMS` 逐文件核对，拒绝符号链接、硬链接、设备文件、`..`、越界路径和未登记文件。
- **基底绑定**：每个包绑定 rootfs 版本、ubuntu-tools 锁和 dpkg 状态哈希，不匹配就拒绝安装。
- **来源**：Ubuntu noble arm64 软件包按版本和 sha256 锁定（`tools/extensions/locks/*.lock.json`），上游工具链只收官方构建并钉 sha256。不引用 Kxxy 的代码或包池。
- **安装与移除**：apt 从包内平铺源按精确版本安装，失败整体回滚；移除只清理本包带来且已无人依赖的包，会动到其它包时拒绝（`EXT_REMOVE_WOULD_TOUCH`）。Ubuntu python3 不会覆盖 DSHA 自带的 `/usr/bin/python3`。
- **接口权限**：扩展页和 API 先过官方 `authorizeIndex`（签名 Cookie），从不只看 Host 头；所有写操作（启用、移除、导入、下载、下载并安装）另需同源 Origin、`x-dsha-ext: 1` 请求头和正确的 Content-Type。下载请求只带包 id，地址只由内置目录决定。AI 的默认权限不变。
- **一键下载**：只认固定前缀；最多跟随 3 次重定向，每跳必须是 https，主机只能是 `github.com`、`objects.githubusercontent.com`、`release-assets.githubusercontent.com`，不带用户信息和端口；空闲 60 秒无数据或总时长超过 2 小时即中止；续传只接受与已下字节完全吻合的 Content-Range；写文件不跟随符号链接；下载前做空间预检。
- **浏览器链接**：原生侧只把本 fork Release 的 `.dshx` 地址交给系统浏览器（`ExtensionReleaseLinks`），其它外部导航一律拦截；WebView 没有 JS 桥。

## 验证

电脑上 qemu chroot 里 16 个包逐个启用、运行、移除全部通过（55 项），见 [ext-verify.md](../allitorfk/reports/ext-verify.md)。手机上的速度和空间占用尚未验证。许可与来源见 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。
