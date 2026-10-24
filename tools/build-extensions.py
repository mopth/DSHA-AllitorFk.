#!/usr/bin/env python3
"""按 tools/extensions/locks/*.lock.json 可复现地生成离线扩展包（.dshx）与目录 ext-catalog.json。

.dshx = gzip(-9, mtime=0, 无文件名) 包裹的 PAX tar，条目按名排序、mtime/uid/gid 固定（逐字节可复现）：
  dshx.json  SHA256SUMS  repo/Packages  repo/*.deb  tree/opt/dsha-ext/<id>/...  licenses/...
设备端只认目录里的 sha256（信任根随 APK）；条目只允许普通文件与目录。
用法：python3 tools/build-extensions.py [--cache DIR] [--out DIR] [--only id,...] [--offline]
"""
import argparse
import concurrent.futures
import gzip
import shutil
import hashlib
import io
import json
import lzma
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tarfile
import urllib.request
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parent))
import extlib  # noqa: E402

ROOT = extlib.ROOT
CATALOG = ROOT / 'app/src/main/assets/app-integration/ext-catalog.json'
MIRROR = 'https://ports.ubuntu.com/ubuntu-ports/'
LAUNCHPAD = 'https://launchpad.net/ubuntu/+archive/primary/+files/'
SAFE = re.compile(r'[^\x00-\x1f\x7f/\\]+')


def fetch(url, target, sha256, offline, fallbacks=()):
    if target.is_file() and extlib.digest(target) == sha256:
        return target
    if offline:
        raise ValueError('EXT_CACHE_MISSING:' + target.name)
    last = None
    for candidate in (url, *fallbacks):
        part = target.with_name(target.name + '.part')
        try:
            req = urllib.request.Request(candidate, headers={'User-Agent': 'dsha-ext-build/1'})
            with urllib.request.urlopen(req, timeout=120) as resp, part.open('wb') as out:
                while chunk := resp.read(1 << 20):
                    out.write(chunk)
            if extlib.digest(part) != sha256:
                part.unlink()
                raise ValueError('EXT_DIGEST_MISMATCH:' + candidate)
            part.replace(target)
            return target
        except Exception as error:  # 依次尝试下一个镜像
            last = error
    raise ValueError(f'EXT_FETCH_FAILED:{target.name}:{last}')


def safe_rel(name):
    p = PurePosixPath(name)
    if p.is_absolute() or not p.parts or any(s in ('', '.', '..') for s in p.parts) or not all(SAFE.fullmatch(s) for s in p.parts):
        raise ValueError('EXT_UNSAFE_PATH:' + name)
    return p.as_posix()


class Tree:
    """上游通道文件树：rel -> (bytes|Path, mode)。只收普通文件。"""
    def __init__(self, pid):
        self.pid, self.files = pid, {}

    def add(self, rel, data, mode):
        rel = safe_rel(rel)
        if rel in self.files:
            raise ValueError('EXT_DUPLICATE:' + rel)
        self.files[rel] = (data, 0o755 if mode & 0o111 else 0o644)


def from_archive(tree, entry, path):
    strip = entry.get('strip', '')
    links = []
    if entry['kind'] == 'zip':
        with zipfile.ZipFile(path) as z:
            for info in z.infolist():
                if info.is_dir():
                    continue
                if not info.filename.startswith(strip):
                    raise ValueError('EXT_STRIP:' + info.filename)
                mode = (info.external_attr >> 16) & 0o777777
                if (mode & 0o170000) == 0o120000:
                    links.append(info.filename)
                    continue
                tree.add(info.filename[len(strip):], z.read(info), mode)
    else:
        with tarfile.open(path) as t:
            for m in t:
                if m.isdir():
                    continue
                name = m.name.removeprefix('./')
                if not name.startswith(strip):
                    raise ValueError('EXT_STRIP:' + name)
                if m.issym() or m.islnk():
                    links.append(name)
                    continue
                if not m.isfile():
                    raise ValueError('EXT_SPECIAL:' + name)
                tree.add(name[len(strip):], t.extractfile(m).read(), m.mode)
    if links:
        raise ValueError(f'EXT_UPSTREAM_LINKS:{tree.pid}:{links[:5]}')


def from_rust(tree, path):
    # 先整体解压到内存再随机访问；xz 上的 tarfile 回溯会反复重解压，极慢。
    with tarfile.open(fileobj=io.BytesIO(lzma.decompress(path.read_bytes()))) as t:
        members = {m.name: m for m in t}
        by_dir = {}
        for n in members:
            by_dir.setdefault(n.split('/')[0] + '/' + n.split('/')[1] if n.count('/') else n, []).append(n)
        top = next(iter(members)).split('/')[0]
        comps = t.extractfile(members[f'{top}/components']).read().decode().split()
        for comp in comps:
            manifest = t.extractfile(members[f'{top}/{comp}/manifest.in']).read().decode().splitlines()
            for line in manifest:
                kind, rel = line.split(':', 1)
                prefix = f'{top}/{comp}/{rel}'
                pool = by_dir.get(f'{top}/{comp}', [])
                chosen = [members[n] for n in pool if (n == prefix if kind == 'file' else n.startswith(prefix + '/'))]
                for m in chosen:
                    if m.isdir():
                        continue
                    if not m.isfile():
                        raise ValueError('EXT_RUST_SPECIAL:' + m.name)
                    tree.add(m.name[len(f'{top}/{comp}/'):], t.extractfile(m).read(), m.mode)
        for lic in ('LICENSE-APACHE', 'LICENSE-MIT', 'COPYRIGHT'):
            m = members.get(f'{top}/{lic}')
            if m is not None and f'share/doc/{comps[0]}/{lic}' not in tree.files:
                tree.add(f'share/doc/{comps[0]}/{lic}', t.extractfile(m).read(), 0o644)


def from_deb(tree, entry, path):
    data = subprocess.run(['dpkg-deb', '--fsys-tarfile', str(path)], check=True, capture_output=True).stdout
    with tarfile.open(fileobj=io.BytesIO(data)) as t:
        names = {m.name.removeprefix('./'): m for m in t}
        for src, dst in entry['members'].items():
            m = names[src]
            if not m.isfile():
                raise ValueError('EXT_DEB_MEMBER:' + src)
            tree.add(dst, t.extractfile(m).read(), m.mode)  # 保留可执行位（Tree 归一为 755/644）


def from_jar(tree, entry, path):
    # 单个 jar 原样放入 dest；licenseMember 从 jar 内取许可文本放到 licenseFile。
    tree.add(entry['dest'], path.read_bytes(), 0o644)
    if entry.get('licenseMember'):
        with zipfile.ZipFile(path) as z:
            tree.add(entry['licenseFile'], z.read(entry['licenseMember']), 0o644)


def add_wrappers(tree, entry):
    for rel, body in entry.get('wrappers', {}).items():
        tree.add(rel, ('#!/bin/sh\n# DSHA 扩展包生成的包装脚本\n' + body + '\n').encode(), 0o755)


def synth_deb(row, data, cache):
    # 标记包由 packs.json 的 synthetic 规格重新生成，必须与锁里的 sha256 一致。
    spec = next(x for p in data['packs'] for x in p.get('synthetic', []) if x['package'] == row['Package'])
    body = extlib.synthetic_deb(spec, data['sourceDateEpoch'])
    if hashlib.sha256(body).hexdigest() != row['SHA256']:
        raise ValueError('EXT_SYNTHETIC_DRIFT:' + row['Package'])
    target = cache / 'debs' / safe_rel(PurePosixPath(row['Filename']).name)
    target.write_bytes(body)
    return target


def build_pack(pack, lock, data, cache, out):
    pid = pack['id']
    epoch = data['sourceDateEpoch']
    debs = []
    rows = lock['packages']
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        futures = []
        for r in rows:
            rel = r['Filename']
            if r.get('Synthetic'):
                futures.append(pool.submit(synth_deb, r, data, cache))
                continue
            if not rel.startswith('pool/') or '..' in rel.split('/'):
                raise ValueError('EXT_POOL_PATH:' + rel)
            name = safe_rel(PurePosixPath(rel).name)
            futures.append(pool.submit(fetch, MIRROR + rel, cache / 'debs' / name, r['SHA256'], args.offline, (LAUNCHPAD + name,)))
        debs = [f.result() for f in futures]
    tree = Tree(pid)
    licenses = []
    for i, entry in enumerate(lock.get('upstream', [])):
        if entry['kind'] == 'local':
            # 本仓库源码构建的产物（如 tools/assetstudio-mcp/build.py 的 tree tar），只认锁里的 sha256。
            rel = PurePosixPath(entry['path'])
            if rel.is_absolute() or '..' in rel.parts or not entry['path'].startswith('tools/'):
                raise ValueError('EXT_LOCAL_PATH:' + entry['path'])
            path = ROOT / entry['path']
            name = safe_rel(rel.name)
            if not path.is_file() or extlib.digest(path) != entry['sha256']:
                raise ValueError('EXT_LOCAL_DIGEST:' + entry['path'])
            from_archive(tree, {**entry, 'kind': 'tar'}, path)
            add_wrappers(tree, entry)
            licenses.append({'name': name, 'license': entry['license'], 'url': entry['url'], 'sha256': entry['sha256']})
            continue
        name = safe_rel(PurePosixPath(entry['url']).name)
        path = fetch(entry['url'], cache / 'upstream' / name, entry['sha256'], args.offline)
        if entry['kind'] in ('tar', 'zip'):
            from_archive(tree, entry, path)
        elif entry['kind'] == 'rust-component':
            from_rust(tree, path)
        elif entry['kind'] == 'deb-member':
            from_deb(tree, entry, path)
        elif entry['kind'] == 'jar':
            from_jar(tree, entry, path)
        else:
            raise ValueError('EXT_UPSTREAM_KIND:' + entry['kind'])
        add_wrappers(tree, entry)
        licenses.append({'name': name, 'license': entry['license'], 'url': entry['url'], 'sha256': entry['sha256']})
    for rel in pack.get('bins', []):
        if rel not in tree.files or tree.files[rel][1] != 0o755:
            raise ValueError(f'EXT_BIN_MISSING:{pid}:{rel}')
    # repo/Packages(.gz)：平铺源（deb file:… ./），Filename 必须是 ./<文件名>，apt 才会拼成绝对路径。
    stanzas = []
    for r, deb in zip(rows, debs):
        stanza = {'Package': r['Package'], 'Version': r['Version'], 'Architecture': r['Architecture'],
                  'Filename': './' + deb.name, 'Size': r['Size'], 'SHA256': r['SHA256']}
        control = subprocess.run(['dpkg-deb', '-f', str(deb)], check=True, capture_output=True, text=True).stdout
        fields = {}
        key = None
        for line in control.splitlines():
            if line[:1] in (' ', '\t') and key:
                fields[key] += '\n' + line
            elif ':' in line:
                key, value = line.split(':', 1)
                fields[key] = value.strip()
        for k in ('Multi-Arch', 'Installed-Size', 'Pre-Depends', 'Depends', 'Recommends', 'Provides', 'Conflicts',
                  'Breaks', 'Replaces', 'Section', 'Priority', 'Source', 'Essential', 'Protected'):
            if k in fields:
                stanza[k] = fields[k]
        if fields.get('Package') != r['Package'] or fields.get('Version') != r['Version']:
            raise ValueError('EXT_CONTROL_MISMATCH:' + deb.name)
        stanzas.append('\n'.join(f'{k}: {v}' for k, v in stanza.items()))
    packages_text = ('\n\n'.join(stanzas) + '\n').encode() if stanzas else b''
    sources = sorted({(r.get('Source', r['Package']).split(' ')[0], r['Version'] if '(' not in r.get('Source', '') else r['Source'].split('(')[1].rstrip(')'))
                      for r in rows if not r.get('Synthetic')})
    source_offer = {'schema': 1, 'id': pid,
                    'note': 'Ubuntu 源码包（.dsc/orig/debian）可按下列名称与版本从 https://launchpad.net/ubuntu/+source/<name>/<version> 获取；DSHA 发布时附同名 sources-<id>.json，并承诺应请求提供三年源码副本。',
                    'packages': [{'source': s, 'version': v, 'url': f'https://launchpad.net/ubuntu/+source/{s}/{v}'} for s, v in sources],
                    'upstream': licenses}
    installed = sum(int(r.get('Installed-Size', 0)) for r in rows) * 1024 + sum(len(v[0]) for v in tree.files.values())
    manifest = {
        'schema': 1, 'id': pid, 'name': pack['name'], 'summary': pack['summary'], 'category': pack['category'],
        'version': pack.get('version') or (next((r['Version'] for r in rows if r['Package'] in pack.get('seeds', [])[:1]), None)) or '1',
        'requires': pack.get('requires', []), 'base': data['base'], 'seeds': pack.get('seeds', []),
        'packages': [f"{r['Package']}={r['Version']}" for r in rows],
        'upgradesBase': sorted(r['Package'] for r in rows if 'Replaces-Base' in r),
        'upstreamPrefix': f'/opt/dsha-ext/{pid}' if tree.files else None,
        'bins': pack.get('bins', []), 'smoke': pack.get('smoke', []), 'agpl': bool(pack.get('agpl')),
        'installedBytes': installed, 'lockSha256': extlib.digest(extlib.LOCKS / f'{pid}.lock.json'),
        'aptSources': lock['sources'],
    }
    entries = {
        'dshx.json': (json.dumps(manifest, indent=1, ensure_ascii=False, sort_keys=True) + '\n').encode(),
        'licenses/SOURCES.json': (json.dumps(source_offer, indent=1, ensure_ascii=False) + '\n').encode(),
    }
    if packages_text:
        entries['repo/Packages'] = packages_text
        buf = io.BytesIO()
        with gzip.GzipFile(filename='', mode='wb', compresslevel=9, fileobj=buf, mtime=0) as z:
            z.write(packages_text)
        entries['repo/Packages.gz'] = buf.getvalue()
    for deb in debs:
        entries['repo/' + deb.name] = deb
    for rel, (body, mode) in tree.files.items():
        entries[f'tree/opt/dsha-ext/{pid}/{rel}'] = (body, mode)
    sums = []
    for name in sorted(entries):
        value = entries[name]
        body = value[0] if isinstance(value, tuple) else value
        h = extlib.digest(body) if isinstance(body, Path) else hashlib.sha256(body).hexdigest()
        sums.append(f'{h}  {name}\n')
    entries['SHA256SUMS'] = ''.join(sums).encode()
    target = out / f'{pid}.dshx'
    tmp = target.with_name(target.name + '.tmp')
    with tarfile.open(tmp, 'w', format=tarfile.PAX_FORMAT) as t:
        order = ['dshx.json', 'SHA256SUMS'] + sorted(n for n in entries if n not in ('dshx.json', 'SHA256SUMS'))
        dirs = set()
        for name in order:
            parts = name.split('/')[:-1]
            for i in range(1, len(parts) + 1):
                d = '/'.join(parts[:i])
                if d not in dirs:
                    dirs.add(d)
                    info = tarfile.TarInfo(d)
                    info.type, info.mode, info.mtime, info.uname, info.gname = tarfile.DIRTYPE, 0o755, epoch, '', ''
                    t.addfile(info)
            value = entries[name]
            body, mode = (value if isinstance(value, tuple) else (value, 0o644))
            info = tarfile.TarInfo(name)
            info.mode, info.mtime, info.uname, info.gname = mode, epoch, '', ''
            if isinstance(body, Path):
                info.size = body.stat().st_size
                with body.open('rb') as f:
                    t.addfile(info, f)
            else:
                info.size = len(body)
                t.addfile(info, io.BytesIO(body))
    gz = target.with_name(target.name + '.gz.tmp')
    with tmp.open('rb') as src, open(gz, 'wb') as raw, gzip.GzipFile(filename='', mode='wb', compresslevel=9, fileobj=raw, mtime=0) as dst:
        shutil.copyfileobj(src, dst, 1 << 20)
    tmp.unlink()
    gz.replace(target)
    (out / f'sources-{pid}.json').write_text(json.dumps(source_offer, indent=1, ensure_ascii=False) + '\n', encoding='utf-8')
    return {'id': pid, 'file': target.name, 'sha256': extlib.digest(target), 'bytes': target.stat().st_size,
            'installedBytes': installed, 'name': pack['name'], 'summary': pack['summary'], 'category': pack['category'],
            'version': manifest['version'], 'requires': manifest['requires'], 'agpl': manifest['agpl'],
            'debs': len(rows), 'upstream': bool(tree.files),
            'licenses': sorted({e['license'] for e in licenses}) + (['Ubuntu (per-package copyright)'] if rows else [])}


def main():
    global args
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, default=extlib.EXT_CACHE)
    parser.add_argument('--out', type=Path, default=ROOT / 'app/build/ext-packs')
    parser.add_argument('--only')
    parser.add_argument('--offline', action='store_true')
    args = parser.parse_args()
    data = extlib.load_packs()
    for sub in ('debs', 'upstream'):
        (args.cache / sub).mkdir(parents=True, exist_ok=True)
    args.out.mkdir(parents=True, exist_ok=True)
    only = set(args.only.split(',')) if args.only else None
    previous = {p['id']: p for p in json.loads(CATALOG.read_text())['packs']} if CATALOG.is_file() else {}
    rows = []
    for pack in data['packs']:
        lock = json.loads((extlib.LOCKS / f"{pack['id']}.lock.json").read_text())
        if lock['base'] != data['base']:
            raise ValueError('EXT_LOCK_BASE_STALE:' + pack['id'])
        if only is not None and pack['id'] not in only and pack['id'] in previous:
            rows.append(previous[pack['id']])
            continue
        row = build_pack(pack, lock, data, args.cache, args.out)
        print(json.dumps({k: row[k] for k in ('id', 'bytes', 'installedBytes', 'sha256', 'debs')}), flush=True)
        rows.append(row)
    dl = data.get('download', {}).get('base', '')
    if not re.fullmatch(r'https://github\.com/mopth/DSHA-AllitorFk\./releases/download/[A-Za-z0-9][A-Za-z0-9._-]{0,100}', dl):
        raise ValueError('EXT_DOWNLOAD_BASE')
    catalog = {'schema': 1, 'base': data['base'], 'download': {'base': dl}, 'packs': rows,
               'packsSha256': extlib.digest(extlib.PACKS)}
    CATALOG.write_text(json.dumps(catalog, indent=1, ensure_ascii=False) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
