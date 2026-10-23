// DSHA 离线扩展包管理：校验（目录 sha256 → 包内 SHA256SUMS）→ 绑定基底版本 → 空间预检 →
// 本地平铺源 + apt 精确版本安装 → 上游工具链移入 /opt/dsha-ext → 冒烟 → 原子写状态；任一步失败即回滚。
// 移除只清理本包新装且已无人依赖的包（apt 模拟结果必须是该集合的子集），基底升级过的库保留。
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statfsSync,
  writeFileSync, symlinkSync, readlinkSync, lstatSync, unlinkSync, cpSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { extractDshx, verifySums } from './dshx.js';

const MB = 1024 * 1024;
const ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

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
  let lastJob = null;

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
      const sameBase = ['rootfsVersion', 'toolsLockSha256', 'statusSha256'].every(k => manifest.base?.[k] === cat.base[k]);
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

  function list() {
    const cat = catalog();
    const state = readState();
    let baseOk = true, baseError = null;
    try { baseCheck(cat); } catch (e) { baseOk = false; baseError = e.message; }
    return {
      base: cat.base, baseOk, baseError, freeBytes: (() => { try { return freeBytes(home); } catch { return null; } })(),
      job: job ? { id: job.id, pid: job.pid, action: job.action, running: true } : lastJob,
      packs: cat.packs.map(p => ({ id: p.id, name: p.name, summary: p.summary, category: p.category, version: p.version,
        bytes: p.bytes, installedBytes: p.installedBytes, requires: p.requires, agpl: p.agpl, licenses: p.licenses,
        available: existsSync(join(packsDir, p.file)), active: !!state.active[p.id], activeAt: state.active[p.id]?.at ?? null })),
    };
  }

  function start(action, pid) {
    if (job) throw new Error('EXT_BUSY');
    const id = randomBytes(6).toString('hex');
    log.length = 0;
    job = { id, pid, action };
    const work = action === 'activate' ? activate(pid) : remove(pid);
    work.then(() => { lastJob = { id, pid, action, running: false, ok: true }; },
      (e) => { lastJob = { id, pid, action, running: false, ok: false, error: e.message }; })
      .finally(() => { job = null; });
    return id;
  }

  function cleanupStaging() {
    try { for (const d of readdirSync(join(home, 'staging'))) rmSync(join(home, 'staging', d), { recursive: true, force: true }); } catch {}
  }

  return { list, activate, remove, start, importStream, cleanupStaging, log: () => log.slice(), busy: () => !!job };
}
