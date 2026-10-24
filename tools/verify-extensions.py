#!/usr/bin/env python3
"""盒内端到端验证：在官方 rootfs+ubuntu-tools 的 overlay 上，用与 App 相同的 ext/manager.js
（node 跑在 qemu-aarch64 下，chroot 或 proot -0 -q）启用→跑工具→移除扩展包，最后核对 dpkg 包集合与 apt-get check。
用法：python3 tools/verify-extensions.py [--engine chroot|proot] [--packs a,b,...] [--keep]
"""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parent))
import extlib  # noqa: E402

ROOT = extlib.ROOT
ASSETS = ROOT / 'app/src/main/assets/app-integration'
WORK = extlib.EXT_WORK

# 每个包至少真编译/真运行一次；只用读全输入的 sed/awk 取行，避免 pipefail 下的 SIGPIPE 误报。
CHECKS = {
    'dev-base': "printf '#include <stdio.h>\\nint main(){puts(\"hello-gcc\");return 0;}\\n' >/tmp/h.c && gcc -O2 -o /tmp/h /tmp/h.c && /tmp/h"
                " && printf '#include <iostream>\\nint main(){std::cout<<\"hello-g++\\\\n\";}\\n' >/tmp/h.cc && g++ -o /tmp/hpp /tmp/h.cc && /tmp/hpp"
                " && python3.12 -c 'import sys,sqlite3,venv;print(\"py\",sys.version.split()[0],sqlite3.sqlite_version)'"
                " && cmake --version | sed -n 1p && make --version | sed -n 1p && jq --version",
    'clang': "printf '#include <stdio.h>\\nint main(){puts(\"hello-clang\");return 0;}\\n' >/tmp/hc.c && clang -O2 -o /tmp/hc /tmp/hc.c && /tmp/hc"
             " && printf '#include <iostream>\\n#include <vector>\\nint main(){std::vector<int> v{1,2};std::cout<<\"hello-clang++ \"<<v.size()<<\"\\\\n\";}\\n' >/tmp/hc.cc"
             " && clang++ -O2 -fuse-ld=lld -o /tmp/hcpp /tmp/hc.cc && /tmp/hcpp"
             " && clang --version | sed -n 1p && ld.lld --version && llvm-ar --version | sed -n 2p"
             " && printf 'int  main( ){return 0;}\\n' >/tmp/f.c && clang-format /tmp/f.c"
             " && clang-tidy /tmp/hc.c --checks='-*,readability-*' -- 2>&1 | sed -n 1,3p && echo tidy-ok",
    'jdk21': "java -version 2>&1 | sed -n 1p && javac -version && rm -rf /tmp/j && mkdir -p /tmp/j && cd /tmp/j"
             " && printf 'public class H{public static void main(String[] a){System.out.println(\"hello-java\");}}' >H.java"
             " && javac -d classes H.java && java -cp classes H && apksigner --version && { zipalign -h 2>&1 || true; } | sed -n 1p && command -v zipalign",
    # javac → d8（dex）→ aapt 打包最小清单 → 加 classes.dex → zipalign → 临时 keystore 签名 → apksigner verify。
    'android-build': "rm -rf /tmp/a && mkdir -p /tmp/a/out /tmp/a/src && cd /tmp/a && J=/usr/lib/android-sdk/platforms/android-23/android.jar"
             " && printf 'package dsha.check;\\npublic final class Hello{public static String hi(){return \"hello-dex\";}}\\n' >src/Hello.java"
             " && javac --release 8 -cp $J -d classes src/Hello.java 2>&1 | grep -v 'warning: \\[options\\]' || true; test -f classes/dsha/check/Hello.class"
             " && d8 --version | sed -n 1p && d8 --release --min-api 24 --lib $J --output out classes/dsha/check/Hello.class"
             " && od -An -c -N4 out/classes.dex | tr -d ' \\n' | grep -qx 'dex\\\\n' && echo dex-ok"
             " && printf '<manifest xmlns:android=\"http://schemas.android.com/apk/res/android\" package=\"dsha.check\" android:versionCode=\"1\" android:versionName=\"1\"><uses-sdk android:minSdkVersion=\"24\" android:targetSdkVersion=\"23\"/><application android:label=\"check\" android:hasCode=\"true\"/></manifest>\\n' >AndroidManifest.xml"
             " && aapt package -f -M AndroidManifest.xml -I $J -F u.apk && (cd out && aapt add ../u.apk classes.dex >/dev/null)"
             " && aapt dump badging u.apk | sed -n 1p && unzip -l u.apk | grep -c -E 'AndroidManifest.xml|classes.dex'"
             " && zipalign -f -p 4 u.apk a.apk && zipalign -c 4 a.apk && echo zipalign-ok"
             " && keytool -genkeypair -keystore t.p12 -storetype PKCS12 -storepass verifyonly -keypass verifyonly -alias t"
             " -keyalg EC -groupname secp256r1 -dname CN=dsha-ext-verify -validity 2 >/dev/null 2>&1"
             " && apksigner sign --ks t.p12 --ks-pass pass:verifyonly --out s.apk a.apk"
             " && apksigner verify -v s.apk | grep -E '^Verified using v[123] scheme' && echo apk-signed-ok",
    'go': "go version && mkdir -p /tmp/g && printf 'package main\\nimport \"fmt\"\\nfunc main(){fmt.Println(\"hello-go\")}\\n' >/tmp/g/m.go && cd /tmp/g && GOCACHE=/tmp/gc go run m.go",
    'rust': "rustc --version && cargo --version && printf 'fn main(){println!(\"hello-rust\");}' >/tmp/r.rs && rustc -o /tmp/r /tmp/r.rs && /tmp/r",
    'kotlin': "kotlinc -version 2>&1 | tail -1 && printf 'fun main(){ println(\"hello-kotlin \" + KotlinVersion.CURRENT) }\\n' >/tmp/hk.kt"
              " && kotlinc /tmp/hk.kt -include-runtime -d /tmp/hk.jar 2>&1 | grep -v '^warning' || true; java -jar /tmp/hk.jar",
    'gradle': "gradle --version 2>&1 | grep -E '^Gradle|JVM' | sed -n 1,2p",
    'maven': "mvn -v 2>&1 | sed -n 1p",
    'ruby': "ruby -e 'puts \"hello-ruby #{RUBY_VERSION}\"' && bundle --version",
    'php': "php -r 'echo \"hello-php \".PHP_VERSION.\"\\n\";'",
    'media': "ffmpeg -hide_banner -version | sed -n 1p && ffmpeg -hide_banner -loglevel error -f lavfi -i sine=d=0.2 -y /tmp/s.wav && sox --version && convert -version | sed -n 1p && mediainfo --version | tail -1 && exiftool -ver",
    'documents': "pdftotext -v 2>&1 | sed -n 1p && qpdf --version | sed -n 1p && pandoc --version | sed -n 1p && tesseract --version 2>&1 | sed -n 1p && tesseract --list-langs 2>&1 | tail -n +2 | tr '\\n' ' '",
    'texlive': "rm -rf /tmp/t && mkdir -p /tmp/t && cd /tmp/t"
               " && printf '\\\\documentclass[fontset=none]{ctexart}\\n\\\\setCJKmainfont{Noto Sans CJK SC}\\n\\\\begin{document}\\n\\\\pagestyle{empty}\\n你好，世界。DSHA 扩展包 xelatex 测试。\\n\\\\end{document}\\n' >zh.tex"
               " && xelatex -interaction=nonstopmode -halt-on-error zh.tex >/dev/null"
               " && test -s zh.pdf && head -c 5 zh.pdf | grep -qx '%PDF-'"
               " && kpsewhich ctex.sty >/dev/null && echo texlive-pdf-ok",
    'ghostscript': "gs --version",
    'devtools': "gdb --version | sed -n 1p && strace -V | sed -n 1p && rg --version | sed -n 1p && fdfind --version && tmux -V && git lfs version && autoconf --version | sed -n 1p",
    'assetstudio-mcp': "assetstudio-mcp --version && printf '%s\\n' '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}' | assetstudio-mcp --stdio > /tmp/am.out && grep -c list_assets /tmp/am.out",
    'allitor-tools': "allitor-mcp --version && allitor-build-check --version && allitor-build-check --expect /etc/os-release -- true"
                     " && printf '%s\\n' '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}' | allitor-mcp > /tmp/al.out && grep -c browser_open /tmp/al.out",
}
# 运行输出里必须出现的文字（防止“命令成功但没真跑”）。
EXPECT = {'dev-base': 'hello-g++', 'clang': 'tidy-ok', 'jdk21': 'hello-java', 'android-build': 'apk-signed-ok', 'texlive': 'texlive-pdf-ok', 'go': 'hello-go', 'rust': 'hello-rust', 'kotlin': 'hello-kotlin',
          'ruby': 'hello-ruby', 'php': 'hello-php', 'ghostscript': '10.'}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--engine', default='chroot', choices=['chroot', 'proot'])
    ap.add_argument('--packs')
    ap.add_argument('--out', type=Path, default=ROOT / 'app/build/ext-packs')
    ap.add_argument('--keep', action='store_true')
    args = ap.parse_args()
    data = extlib.load_packs()
    order = [p['id'] for p in extlib.ordered(data)]
    want = order if not args.packs else [p for p in order if p in args.packs.split(',')]
    base = WORK / 'base'
    results = []
    with extlib.overlay(WORK, [base], 'verify-' + args.engine) as (merged, _):
        extlib.sudo('mkdir', '-p', merged / 'root/dsha-ext-test/ext', merged / 'root/.dsha-ext/packs')
        for f in (ASSETS / 'ext').iterdir():
            extlib.sudo('cp', f, merged / 'root/dsha-ext-test/ext' / f.name)
        extlib.sudo('cp', ASSETS / 'ext-catalog.json', merged / 'root/dsha-ext-test/ext-catalog.json')
        extlib.sudo('mount', '--bind', '-o', 'ro', args.out, merged / 'root/.dsha-ext/packs')
        try:
            def sh(script, check=True):
                if args.engine == 'chroot':
                    return extlib.chroot(merged, script, check=check, capture=True)
                cmd = ['sudo', '-n', 'proot', '-0', '-q', 'qemu-aarch64-static', '-r', str(merged), '-b', '/dev', '-b', '/proc',
                       '-w', '/root', '/usr/bin/env', '-i', f'PATH={extlib.CHROOT_PATH}', 'HOME=/root', 'LC_ALL=C.UTF-8',
                       '/bin/bash', '-c', 'set -eo pipefail; ' + script]
                return subprocess.run(cmd, check=check, capture_output=True, text=True)

            def step(name, script, expect_ok=True, expect_text=None):
                t = time.time()
                r = sh(script, check=False)
                ok = (r.returncode == 0) == expect_ok and (expect_text is None or expect_text in (r.stdout + r.stderr))
                tail = (r.stdout + r.stderr).strip().splitlines()[-6:]
                results.append({'step': name, 'ok': ok, 'rc': r.returncode, 'secs': round(time.time() - t, 1), 'tail': tail, 'out': (r.stdout + r.stderr)[-20000:] if not ok else None})
                print(('PASS ' if ok else 'FAIL ') + name + f' ({results[-1]["secs"]}s)', *['   ' + l for l in tail], sep='\n', flush=True)
                return ok

            cli = 'node /root/dsha-ext-test/ext/cli.mjs'
            snap = "dpkg-query -W -f='${Package} ${Version}\\n' | sort"
            before = sh(snap).stdout
            # 负向：基底身份不符必须拒绝。
            step('refuse-without-base-identity', f'{cli} activate {want[0]}', expect_ok=False, expect_text='EXT_BASE_ROOTFS_MISMATCH')
            sh("echo 9 > /root/.dsha-ext/base-identity")
            step('refuse-wrong-rootfs-version', f'{cli} activate {want[0]}', expect_ok=False, expect_text='EXT_BASE_ROOTFS_MISMATCH')
            sh(f"echo {data['base']['rootfsVersion']} > /root/.dsha-ext/base-identity")
            dependent = next((p['id'] for p in data['packs'] if p.get('requires') and p['id'] in want), None)
            if dependent:
                step('refuse-missing-requirement', f'{cli} activate {dependent}', expect_ok=False, expect_text='EXT_REQUIRES')
            for pid in want:
                if step('activate ' + pid, f'{cli} activate {pid}'):
                    step('run ' + pid, CHECKS[pid], expect_text=EXPECT.get(pid))
            if dependent and dependent in want:
                req = next(p for p in data['packs'] if p['id'] == dependent)['requires'][0]
                step('refuse-remove-required', f'{cli} remove {req}', expect_ok=False, expect_text='EXT_REQUIRED_BY')
            step('apt-get check (active)', 'apt-get check')
            for pid in reversed(want):
                step('remove ' + pid, f'{cli} remove {pid}')
            step('apt-get check (after)', 'apt-get check && test -z "$(ls -A /opt/dsha-ext 2>/dev/null | grep -v licenses)"')
            after = sh(snap).stdout
            b = dict(l.split(' ', 1) for l in before.splitlines())
            a = dict(l.split(' ', 1) for l in after.splitlines())
            added, gone = sorted(set(a) - set(b)), sorted(set(b) - set(a))
            changed = sorted(k for k in set(a) & set(b) if a[k] != b[k])
            ok = not added and not gone
            results.append({'step': 'package-set-restored', 'ok': ok, 'added': added, 'gone': gone, 'upgradedKept': changed})
            print(('PASS' if ok else 'FAIL') + f' package-set-restored added={added} gone={gone} upgradedKept={changed}', flush=True)
        finally:
            subprocess.run(['sudo', '-n', 'umount', '-l', str(merged / 'root/.dsha-ext/packs')])
    out = WORK / f'verify-{args.engine}.json'
    out.write_text(json.dumps(results, indent=1, ensure_ascii=False) + '\n')
    bad = [r['step'] for r in results if not r['ok']]
    print('SUMMARY', len(results) - len(bad), 'pass', len(bad), 'fail', bad)
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
