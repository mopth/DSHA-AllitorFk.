// DSHA 离线扩展包管理：校验（目录 sha256 → 包内 SHA256SUMS）→ 绑定基底版本 → 空间预检 →
// 本地平铺源 + apt 精确版本安装 → 上游工具链移入 /opt/dsha-ext → 冒烟 → 原子写状态；任一步失败即回滚。
// 移除只清理本包新装且已无人依赖的包（apt 模拟结果必须是该集合的子集），基底升级过的库保留。
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { constants, openSync, createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statfsSync,
  writeFileSync, symlinkSync, readlinkSync, lstatSync, unlinkSync, cpSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { extractDshx, verifySums } from './dshx.js';

const MB = 1024 * 1024;
const ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
// 一键下载只认这个固定前缀：本 fork 的 Release 资产；目录（随 APK 内置）是信任根。
export const RELEASE_PREFIX = 'https://github.com/mopth/DSHA-AllitorFk./releases/download/';
const TAG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/;
const DOWNLOAD_HOSTS = new Set(['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);

/** 由目录算出某包的下载地址；目录里的 base 不在固定前缀下或文件名不合规时拒绝。 */
/** 按依赖顺序（先依赖后本包）列出 pid 还缺的、尚未启用的依赖；目录里有环或缺条目时抛错。 */
export function missingDeps(cat, active, pid) {
  const out = [];
  const visit = (id, path) => {
    const entry = cat.packs.find(p => p.id === id);
    if (!entry) throw new Error('EXT_UNKNOWN:' + id);
    for (const req of entry.requires ?? []) {
      if (path.includes(req)) throw new Error('EXT_REQUIRES_CYCLE:' + req);
      if (active[req] || out.includes(req)) continue;
      visit(req, [...path, req]);
      out.push(req);
    }
  };
  visit(pid, [pid]);
  return out;
}

export function packUrl(cat, entry) {
  const base = cat?.download?.base;
  if (typeof base !== 'string' || !base.startsWith(RELEASE_PREFIX)) throw new Error('EXT_DOWNLOAD_BASE');
  const tag = base.slice(RELEASE_PREFIX.length);
  if (!TAG.test(tag)) throw new Error('EXT_DOWNLOAD_BASE');
  if (!/^[a-z0-9][a-z0-9-]{0,31}\.dshx$/.test(entry.file) || entry.file !== entry.id + '.dshx') throw new Error('EXT_ID');
  return RELEASE_PREFIX + tag + '/' + entry.file;
}

export function createExtensionManager(options = {}) {
  const root = options.root ?? '/';
  const home = options.stateDir ?? join(root, 'root/.dsha-ext');
  const catalogPath = options.catalogPath ?? new URL('../ext-catalog.json', import.meta.url);
  const optDir = join(root, 'opt/dsha-ext');
  const binDir = join(root, 'usr/local/bin');
  const packsDir = join(home, 'packs');
  const stateFile = join(home, 'state.json');
  const log = [];
  let job = null;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const sleep = options.sleep ?? ((ms) => new Promise(r => setTimeout(r, ms)));
  const lastJobFile = join(home, 'last-job.json');
  // 上次任务结果落盘：Web 服务重启后卡片上仍能看到失败原因。
  let lastJob = (() => { try { const j = JSON.parse(readFileSync(lastJobFile, 'utf8')); return j && typeof j.pid === 'string' ? j : null; } catch { return null; } })();
  const saveLastJob = (j) => {
    lastJob = j;
    try { mkdirSync(home, { recursive: true, mode: 0o700 }); writeFileSync(lastJobFile, JSON.stringify(j) + '\n', { mode: 0o600 }); } catch {}
  };

  const catalog = () => JSON.parse(readFileSync(catalogPath, 'utf8'));
  const readState = () => { try { return JSON.parse(readFileSync(stateFile, 'utf8')); } catch { return { schema: 1, active: {} }; } };
  const writeState = (state) => {
    mkdirSync(home, { recursive: true, mode: 0o700 });
    const temp = stateFile + '.' + process.pid + '.tmp';
    writeFileSync(temp, JSON.stringify(state, null, 1) + '\n', { mode: 0o600 });
    renameSync(temp, stateFile);
  };
  const say = (line) => { log.push(String(line)); if (log.length > 400) log.splice(0, log.length - 400); options.onLog?.(line); };

  function run(cmd, args, { allowFail = false, capture = false, quiet = false } = {}) {
    return new Promise((resolve, reject) => {
      const env = { PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', HOME: '/root', LANG: 'C.UTF-8',
        DEBIAN_FRONTEND: 'noninteractive', DEBCONF_NONINTERACTIVE_SEEN: 'true', TMPDIR: '/tmp' };
      const child = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      const feed = (data) => {
        const text = data.toString();
        if (capture) out += text;
        if (!quiet) for (const line of text.split('\n')) if (line.trim()) say(line.slice(0, 400));
      };
      child.stdout.on('data', feed); child.stderr.on('data', feed);
      child.on('error', reject);
      child.on('close', (code) => code === 0 || allowFail ? resolve({ code, out }) : reject(new Error(`EXT_CMD_FAILED:${cmd}:${code}`)));
    });
  }

  async function sha256File(file) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file, { highWaterMark: 1 << 20 })) hash.update(chunk);
    return hash.digest('hex');
  }

  function baseCheck(cat) {
    const tools = readFileSync(join(root, 'root/.dsha-ubuntu-tools-version'), 'utf8').trim();
    if (tools !== cat.base.toolsLockSha256) throw new Error('EXT_BASE_TOOLS_MISMATCH');
    let identity = '';
    try { identity = readFileSync(join(home, 'base-identity'), 'utf8').trim(); } catch {}
    if (identity !== cat.base.rootfsVersion) throw new Error('EXT_BASE_ROOTFS_MISMATCH');
  }

  function freeBytes(path) {
    if (options.freeBytes) return options.freeBytes(path);
    const s = statfsSync(path);
    return Number(s.bavail) * Number(s.bsize);
  }

  function aptOptions(staging) {
    return ['-o', `Dir::Etc::sourcelist=${staging}/sources.list`, '-o', 'Dir::Etc::sourceparts=-',
      '-o', `Dir::State::Lists=${staging}/lists`, '-o', `Dir::Cache=${staging}/cache`,
      '-o', 'APT::Sandbox::User=root', '-o', 'APT::Install-Recommends=false', '-o', 'APT::Install-Suggests=false',
      '-o', 'Dpkg::Options::=--force-confdef', '-o', 'Dpkg::Options::=--force-confold', '-o', 'Acquire::Languages=none'];
  }

  function dpkgInstalled() {
    // 直接读 dpkg status，避免依赖 dpkg-query 输出格式。
    const text = readFileSync(join(root, 'var/lib/dpkg/status'), 'utf8');
    const map = new Map();
    for (const stanza of text.split('\n\n')) {
      const pkg = /^Package: (.+)$/m.exec(stanza)?.[1];
      const st = /^Status: (.+)$/m.exec(stanza)?.[1];
      const arch = /^Architecture: (.+)$/m.exec(stanza)?.[1];
      const ver = /^Version: (.+)$/m.exec(stanza)?.[1];
      if (pkg && st && st.endsWith(' installed')) map.set(arch && arch !== 'all' && arch !== 'arm64' ? `${pkg}:${arch}` : pkg, ver);
    }
    return map;
  }

  async function purgeOwned(owned, seeds, staging) {
    // owned = 扩展装进来的全部包（全局）。seeds 改为 auto 后，autoremove 模拟与 owned 的交集
    // 就是“扩展带来、且已无任何手动包依赖”的集合；基底原有的包永远不在 owned 里。
    if (!owned.length) return [];
    const present = dpkgInstalled();
    const markable = seeds.filter(s => present.has(s) && owned.includes(s));
    if (markable.length) await run('apt-mark', ['auto', ...markable]);
    // 只看依赖：基底里的 Recommends/Suggests 不应把本包新装的东西留下（结果仍与 owned 取交集）。
    const strict = ['-o', 'APT::AutoRemove::RecommendsImportant=false', '-o', 'APT::AutoRemove::SuggestsImportant=false'];
    const sim = await run('apt-get', ['-s', ...aptOptions(staging), ...strict, 'autoremove', '--purge'], { capture: true });
    const removable = [...sim.out.matchAll(/^Purg (\S+)/gm)].map(m => m[1]).filter(p => owned.includes(p));
    const check = await run('apt-get', ['-s', ...aptOptions(staging), 'purge', ...removable], { capture: true });
    const touched = [...check.out.matchAll(/^(?:Purg|Remv) (\S+)/gm)].map(m => m[1]);
    const stray = touched.filter(p => !removable.includes(p));
    if (stray.length) throw new Error('EXT_REMOVE_WOULD_TOUCH:' + stray.slice(0, 8).join(','));
    if (removable.length) await run('apt-get', [...aptOptions(staging), '-y', 'purge', ...removable]);
    // autoremove 不碰 Priority: important 的包（如 tzdata）；无人依赖时单独确认后清理。
    const after = dpkgInstalled();
    const manual = new Set((await run('apt-mark', ['showmanual'], { capture: true, quiet: true })).out.split('\n').map(x => x.trim()));
    const extra = [];
    // 手动标记的包属于其它扩展的种子或用户自己装的，不动。
    for (const name of owned.filter(p => after.has(p) && !manual.has(p))) {
      const one = await run('apt-get', ['-s', ...aptOptions(staging), 'purge', name], { capture: true, quiet: true });
      const hit = [...one.out.matchAll(/^(?:Purg|Remv) (\S+)/gm)].map(m => m[1]);
      if (hit.length === 1 && hit[0] === name) extra.push(name);
    }
    if (extra.length) await run('apt-get', [...aptOptions(staging), '-y', 'purge', ...extra]);
    return [...removable, ...extra];
  }

  function linkBins(pid, bins) {
    const linked = [];
    for (const rel of bins) {
      const name = rel.split('/').pop();
      const target = `/opt/dsha-ext/${pid}/${rel}`;
      const link = join(binDir, name);
      let existing = null;
      try { existing = lstatSync(link); } catch {}
      if (existing) { say(`跳过 ${name}：/usr/local/bin 已有同名文件`); continue; }
      mkdirSync(binDir, { recursive: true });
      symlinkSync(target, link);
      linked.push(name);
    }
    return linked;
  }

  function unlinkBins(pid, names) {
    for (const name of names ?? []) {
      const link = join(binDir, name);
      try { if (readlinkSync(link).startsWith(`/opt/dsha-ext/${pid}/`)) unlinkSync(link); } catch {}
    }
  }

  function newStaging(pid) {
    const staging = join(home, 'staging', `${pid}-${randomBytes(4).toString('hex')}`);
    mkdirSync(join(staging, 'lists/partial'), { recursive: true, mode: 0o700 });
    mkdirSync(join(staging, 'cache/archives/partial'), { recursive: true, mode: 0o700 });
    writeFileSync(join(staging, 'sources.list'), '');
    return staging;
  }

  async function activate(pid) {
    if (!ID.test(pid)) throw new Error('EXT_ID');
    const cat = catalog();
    const entry = cat.packs.find(p => p.id === pid);
    if (!entry) throw new Error('EXT_UNKNOWN');
    const state = readState();
    if (state.active[pid]) throw new Error('EXT_ALREADY_ACTIVE');
    for (const req of entry.requires) if (!state.active[req]) throw new Error('EXT_REQUIRES:' + req);
    baseCheck(cat);
    const file = join(packsDir, entry.file);
    if (!existsSync(file)) throw new Error('EXT_PACK_MISSING');
    if (statSync(file).size !== entry.bytes) throw new Error('EXT_PACK_SIZE');
    say(`校验 ${entry.file}（${Math.round(entry.bytes / MB)} MB）…`);
    if (await sha256File(file) !== entry.sha256) throw new Error('EXT_PACK_DIGEST');
    const need = entry.bytes + Math.ceil(entry.installedBytes * 1.3) + 256 * MB;
    const free = freeBytes(home);
    if (free < need) throw new Error(`EXT_NO_SPACE:need=${Math.ceil(need / MB)}MB,free=${Math.floor(free / MB)}MB`);
    const staging = newStaging(pid);
    const unpack = join(staging, 'pack');
    let owned = [], linked = [], movedTree = false;
    try {
      say('解包并逐文件校验…');
      const { files } = await extractDshx(file, unpack, pid);
      verifySums(readFileSync(join(unpack, 'SHA256SUMS'), 'utf8'), files);
      const manifest = JSON.parse(readFileSync(join(unpack, 'dshx.json'), 'utf8'));
      const sameBase = ['rootfsVersion', 'toolsLockSha256', 'statusSha256', 'dshVersion'].every(k => manifest.base?.[k] === cat.base[k]);
      if (manifest.id !== pid || !sameBase) throw new Error('EXT_MANIFEST_MISMATCH');
      const before = dpkgInstalled();
      const autoBefore = new Set((await run('apt-mark', ['showauto'], { capture: true, quiet: true })).out.split('\n').map(x => x.trim()).filter(Boolean));
      if (manifest.packages.length) {
        writeFileSync(join(staging, 'sources.list'), `deb [trusted=yes] file:${unpack}/repo ./\n`);
        await run('apt-get', [...aptOptions(staging), 'update']);
        say(`安装 ${manifest.packages.length} 个固定版本的包…`);
        // 先算出将新装的包，安装中途失败也能据此回滚。
        const plan = await run('apt-get', ['-s', ...aptOptions(staging), 'install', ...manifest.packages], { capture: true });
        owned = [...plan.out.matchAll(/^Inst (\S+)/gm)].map(m => m[1]).filter(p => !before.has(p));
        await run('apt-get', [...aptOptions(staging), '-y', 'install', ...manifest.packages]);
        const after = dpkgInstalled();
        for (const spec of manifest.packages) {
          const [name, ver] = spec.split('=');
          if (after.get(name) !== ver) throw new Error('EXT_VERSION_DRIFT:' + spec);
        }
        // apt 会把命令行点名的已装包改成“手动”；非种子一律恢复为 auto，否则日后无法自动清理。
        const names = manifest.packages.map(spec => spec.split('=')[0]);
        const autos = names.filter(p => !manifest.seeds.includes(p) && (owned.includes(p) || autoBefore.has(p)));
        if (autos.length) await run('apt-mark', ['auto', ...autos], { quiet: true });
      }
      if (manifest.upstreamPrefix) {
        const src = join(unpack, 'tree/opt/dsha-ext', pid);
        const dst = join(optDir, pid);
        if (existsSync(dst)) throw new Error('EXT_PREFIX_EXISTS');
        mkdirSync(optDir, { recursive: true });
        try { renameSync(src, dst); } catch { cpSync(src, dst, { recursive: true }); }
        movedTree = true;
        linked = linkBins(pid, manifest.bins);
      }
      const lic = join(optDir, 'licenses', pid);
      rmSync(lic, { recursive: true, force: true });
      mkdirSync(dirname(lic), { recursive: true });
      cpSync(join(unpack, 'licenses'), lic, { recursive: true });
      for (const cmd of manifest.smoke) {
        say('冒烟：' + cmd);
        await run('/bin/bash', ['-c', cmd]);
      }
      const next = readState();
      // 所有权按“扩展装进来的包”全局记账：共享依赖由最后一个用到它的扩展移除时清理。
      next.owned = [...new Set([...(next.owned ?? []), ...owned])].sort();
      next.active[pid] = { at: new Date().toISOString(), sha256: entry.sha256, installed: owned, seeds: manifest.seeds, linked,
        prefix: manifest.upstreamPrefix, upgradesBase: manifest.upgradesBase };
      writeState(next);
      say('已启用 ' + pid);
    } catch (error) {
      say('失败，回滚：' + error.message);
      try {
        unlinkBins(pid, linked);
        if (movedTree) rmSync(join(optDir, pid), { recursive: true, force: true });
        rmSync(join(optDir, 'licenses', pid), { recursive: true, force: true });
        await purgeOwned([...new Set([...(readState().owned ?? []), ...owned])], manifest_seeds(unpack), staging);
      } catch (rollback) { say('回滚未完成：' + rollback.message); }
      throw error;
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  }

  function manifest_seeds(unpack) {
    try { return JSON.parse(readFileSync(join(unpack, 'dshx.json'), 'utf8')).seeds; } catch { return []; }
  }

  async function remove(pid) {
    if (!ID.test(pid)) throw new Error('EXT_ID');
    const cat = catalog();
    const state = readState();
    const record = state.active[pid];
    if (!record) throw new Error('EXT_NOT_ACTIVE');
    const dependents = cat.packs.filter(p => state.active[p.id] && p.requires.includes(pid)).map(p => p.id);
    if (dependents.length) throw new Error('EXT_REQUIRED_BY:' + dependents.join(','));
    const staging = newStaging(pid);
    try {
      unlinkBins(pid, record.linked);
      if (record.prefix) rmSync(join(optDir, pid), { recursive: true, force: true });
      rmSync(join(optDir, 'licenses', pid), { recursive: true, force: true });
      // 其它已启用包仍需要的包会因依赖关系不出现在 autoremove 结果里。
      const others = new Set(Object.entries(state.active).filter(([k]) => k !== pid).flatMap(([, v]) => v.seeds));
      const removed = await purgeOwned(state.owned ?? [], record.seeds.filter(s => !others.has(s)), staging);
      say(`已移除 ${pid}：清理 ${removed.length} 个包`);
      const next = readState();
      delete next.active[pid];
      next.owned = (next.owned ?? []).filter(p => !removed.includes(p));
      writeState(next);
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  }

  /** 网页导入：边写边算 sha256，只接受目录里登记过的包。 */
  async function importStream(stream, declaredId) {
    const cat = catalog();
    const entry = cat.packs.find(p => p.id === declaredId);
    if (!entry) throw new Error('EXT_UNKNOWN');
    mkdirSync(packsDir, { recursive: true, mode: 0o700 });
    if (freeBytes(home) < entry.bytes + 256 * MB) throw new Error('EXT_NO_SPACE');
    const temp = join(packsDir, `.${entry.file}.${randomBytes(4).toString('hex')}.part`);
    const hash = createHash('sha256');
    let size = 0;
    try {
      await new Promise((resolve, reject) => {
        const out = createWriteStream(temp, { mode: 0o600 });
        stream.on('data', (chunk) => {
          size += chunk.length; hash.update(chunk);
          if (size > entry.bytes) { stream.destroy(); reject(new Error('EXT_PACK_SIZE')); }
        });
        stream.on('error', reject); out.on('error', reject); out.on('finish', resolve);
        stream.pipe(out);
      });
      if (size !== entry.bytes || hash.digest('hex') !== entry.sha256) throw new Error('EXT_PACK_DIGEST');
      renameSync(temp, join(packsDir, entry.file));
    } finally { rmSync(temp, { force: true }); }
  }

  /**
   * 一键下载：从固定 Release 地址拉取。手动跟随最多 3 次重定向（每跳 https、主机白名单、无 userinfo/端口）；
   * 空闲 60 秒无数据或超过总时长即中止（不会一直占着任务锁）；断点续传只接受与已下字节完全吻合的
   * Content-Range，否则从头下；落盘前按内置目录核对大小与 sha256，不符即删除并拒绝。
   */
  async function download(pid, onProgress = () => {}) {
    if (!ID.test(pid)) throw new Error('EXT_ID');
    const cat = catalog();
    const entry = cat.packs.find(p => p.id === pid);
    if (!entry) throw new Error('EXT_UNKNOWN');
    const url = packUrl(cat, entry);
    mkdirSync(packsDir, { recursive: true, mode: 0o700 });
    const dirStat = lstatSync(packsDir);
    if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) throw new Error('EXT_PACKS_DIR');
    const final = join(packsDir, entry.file);
    const finalStat = (() => { try { return lstatSync(final); } catch { return null; } })();
    if (finalStat && finalStat.isFile() && finalStat.size === entry.bytes && await sha256File(final) === entry.sha256) return 'present';
    const part = join(packsDir, `.${entry.id}.${entry.sha256.slice(0, 8)}.download`);
    const partSize = () => { try { const st = lstatSync(part); if (!st.isFile()) throw new Error('EXT_PACKS_DIR'); return st.size; } catch (e) { if (e.message === 'EXT_PACKS_DIR') throw e; return 0; } };
    let have = partSize();
    if (have > entry.bytes) { rmSync(part, { force: true }); have = 0; }
    const need = entry.bytes - have + 256 * MB;
    const free = freeBytes(home);
    if (free < need) throw new Error(`EXT_NO_SPACE:need=${Math.ceil(need / MB)}MB,free=${Math.floor(free / MB)}MB`);
    const idleMs = options.idleMs ?? 60_000;
    const deadline = Date.now() + (options.totalMs ?? 2 * 3600_000);
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const ctl = new AbortController();
      let idle = null;
      const kick = () => { clearTimeout(idle); idle = setTimeout(() => ctl.abort(new Error('EXT_NETWORK:TIMEOUT_IDLE')), idleMs); };
      const total = setTimeout(() => ctl.abort(new Error('EXT_NETWORK:TIMEOUT_TOTAL')), Math.max(0, deadline - Date.now()));
      try {
        if (Date.now() >= deadline) throw new Error('EXT_NETWORK:TIMEOUT_TOTAL');
        have = partSize();
        if (have < entry.bytes) {
          say(`下载 ${entry.file}（${attempt > 1 ? '第 ' + attempt + ' 次，' : ''}${have ? '从 ' + Math.floor(have / MB) + ' MB 续传' : '从头开始'}）…`);
          kick();
          let res = await fetchFollow(url, have ? { range: `bytes=${have}-` } : {}, ctl.signal);
          if (res.status === 206) {
            const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(header(res, 'content-range') ?? '');
            if (!have || !m || Number(m[1]) !== have || Number(m[2]) !== entry.bytes - 1 || Number(m[3]) !== entry.bytes) {
              say('服务器返回的续传范围不对，改为从头下载');
              await cancelBody(res);
              rmSync(part, { force: true }); have = 0;
              kick();
              res = await fetchFollow(url, {}, ctl.signal);
            }
          }
          if (res.status === 200 && have) { rmSync(part, { force: true }); have = 0; }
          if (res.status !== 200 && res.status !== 206) { await cancelBody(res); throw new Error('EXT_NETWORK:HTTP_' + res.status); }
          const length = header(res, 'content-length');
          if (length !== null && length !== undefined && Number(length) > entry.bytes - have) {
            await cancelBody(res); rmSync(part, { force: true });
            throw new Error('EXT_PACK_SIZE');
          }
          if (!res.body) throw new Error('EXT_NETWORK:EMPTY');
          const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | (have ? constants.O_APPEND : constants.O_TRUNC);
          const fd = openSync(part, flags, 0o600);
          const out = createWriteStream(null, { fd });
          try {
            let got = have;
            const aborted = new Promise((_, reject) => ctl.signal.addEventListener('abort', () => reject(ctl.signal.reason), { once: true }));
            aborted.catch(() => {});
            const iterator = res.body[Symbol.asyncIterator]();
            for (;;) {
              const step = await Promise.race([iterator.next(), aborted]);
              if (step.done) break;
              kick();
              got += step.value.length;
              if (got > entry.bytes) throw new Error('EXT_PACK_SIZE');
              if (!out.write(step.value)) await Promise.race([new Promise(r => out.once('drain', r)), aborted]);
              onProgress(got, entry.bytes);
            }
            await new Promise((resolve, reject) => { out.on('error', reject); out.end(resolve); });
          } catch (error) {
            out.destroy();
            try { await iteratorReturn(res.body); } catch {}
            throw error;
          }
        }
        clearTimeout(idle);
        const size = partSize();
        say('核对 sha256…');
        if (size !== entry.bytes || await sha256File(part) !== entry.sha256) {
          rmSync(part, { force: true });
          throw new Error('EXT_PACK_DIGEST');
        }
        renameSync(part, final);
        onProgress(entry.bytes, entry.bytes);
        say('下载完成并通过校验：' + entry.file);
        return 'downloaded';
      } catch (error) {
        lastError = ctl.signal.aborted && ctl.signal.reason ? ctl.signal.reason : error;
        const code = String(lastError.message ?? lastError);
        if (/^EXT_(PACK_DIGEST|PACK_SIZE|PACKS_DIR|DOWNLOAD_REDIRECT|DOWNLOAD_BASE)/.test(code)) {
          if (!code.startsWith('EXT_PACKS_DIR')) rmSync(part, { force: true });
          throw lastError;
        }
        say('下载中断：' + code);
        if (code === 'EXT_NETWORK:TIMEOUT_TOTAL') break;
        if (attempt < 3) await sleep(1500 * attempt);
      } finally {
        clearTimeout(idle); clearTimeout(total);
      }
    }
    const code = String(lastError?.message ?? lastError);
    throw new Error(code.startsWith('EXT_') ? code : 'EXT_NETWORK:' + code);
  }

  function header(res, name) {
    const h = res.headers;
    if (!h) return null;
    if (typeof h.get === 'function') return h.get(name);
    return h[name] ?? h[name.toLowerCase()] ?? null;
  }

  async function cancelBody(res) {
    try { if (res.body?.cancel) await res.body.cancel(); else await iteratorReturn(res.body); } catch {}
  }

  async function iteratorReturn(body) {
    const it = body?.[Symbol.asyncIterator]?.();
    if (it?.return) await it.return();
  }

  /** 手动跟随重定向：最多 3 跳；每跳必须是 https、白名单主机、无 userinfo、默认端口。 */
  async function fetchFollow(start, headers, signal) {
    let current = start;
    for (let hop = 0; hop <= 3; hop++) {
      const u = new URL(current);
      if (u.protocol !== 'https:' || !DOWNLOAD_HOSTS.has(u.hostname) || u.username || u.password || u.port)
        throw new Error('EXT_DOWNLOAD_REDIRECT:' + u.protocol + '//' + u.host);
      const res = await fetchImpl(u.href, { headers, redirect: 'manual', signal });
      if (![301, 302, 303, 307, 308].includes(res.status)) return res;
      await cancelBody(res);
      const next = header(res, 'location');
      if (!next) throw new Error('EXT_NETWORK:REDIRECT_NO_LOCATION');
      current = new URL(next, u).href;
    }
    throw new Error('EXT_DOWNLOAD_REDIRECT:TOO_MANY');
  }

  function list() {
    const cat = catalog();
    const state = readState();
    let baseOk = true, baseError = null;
    try { baseCheck(cat); } catch (e) { baseOk = false; baseError = e.message; }
    return {
      base: cat.base, baseOk, baseError, freeBytes: (() => { try { return freeBytes(home); } catch { return null; } })(),
      job: job ? { id: job.id, pid: job.pid, action: job.action, running: true, done: job.done ?? 0, total: job.total ?? 0 } : lastJob,
      downloadBase: (() => { try { return packUrl(cat, { id: 'x', file: 'x.dshx' }).slice(0, -6); } catch { return null; } })(),
      packs: cat.packs.map(p => ({ id: p.id, name: p.name, summary: p.summary, category: p.category, version: p.version,
        url: (() => { try { return packUrl(cat, p); } catch { return null; } })(), bytes: p.bytes, installedBytes: p.installedBytes, requires: p.requires, agpl: p.agpl, licenses: p.licenses,
        available: existsSync(join(packsDir, p.file)), active: !!state.active[p.id], activeAt: state.active[p.id]?.at ?? null })),
    };
  }

  function start(action, pid, opts = {}) {
    if (job) throw new Error('EXT_BUSY');
    let deps = [];
    if (action === 'activate' || action === 'install') {
      if (!ID.test(pid)) throw new Error('EXT_ID');
      deps = missingDeps(catalog(), readState().active, pid);
      // 缺依赖时同步拒绝（页面立刻能在卡片上提示），除非用户确认了“连同依赖一起装”。
      if (deps.length && opts.withDeps !== true) throw new Error('EXT_REQUIRES:' + deps.join(','));
    }
    const id = randomBytes(6).toString('hex');
    log.length = 0;
    job = { id, pid, action };
    const progress = (done, total) => { if (job && job.id === id) { job.done = done; job.total = total; } };
    const ensure = async (dep) => {
      try {
        const entry = catalog().packs.find(p => p.id === dep);
        if (!existsSync(join(packsDir, entry.file))) { say(`先下载依赖 ${dep}`); await download(dep, progress); }
        say(`先启用依赖 ${dep}`);
        await activate(dep);
      } catch (e) { e.dep = dep; throw e; }
    };
    const withDeps = async (main) => { for (const dep of deps) await ensure(dep); return main(); };
    const work = action === 'activate' ? withDeps(() => activate(pid))
      : action === 'remove' ? remove(pid)
      : action === 'download' ? download(pid, progress)
      : action === 'install' ? withDeps(() => download(pid, progress).then(() => activate(pid)))
      : Promise.reject(new Error('EXT_ACTION'));
    work.then(() => { saveLastJob({ id, pid, action, running: false, ok: true }); },
      (e) => { saveLastJob({ id, pid, action, running: false, ok: false, error: e.message, dep: e.dep ?? null, at: Date.now() }); })
      .finally(() => { job = null; });
    return id;
  }

  function cleanupStaging() {
    try { for (const d of readdirSync(join(home, 'staging'))) rmSync(join(home, 'staging', d), { recursive: true, force: true }); } catch {}
  }

  return { list, activate, remove, download, start, importStream, cleanupStaging, log: () => log.slice(), busy: () => !!job };
}
