#!/usr/bin/env python3
"""Build assetstudio-mcp (pure JVM) and its .dshx tree tarball reproducibly.

Inputs: vendor/ (AssetStudio Mobile MIT core, Android UI and signing material excluded),
src/ (AllitorFk CLI + secure transports), brotli dec 0.1.2 jar (MIT, pinned sha256).
Output: dist/assetstudio-mcp-tree.tar (fixed mtime/owner, sorted) for the 'local' upstream kind.
"""
import argparse, hashlib, io, os, shutil, subprocess, sys, tarfile, urllib.request, zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
BROTLI = ('https://repo1.maven.org/maven2/org/brotli/dec/0.1.2/dec-0.1.2.jar',
          '615c0c3efef990d77831104475fba6a1f7971388691d4bad1471ad84101f6d52')
EPOCH = 1761264000  # 2025-10-24T00:00:00Z, fixed for reproducibility
WRAPPER = '#!/bin/sh\n# assetstudio-mcp launcher (AllitorFk)\nexec java -Xss8m -jar /opt/dsha-ext/assetstudio-mcp/share/assetstudio-mcp.jar "$@"\n'


def fetch(work):
    target = work / 'brotli-dec-0.1.2.jar'
    if not target.exists():
        with urllib.request.urlopen(BROTLI[0], timeout=60) as r:
            target.write_bytes(r.read())
    if hashlib.sha256(target.read_bytes()).hexdigest() != BROTLI[1]:
        raise SystemExit('BROTLI_SHA_MISMATCH')
    return target


def normalize_jar(raw, out):
    with zipfile.ZipFile(raw) as src, zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as dst:
        for name in sorted(src.namelist()):
            if name.startswith('META-INF/') and name.endswith(('.SF', '.RSA', '.DSA', '.EC')):
                continue
            info = zipfile.ZipInfo(name, date_time=(2025, 10, 24, 0, 0, 0))
            info.external_attr = (0o755 if name.endswith('/') else 0o644) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            dst.writestr(info, src.read(name))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--kotlinc', default=os.environ.get('KOTLINC', 'kotlinc'))
    ap.add_argument('--work', type=Path, default=HERE / 'build')
    args = ap.parse_args()
    work = args.work; work.mkdir(parents=True, exist_ok=True)
    brotli = fetch(work)
    sources = sorted(str(p) for p in list((HERE / 'vendor').rglob('*.kt')) + list((HERE / 'src').rglob('*.kt')))
    classes = work / 'classes'
    shutil.rmtree(classes, ignore_errors=True)
    subprocess.run([args.kotlinc, '-jvm-target', '17', '-nowarn', '-cp', str(brotli), '-d', str(classes)] + sources, check=True)
    # merge kotlin stdlib + brotli + classes into one fat jar
    stdlib = Path(subprocess.run(['sh', '-c', f'dirname $(readlink -f $(command -v {args.kotlinc}))'], capture_output=True, text=True).stdout.strip()).parent / 'lib/kotlin-stdlib.jar'
    raw = work / 'raw.jar'
    with zipfile.ZipFile(raw, 'w') as z:
        z.writestr('META-INF/MANIFEST.MF', 'Manifest-Version: 1.0\nMain-Class: com.allitorfk.assetmcp.MainKt\n')
        for jar in (stdlib, brotli):
            with zipfile.ZipFile(jar) as j:
                for n in j.namelist():
                    if n.endswith('/') or n.upper().startswith('META-INF/MANIFEST') or n.endswith('module-info.class'):
                        continue
                    if n not in z.namelist():
                        z.writestr(n, j.read(n))
        for p in sorted(classes.rglob('*')):
            if p.is_file():
                z.write(p, p.relative_to(classes).as_posix())
    jar = work / 'assetstudio-mcp.jar'
    normalize_jar(raw, jar)
    dist = HERE / 'dist'; dist.mkdir(exist_ok=True)
    files = {'share/assetstudio-mcp.jar': (jar.read_bytes(), 0o644), 'bin/assetstudio-mcp': (WRAPPER.encode(), 0o755)}
    for lic in sorted((HERE / 'licenses').iterdir()):
        files['licenses/' + lic.name] = (lic.read_bytes(), 0o644)
    files['share/kotlin-stdlib.LICENSE'] = ((HERE / 'licenses/Kotlin-Apache-2.0.txt').read_bytes(), 0o644)
    tar_path = dist / 'assetstudio-mcp-tree.tar'
    with tarfile.open(tar_path, 'w', format=tarfile.PAX_FORMAT) as t:
        for name in sorted(files):
            data, mode = files[name]
            info = tarfile.TarInfo('assetstudio-mcp/' + name); info.size = len(data); info.mode = mode
            info.mtime = EPOCH; info.uid = info.gid = 0; info.uname = info.gname = 'root'
            t.addfile(info, io.BytesIO(data))
    print(tar_path, hashlib.sha256(tar_path.read_bytes()).hexdigest(), len(jar.read_bytes()))


if __name__ == '__main__':
    main()
