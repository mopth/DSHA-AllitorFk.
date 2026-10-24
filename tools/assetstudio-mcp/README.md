# assetstudio-mcp（rc.3 扩展包源码）

来源：AssetStudio Mobile 1.10.2 的纯 JVM 核心（README 声明 MIT，基于 Perfare/AssetStudio MIT），见 `licenses/`。

- `vendor/`：原样保留的 MIT 源码（core/、render/、export/ObjExporter.kt、mcp/McpServerCore.kt），未改动、保留原文件头。
- `src/`：AllitorFk 自写的 CLI 与传输层；`CliMcpSource.kt` 改编自 ASM 的 AppMcpSource（去掉 Android Bitmap 预览/PNG 导出）。
- 剥离：Android/Compose 界面、NDK 贴图解码、BitmapExt、AssetExporter、原 HTTP 服务（监听全部网卡且无认证），以及全部签名材料（release.keystore 与口令一律不复制、不使用）。
- 传输：默认 `--stdio`；`--http PORT --token-file F` 只绑 127.0.0.1，必须 `Authorization: Bearer`，拒绝任何 `Origin` 与非本机 `Host`，正文上限 4 MiB。

构建（可复现，两次产物逐字节一致）：

```sh
python3 tools/assetstudio-mcp/build.py --kotlinc /path/to/kotlinc   # 产出 dist/assetstudio-mcp-tree.tar
python3 tools/build-extensions.py --only assetstudio-mcp            # 用锁里的 sha256 打成 .dshx
```

运行时依赖 `jdk21` 扩展包。只处理你有权查看的游戏文件；本包不含任何游戏资源。
