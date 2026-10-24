**English** | 中文: [README.md](README.md)

# DSHA-AllitorFk.

在手机上直接运行 deepseek-harness 的 DSHA 非官方修改版：可与官方版共存，内置 proot / proroot / bxroot 三种引擎和离线扩展中心。
An unofficial fork of DSHA (deepseek-harness on Android) that installs alongside the official app, with three engines and an offline Extensions Center.

[![⬇ Download Standard (Android 11+)](https://img.shields.io/badge/%E2%AC%87%20Download%20Standard%20%28Android%2011%2B%29-2ea44f?style=for-the-badge)](https://github.com/mopth/DSHA-AllitorFk./releases/download/dsha-AllitorFk.-dsh0.2.1-rc.2/DSHA-AllitorFk.-dsh0.2.1-rc.2.apk)
[![⬇ Download Low (Android 6+)](https://img.shields.io/badge/%E2%AC%87%20Download%20Low%20%28Android%206%2B%29-0969da?style=for-the-badge)](https://github.com/mopth/DSHA-AllitorFk./releases/download/dsha-AllitorFk.-dsh0.2.1-rc.2/DSHA-AllitorFk.-dsh0.2.1-rc.2-low.apk)

[![All releases / 全部版本](https://img.shields.io/badge/All%20releases%20%2F%20%E5%85%A8%E9%83%A8%E7%89%88%E6%9C%AC-555555?style=flat)](https://github.com/mopth/DSHA-AllitorFk./releases/latest)

| Variant / 版本 | Requires / 系统要求 | Size / 大小 |
|---|---|---|
| Standard | Android 11+ (minSdk 30), arm64 | ~293 MB |
| Low | Android 6+ (minSdk 23), arm64 | ~368 MB |
| Extension packs (16 .dshx) | One-tap download or import in the app's Extensions page | 7–251 MB each |

> - **Installs alongside official DSHA**: the package name `dsha.AllitorFk_.dsh0_2_1_rc_2` differs from the official one, so it is a separate app and never replaces official DSHA.
> - **One of the two**: Standard and Low share a package name; only one can be installed at a time.
> - **Test-signed**: a future build with a different signature must be installed after uninstalling, which deletes app data. Back up in the app first.

## Docs (Chinese)

- [Install & use](docs/install.md): download check, first start, engines, ADB pairing
- [Extensions Center](docs/extensions.md): the 16 offline packs and the security model
- [Build from source](docs/build.md): build steps and test report
- [FAQ](docs/faq.md): known limits, change sources, comparison with similar projects
- [Full original README (incl. upstream DSHA, English)](docs/upstream-readme.en.md) · [AllitorFk notes](allitorfk/README.md) · [Third-party notices](THIRD_PARTY_NOTICES.md)

---

License: [MIT License](LICENSE) (Copyright (c) 2026 qiannianhuanxiang, kept as is). Based on [DSH-APP/DSHA](https://github.com/DSH-APP/DSHA) build190 (`c750348a`); unofficial, not reviewed by the upstream author. Thanks to the authors and contributors of DSHA and deepseek-harness.
