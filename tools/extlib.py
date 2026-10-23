"""DSHA 离线扩展包构建期共用工具：官方 rootfs 工作区、overlay、qemu chroot。

只在构建机（Linux x86_64/arm64）上使用；需要 sudo、overlayfs 与 qemu-aarch64 binfmt（F 标志）。
"""
import contextlib
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
PACKS = ROOT / 'tools/extensions/packs.json'
LOCKS = ROOT / 'tools/extensions/locks'
ASSETS = ROOT / 'app/src/main/assets'
# 大文件工作区（基底解包、apt 列表、下载缓存）放仓库外或 build/，可用环境变量改位置。
EXT_WORK = Path(os.environ.get('DSHA_EXT_WORK') or ROOT / 'build/ext-work')
EXT_CACHE = Path(os.environ.get('DSHA_EXT_CACHE') or ROOT / 'build/ext-cache')
CHROOT_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'


def digest(path):
    value = hashlib.sha256()
    with open(path, 'rb') as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b''):
            value.update(chunk)
    return value.hexdigest()


def load_packs():
    data = json.loads(PACKS.read_text(encoding='utf-8'))
    if data.get('format') != 1:
        raise ValueError('EXT_PACKS_FORMAT')
    ids = [p['id'] for p in data['packs']]
    if len(set(ids)) != len(ids):
        raise ValueError('EXT_PACK_DUPLICATE')
    for pack in data['packs']:
        if not __import__('re').fullmatch(r'[a-z0-9][a-z0-9-]{0,31}', pack['id']):
            raise ValueError('EXT_PACK_ID:' + pack['id'])
        if pack['category'] not in ('lang', 'media', 'devtools'):
            raise ValueError('EXT_PACK_CATEGORY:' + pack['id'])
        for need in pack.get('requires', []):
            if need not in ids:
                raise ValueError('EXT_PACK_REQUIRES:' + need)
    return data


def ordered(data):
    """按 requires 拓扑排序。"""
    byid = {p['id']: p for p in data['packs']}
    seen, out = set(), []

    def visit(pid, stack=()):
        if pid in stack:
            raise ValueError('EXT_PACK_CYCLE:' + pid)
        if pid in seen:
            return
        for need in byid[pid].get('requires', []):
            visit(need, stack + (pid,))
        seen.add(pid)
        out.append(byid[pid])
    for p in data['packs']:
        visit(p['id'])
    return out


def closure(data, pid):
    byid = {p['id']: p for p in data['packs']}
    out = []

    def visit(x):
        for need in byid[x].get('requires', []):
            visit(need)
            if need not in out:
                out.append(need)
    visit(pid)
    return out


def sudo(*args, **kw):
    return subprocess.run(['sudo', '-n', *map(str, args)], check=True, **kw)


def prepare_base(work, data):
    """把 APK 内同一份 offline-rootfs.bin + ubuntu-tools.bin 解成基线，并核对 dpkg 状态摘要。"""
    base = Path(work) / 'base'
    marker = Path(work) / 'base.ok'
    want = data['base']['statusSha256']
    if marker.is_file() and marker.read_text().strip() == want:
        return base
    if base.exists():
        sudo('rm', '-rf', base)
    base.mkdir(parents=True)
    sudo('tar', '-xzf', ASSETS / 'offline-rootfs.bin', '-C', base)
    sudo('tar', '-xzf', ASSETS / 'ubuntu-tools.bin', '-C', base)
    sudo('mkdir', '-p', base / 'tmp', base / 'dev', base / 'proc')
    sudo('chmod', '1777', base / 'tmp')
    status = subprocess.run(['sudo', '-n', 'sha256sum', base / 'var/lib/dpkg/status'], check=True,
                            capture_output=True, text=True).stdout.split()[0]
    if status != want:
        raise ValueError('EXT_BASE_STATUS_MISMATCH:' + status)
    tools = subprocess.run(['sudo', '-n', 'cat', base / 'root/.dsha-ubuntu-tools-version'], check=True,
                           capture_output=True, text=True).stdout.strip()
    if tools != data['base']['toolsLockSha256']:
        raise ValueError('EXT_BASE_TOOLS_MISMATCH')
    if (ASSETS / 'offline-rootfs.version').read_text().strip() != data['base']['rootfsVersion']:
        raise ValueError('EXT_BASE_ROOTFS_VERSION')
    marker.write_text(want + '\n')
    return base


@contextlib.contextmanager
def overlay(work, lowers, name, keep_upper=False, network=False):
    """lowers 从上到下；upper 写到 work/<name>.upper。退出时卸载 proc/dev 与 overlay。"""
    work = Path(work)
    upper, wdir, merged = work / (name + '.upper'), work / (name + '.work'), work / (name + '.merged')
    # 上次运行被打断时 merged 下可能还挂着 /dev（rbind）与 proc：先全部卸载，绝不能对挂载点 rm -rf。
    stale = [line.split()[1] for line in Path('/proc/self/mounts').read_text().splitlines()
             if line.split()[1] == str(merged) or line.split()[1].startswith(str(merged) + '/')]
    for m in sorted(stale, key=len, reverse=True):
        subprocess.run(['sudo', '-n', 'umount', '-R', '-l', m])
    if any(line.split()[1].startswith(str(merged)) for line in Path('/proc/self/mounts').read_text().splitlines()):
        raise RuntimeError('EXT_STALE_MOUNT:' + str(merged))
    for d in (upper, wdir, merged):
        if d.exists() and not (d == upper and keep_upper):
            sudo('rm', '-rf', d)
        if not d.exists():
            sudo('mkdir', '-p', d)
    sudo('mount', '-t', 'overlay', 'overlay', '-o',
         'lowerdir=' + ':'.join(str(Path(l)) for l in lowers) + f',upperdir={upper},workdir={wdir}', merged)
    mounted = []
    try:
        for sub, args in (('proc', ['-t', 'proc', 'proc']), ('dev', ['--rbind', '/dev'])):
            sudo('mount', *args, merged / sub)
            mounted.append(merged / sub)
        if network:
            sudo('cp', '-L', '/etc/resolv.conf', merged / 'etc/resolv.conf')
        yield merged, upper
    finally:
        for m in reversed(mounted):
            subprocess.run(['sudo', '-n', 'umount', '-R', '-l', str(m)])
        subprocess.run(['sudo', '-n', 'umount', '-l', str(merged)])
        subprocess.run(['sudo', '-n', 'rm', '-rf', str(wdir)])


def chroot(merged, script, check=True, capture=False, env=None, timeout=None):
    values = {'PATH': CHROOT_PATH, 'HOME': '/root', 'LC_ALL': 'C.UTF-8', 'DEBIAN_FRONTEND': 'noninteractive', **(env or {})}
    cmd = ['sudo', '-n', 'chroot', str(merged), '/usr/bin/env', '-i', *[f'{k}={v}' for k, v in values.items()],
           '/bin/bash', '-c', 'set -euo pipefail; ' + script]
    return subprocess.run(cmd, check=check, capture_output=capture, text=True, timeout=timeout)


APT_OPTS = ('-o Dir::Etc::sourcelist=/etc/apt/dsha-ext.list -o Dir::Etc::sourceparts=- '
            '-o APT::Install-Recommends=false -o APT::Install-Suggests=false -o Acquire::Retries=3')


def apt_list(data):
    a = data['apt']
    return ''.join(f"deb [signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg] {a['mirror']} {s} {' '.join(a['components'])}\n"
                   for s in a['suites'])


def read_file_root(path):
    return subprocess.run(['sudo', '-n', 'cat', str(path)], check=True, capture_output=True).stdout


def write_file_root(path, text, mode='644'):
    with tempfile.NamedTemporaryFile('w', delete=False, encoding='utf-8') as tmp:
        tmp.write(text)
    sudo('install', '-m', mode, tmp.name, path)
    os.unlink(tmp.name)


def q(s):
    return shlex.quote(s)


def synthetic_deb(spec, epoch):
    """生成只含元数据的标记包（逐字节可复现的 ar + control.tar.gz + data.tar.gz）。

    用途：基底的 /usr/bin/python3 由 DSHA 运行时提供（不归 dpkg 管），Ubuntu 的 python3 包会覆盖它，所以被 deny；
    少数包（如 texlive-latex-extra）只为辅助脚本硬依赖 python3，用 Provides 标记“外部已提供”，不装任何文件。
    """
    import gzip as _gzip
    import io as _io
    import tarfile as _tarfile

    def tgz(files):
        raw = _io.BytesIO()
        with _tarfile.open(fileobj=raw, mode='w', format=_tarfile.GNU_FORMAT) as t:
            for name, body in [('./', None)] + sorted(files.items()):
                info = _tarfile.TarInfo(name)
                info.mtime, info.uid, info.gid, info.uname, info.gname = epoch, 0, 0, 'root', 'root'
                if body is None:
                    info.type, info.mode = _tarfile.DIRTYPE, 0o755
                    t.addfile(info)
                else:
                    info.mode, info.size = 0o644, len(body)
                    t.addfile(info, _io.BytesIO(body))
        out = _io.BytesIO()
        with _gzip.GzipFile(filename='', mode='wb', compresslevel=9, fileobj=out, mtime=0) as z:
            z.write(raw.getvalue())
        return out.getvalue()

    control = ''.join(f'{k}: {v}\n' for k, v in (
        ('Package', spec['package']), ('Version', spec['version']), ('Architecture', 'all'),
        ('Maintainer', 'DSHA AllitorFk <noreply@invalid>'), ('Installed-Size', '0'), ('Provides', spec['provides']),
        ('Section', 'misc'), ('Priority', 'optional'), ('Multi-Arch', 'foreign'),
        ('Description', spec['description'].splitlines()[0]),
    )).encode()
    members = [('debian-binary', b'2.0\n'), ('control.tar.gz', tgz({'./control': control})), ('data.tar.gz', tgz({}))]
    out = bytearray(b'!<arch>\n')
    for name, body in members:
        out += f'{name + "/":<16}{epoch:<12}{0:<6}{0:<6}{"100644":<8}{len(body):<10}`\n'.encode()
        out += body
        if len(body) % 2:
            out += b'\n'
    return bytes(out)
