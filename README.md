English: [README.en.md](README.en.md) | **中文**

# DSHA-AllitorFk.

在手机上直接运行 deepseek-harness 的 DSHA 非官方修改版：可与官方版共存，内置 proot / proroot / bxroot 三种引擎和离线扩展中心。
An unofficial fork of DSHA (deepseek-harness on Android) that installs alongside the official app, with three engines and an offline Extensions Center.

[![⬇ 下载 Standard（Android 11+）](https://img.shields.io/badge/%E2%AC%87%20%E4%B8%8B%E8%BD%BD%20Standard%EF%BC%88Android%2011%2B%EF%BC%89-2ea44f?style=for-the-badge)](https://github.com/mopth/DSHA-AllitorFk./releases/download/dsha-AllitorFk.-dsh0.2.1-rc.2/DSHA-AllitorFk.-dsh0.2.1-rc.2.apk)
[![⬇ 下载 Low（Android 6+）](https://img.shields.io/badge/%E2%AC%87%20%E4%B8%8B%E8%BD%BD%20Low%EF%BC%88Android%206%2B%EF%BC%89-0969da?style=for-the-badge)](https://github.com/mopth/DSHA-AllitorFk./releases/download/dsha-AllitorFk.-dsh0.2.1-rc.2/DSHA-AllitorFk.-dsh0.2.1-rc.2-low.apk)

[![全部版本 / All releases](https://img.shields.io/badge/%E5%85%A8%E9%83%A8%E7%89%88%E6%9C%AC%20%2F%20All%20releases-555555?style=flat)](https://github.com/mopth/DSHA-AllitorFk./releases/latest)

| 版本 / Variant | 系统要求 / Requires | 大小 / Size |
|---|---|---|
| Standard | Android 11+（minSdk 30），arm64 | 约 293 MB |
| Low | Android 6+（minSdk 23），arm64 | 约 368 MB |
| 扩展包 / Extension packs（16 个 .dshx） | 在 App「扩展中心」一键下载或导入 | 每个 7–251 MB |

> - **与官方共存**：包名 `dsha.AllitorFk_.dsh0_2_1_rc_2` 与官方不同，是另一个应用，不会覆盖官方 DSHA。
> - **二选一**：Standard 与 Low 包名相同，同一时间只能装其中一个。
> - **测试签名**：日后换用不同签名的版本需要先卸载，卸载会丢失数据，请先在 App 里备份。

## 文档

- [安装与使用](docs/install.md)：下载校验、首次启动、引擎选择、ADB 配对
- [扩展中心](docs/extensions.md)：16 个离线扩展包与安全模型
- [从源码构建](docs/build.md)：构建步骤与测试报告
- [常见问题](docs/faq.md)：已知限制、改动来源、与同类方案的关系
- [完整原 README（含上游 DSHA 介绍）](docs/upstream-readme.md) · [AllitorFk 资料](allitorfk/README.md) · [第三方许可](THIRD_PARTY_NOTICES.md)

---

许可：[MIT License](LICENSE)（Copyright (c) 2026 qiannianhuanxiang，原样保留）。基于 [DSH-APP/DSHA](https://github.com/DSH-APP/DSHA) build190（`c750348a`）修改，非官方发布，未经上游作者审核。致谢上游 DSHA 与 deepseek-harness 的作者和贡献者。
