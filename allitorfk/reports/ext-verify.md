# 扩展包 chroot 验证（AllitorFk phase 3）

环境：电脑上 qemu-aarch64 chroot，官方 rootfs v10 + ubuntu-tools 叠加层；不是真机。工具：`tools/verify-extensions.py`（默认参数，全部 16 包）。
结果：55 通过，0 失败（2026-10-24，UTC+8）。

| 步骤 | 结果 | 秒 |
|---|---|---|
| refuse-without-base-identity | PASS | 1.2 |
| refuse-wrong-rootfs-version | PASS | 1.4 |
| refuse-missing-requirement | PASS | 1.1 |
| activate dev-base | PASS | 79.9 |
| run dev-base | PASS | 4.8 |
| activate clang | PASS | 21.2 |
| run clang | PASS | 9.7 |
| activate jdk21 | PASS | 34.5 |
| run jdk21 | PASS | 11.2 |
| activate go | PASS | 20.5 |
| run go | PASS | 37.4 |
| activate rust | PASS | 16.4 |
| run rust | PASS | 2.7 |
| activate android-build | PASS | 14.8 |
| run android-build | PASS | 31.2 |
| activate kotlin | PASS | 21.8 |
| run kotlin | PASS | 52.7 |
| activate gradle | PASS | 16.5 |
| run gradle | PASS | 6.6 |
| activate maven | PASS | 16.3 |
| run maven | PASS | 2.7 |
| activate ruby | PASS | 12.4 |
| run ruby | PASS | 2.6 |
| activate php | PASS | 119.1 |
| run php | PASS | 0.3 |
| activate media | PASS | 91.1 |
| run media | PASS | 1.8 |
| activate documents | PASS | 16.1 |
| run documents | PASS | 0.6 |
| activate texlive | PASS | 1382.6 |
| run texlive | PASS | 6.4 |
| activate ghostscript | PASS | 19.8 |
| run ghostscript | PASS | 0.2 |
| activate devtools | PASS | 23.9 |
| run devtools | PASS | 1.6 |
| refuse-remove-required | PASS | 1.1 |
| apt-get check (active) | PASS | 0.5 |
| remove devtools | PASS | 446.1 |
| remove ghostscript | PASS | 242.1 |
| remove texlive | PASS | 259.0 |
| remove documents | PASS | 208.9 |
| remove media | PASS | 110.9 |
| remove php | PASS | 102.5 |
| remove ruby | PASS | 66.2 |
| remove maven | PASS | 200.2 |
| remove gradle | PASS | 48.7 |
| remove kotlin | PASS | 46.8 |
| remove android-build | PASS | 48.9 |
| remove rust | PASS | 44.1 |
| remove go | PASS | 46.7 |
| remove jdk21 | PASS | 45.1 |
| remove clang | PASS | 37.1 |
| remove dev-base | PASS | 15.0 |
| apt-get check (after) | PASS | 0.6 |
| package-set-restored | PASS |  |

package-set-restored：移除后包集合无增无减；`upgradedKept` 为启用时从 noble-updates 升级、移除时有意保留的 14 个基础库。
texlive 冒烟只用 texlive 自带工具（xelatex + ctex 生成 PDF，检查非空且以 `%PDF-` 开头）。
