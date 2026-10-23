#!/usr/bin/env python3
"""在官方 rootfs（offline-rootfs.bin + ubuntu-tools.bin）里用 apt 解析扩展包，写 tools/extensions/locks/<id>.lock.json。

不自写依赖求解器：apt-get -s 在与设备同一基线上给出准确的安装集合（含需要连带升级的基础库）。
用法：python3 tools/resolve-extensions.py [--work DIR] [--only id,...] [--reuse-lists]
"""
import argparse
import json
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
import extlib  # noqa: E402

FIELDS = ('Package', 'Version', 'Architecture', 'Filename', 'Size', 'SHA256', 'Installed-Size', 'Source', 'Section')


def parse_packages(text, suite, into):
    for para in text.split('\n\n'):
        item, key = {}, None
        for line in para.splitlines():
            if line[:1] in (' ', '\t'):
                continue
            if ':' in line:
                key, value = line.split(':', 1)
                item[key] = value.strip()
        if 'Package' in item and 'Version' in item:
            row = {k: item[k] for k in FIELDS if k in item}
            row.setdefault('Source', item['Package'])
            row['Suite'] = suite
            into.setdefault((item['Package'], item['Version']), row)


def subprocess_ok(cmd):
    return extlib.subprocess.run(cmd).returncode == 0


def read_index(listdir, data):
    names = extlib.subprocess.run(['sudo', '-n', 'ls', str(listdir)], check=True, capture_output=True, text=True).stdout.split()
    sources, index = [], {}
    for suite in data['apt']['suites']:
        inrel = [n for n in names if n.endswith(f'_dists_{suite}_InRelease')]
        if len(inrel) != 1:
            raise ValueError('EXT_INRELEASE:' + suite)
        raw = extlib.read_file_root(listdir / inrel[0])
        date = re.search(rb'^Date: (.+)$', raw, re.M).group(1).decode()
        sources.append({'suite': suite, 'inReleaseSha256': extlib.hashlib.sha256(raw).hexdigest(), 'date': date})
        for n in names:
            if f'_dists_{suite}_' in n and n.endswith('_binary-arm64_Packages'):
                parse_packages(extlib.read_file_root(listdir / n).decode('utf-8', 'replace'), suite, index)
    return sources, index


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--work', type=Path, default=extlib.EXT_WORK)
    parser.add_argument('--only')
    parser.add_argument('--reuse-lists', action='store_true', help='不重新 apt-get update，沿用 work/lists 里的索引')
    args = parser.parse_args()
    data = extlib.load_packs()
    base = extlib.prepare_base(args.work, data)
    lists = args.work / 'lists'
    if args.reuse_lists and subprocess_ok(['sudo', '-n', 'test', '-d', str(lists / 'var/lib/apt/lists')]):
        # 复用上次 update 得到的索引：只补解析单个包时，与其它锁共享同一组 InRelease，避免索引漂移。
        sources, index = read_index(lists / 'var/lib/apt/lists', data)
    else:
        # 1) 索引层：只写 apt 源与 lists，记下 InRelease 摘要。
        with extlib.overlay(args.work, [base], 'lists', network=True) as (merged, upper):
            extlib.write_file_root(merged / 'etc/apt/dsha-ext.list', extlib.apt_list(data))
            extlib.chroot(merged, f'apt-get {extlib.APT_OPTS} update -q')
            sources, index = read_index(merged / 'var/lib/apt/lists', data)
        if lists.exists():
            extlib.sudo('rm', '-rf', lists)
        extlib.sudo('mv', args.work / 'lists.upper', lists)
        extlib.sudo('rm', '-f', lists / 'etc/resolv.conf')
    only = set(args.only.split(',')) if args.only else None
    deny = set(data['apt']['deny'])
    deny_suffix = tuple(data['apt'].get('denySuffix', []))  # 例如 -doc：文档包一律不进扩展包
    locks = {}
    for pack in extlib.ordered(data):
        pid = pack['id']
        path = extlib.LOCKS / f'{pid}.lock.json'
        if only is not None and pid not in only:
            if path.is_file():
                locks[pid] = json.loads(path.read_text())
            continue
        packages = []
        if pack.get('seeds'):
            need = extlib.closure(data, pid)
            with extlib.overlay(args.work, [lists, base], 'resolve', network=True) as (merged, upper):
                for req in need:
                    rows = locks[req]['packages']
                    if rows:
                        spec = ' '.join(extlib.q(f"{r['Package']}={r['Version']}") for r in rows)
                        extlib.chroot(merged, f'apt-get {extlib.APT_OPTS} install -y -q {spec} >/dev/null')
                synth = []
                for spec in pack.get('synthetic', []):
                    body = extlib.synthetic_deb(spec, data['sourceDateEpoch'])
                    name = f"{spec['package']}_{spec['version']}_all.deb"
                    extlib.sudo('dd', 'of=' + str(merged / 'tmp' / name), 'status=none', input=body)
                    extlib.chroot(merged, f'dpkg -i /tmp/{extlib.q(name)} >/dev/null')
                    synth.append({'Package': spec['package'], 'Version': spec['version'], 'Architecture': 'all',
                                  'Filename': 'synthetic/' + name, 'Size': str(len(body)),
                                  'SHA256': extlib.hashlib.sha256(body).hexdigest(), 'Installed-Size': '0',
                                  'Source': spec['package'], 'Section': 'misc', 'Suite': 'synthetic', 'Synthetic': True})
                out = extlib.chroot(merged, f'apt-get {extlib.APT_OPTS} install -s -q ' + ' '.join(map(extlib.q, pack['seeds'])),
                                    capture=True).stdout
            for line in out.splitlines():
                m = re.match(r'^Inst (\S+) (?:\[(\S+)\] )?\((\S+) ', line)
                if not m:
                    continue
                name, old, version = m.groups()
                name = name.split(':')[0]
                if name in deny or name.endswith(deny_suffix):
                    raise ValueError(f'EXT_DENIED_PACKAGE:{pid}:{name}')
                row = index.get((name, version))
                if row is None:
                    raise ValueError(f'EXT_UNINDEXED:{name}={version}')
                row = dict(row)
                if old:
                    row['Replaces-Base'] = old
                packages.append(row)
            packages.extend(synth)
            packages.sort(key=lambda r: r['Package'])
            if not packages:
                raise ValueError('EXT_EMPTY_RESOLUTION:' + pid)
        lock = {'format': 1, 'id': pid, 'base': data['base'], 'sources': sources,
                'requires': pack.get('requires', []), 'seeds': pack.get('seeds', []),
                'packages': packages, 'upstream': pack.get('upstream', [])}
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(lock, indent=1, ensure_ascii=False) + '\n', encoding='utf-8')
        locks[pid] = lock
        size = sum(int(r['Size']) for r in packages)
        inst = sum(int(r.get('Installed-Size', 0)) for r in packages) * 1024
        print(json.dumps({'id': pid, 'packages': len(packages), 'debBytes': size, 'installedBytes': inst}), flush=True)


if __name__ == '__main__':
    main()
