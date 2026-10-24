// 扩展包解包器的安全性单测：node tools/test-extensions.mjs（夹具由 python3 生成）。
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractDshx, verifySums, safeEntryName } from '../app/src/main/assets/app-integration/ext/dshx.js';
import { registerExtensionRoutes } from '../app/src/main/assets/app-integration/ext/routes.js';
import { createServer } from 'node:http';

const work = mkdtempSync(join(tmpdir(), 'dshx-test-'));
const PY = String.raw`
import gzip, hashlib, io, json, sys, tarfile
spec = json.loads(sys.argv[2])
raw = io.BytesIO()
with tarfile.open(fileobj=raw, mode='w', format=tarfile.PAX_FORMAT) as t:
    sums = ''
    for e in spec['entries']:
        if e.get('sum', True) and e['type'] == 'file':
            sums += hashlib.sha256(e.get('data', '').encode()).hexdigest() + '  ' + e['name'] + '\n'
    if spec.get('badsum'):
        sums = sums.replace(sums[:8], '00000000', 1)
    entries = [{'name': 'SHA256SUMS', 'type': 'file', 'data': sums}] + spec['entries']
    for e in entries:
        info = tarfile.TarInfo(e['name'])
        if e['type'] == 'file':
            body = e.get('data', '').encode(); info.size = len(body); t.addfile(info, io.BytesIO(body))
        elif e['type'] == 'dir':
            info.type = tarfile.DIRTYPE; t.addfile(info)
        elif e['type'] == 'sym':
            info.type = tarfile.SYMTYPE; info.linkname = e['target']; t.addfile(info)
        elif e['type'] == 'hard':
            info.type = tarfile.LNKTYPE; info.linkname = e['target']; t.addfile(info)
        elif e['type'] == 'fifo':
            info.type = tarfile.FIFOTYPE; t.addfile(info)
with open(sys.argv[1], 'wb') as raw_f, gzip.GzipFile(fileobj=raw_f, mode='wb', mtime=0) as f:
    f.write(raw.getvalue() if not spec.get('truncate') else raw.getvalue()[:700])
`;
let n = 0;
function pack(spec) {
  const file = join(work, `p${n++}.dshx`);
  execFileSync("python3", ["-c", PY, file, JSON.stringify(spec)], { stdio: ["ignore", "ignore", "inherit"] });
  return file;
}
async function expectReject(spec, pattern, label) {
  const dest = join(work, `d${n++}`);
  await assert.rejects(async () => {
    const { files } = await extractDshx(pack(spec), dest, 'demo');
    verifySums(readFileSync(join(dest, 'SHA256SUMS'), 'utf8'), files);
  }, pattern, label);
}
const ok = [{ name: 'dshx.json', type: 'file', data: '{}' }, { name: 'tree/opt/dsha-ext/demo/bin', type: 'dir' },
  { name: 'tree/opt/dsha-ext/demo/bin/x', type: 'file', data: '#!/bin/sh\necho hi\n' },
  { name: 'repo/a_1_arm64.deb', type: 'file', data: 'x'.repeat(5000) }, { name: 'licenses/SOURCES.json', type: 'file', data: '[]' },
  { name: 'tree/opt/dsha-ext/demo/' + 'long/'.repeat(30) + 'file', type: 'file', data: 'pax-long-name' }];
try {
  {
    const dest = join(work, 'good');
    const { files } = await extractDshx(pack({ entries: ok }), dest, 'demo');
    verifySums(readFileSync(join(dest, 'SHA256SUMS'), 'utf8'), files);
    assert.equal(readFileSync(join(dest, 'repo/a_1_arm64.deb'), 'utf8').length, 5000);
    assert.ok(existsSync(join(dest, 'tree/opt/dsha-ext/demo/' + 'long/'.repeat(30) + 'file')));
    console.log('ok   valid pack extracts and verifies');
  }
  await expectReject({ entries: [...ok, { name: 'tree/opt/dsha-ext/demo/l', type: 'sym', target: '/etc/passwd' }] }, /DSHX_ENTRY_TYPE:2/, 'symlink');
  await expectReject({ entries: [...ok, { name: 'tree/opt/dsha-ext/demo/h', type: 'hard', target: 'dshx.json' }] }, /DSHX_ENTRY_TYPE:1/, 'hardlink');
  await expectReject({ entries: [...ok, { name: 'tree/opt/dsha-ext/demo/f', type: 'fifo' }] }, /DSHX_ENTRY_TYPE:6/, 'fifo');
  await expectReject({ entries: [...ok, { name: 'tree/opt/dsha-ext/demo/../../../../etc/x', type: 'file', data: 'x' }] }, /DSHX_PATH/, 'dotdot');
  await expectReject({ entries: [...ok, { name: '/etc/x', type: 'file', data: 'x' }] }, /DSHX_PATH/, 'absolute');
  await expectReject({ entries: [...ok, { name: 'tree/opt/dsha-ext/other/x', type: 'file', data: 'x' }] }, /DSHX_PATH_SCOPE/, 'other pack prefix');
  await expectReject({ entries: [...ok, { name: 'tree/etc/passwd', type: 'file', data: 'x' }] }, /DSHX_PATH_SCOPE/, 'outside tree');
  await expectReject({ entries: [...ok, { name: 'dshx.json', type: 'file', data: 'dup' }] }, /DSHX_DUPLICATE/, 'duplicate');
  await expectReject({ entries: ok, badsum: true }, /DSHX_SUM_MISMATCH/, 'bad sum');
  await expectReject({ entries: [...ok, { name: 'licenses/extra', type: 'file', data: 'x', sum: false }] }, /DSHX_UNLISTED/, 'unlisted');
  await expectReject({ entries: ok, truncate: true }, /DSHX_TRUNCATED|unexpected end/, 'truncated');
  assert.throws(() => safeEntryName('repo/sub/x.deb', 'demo'), /DSHX_PATH_SCOPE/);
  assert.equal(safeEntryName('tree/opt/dsha-ext/demo/a b!', 'demo'), 'tree/opt/dsha-ext/demo/a b!');
  console.log('ok   rejects symlink/hardlink/fifo/../absolute/scope/duplicate/bad-sum/unlisted/truncated');
  // 路由：先过官方 authorizeIndex；写操作要同源 Origin + x-dsha-ext + JSON。
  {
    const calls = [];
    let handler;
    const fakeManager = { cleanupStaging() {}, list: () => ({ packs: [] }), log: () => [], busy: () => false,
      start: (action, id) => { calls.push([action, id]); return 'job1'; }, importStream: async () => {} };
    const scoped = {
      webServer: { register: (route) => { assert.equal(route.kind, 'prefix'); assert.equal(route.path, '/__dsha/extensions'); handler = route.handler; return () => {}; } },
      connection: { authorizeIndex: (req, res) => { if (req.headers.cookie === 'ok') return true; res.writeHead(401); res.end(); return false; } },
    };
    registerExtensionRoutes(scoped, { manager: fakeManager });
    const server = createServer((req, res) => handler(req, res));
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const host = base.slice(7);
    const go = (path, opt = {}) => fetch(base + path, opt).then(r => r.status);
    try {
      assert.equal(await go('/__dsha/extensions'), 401, 'page needs cookie');
      assert.equal(await go('/__dsha/extensions/api/state', { headers: { host } }), 401, 'Host header alone is not auth');
      assert.equal(await go('/__dsha/extensions', { headers: { cookie: 'ok' } }), 200);
      assert.equal(await go('/__dsha/extensions/api/state', { headers: { cookie: 'ok' } }), 200);
      const body = JSON.stringify({ id: 'dev-base' });
      assert.equal(await go('/__dsha/extensions/api/activate', { method: 'POST', body, headers: { cookie: 'ok', 'content-type': 'application/json', origin: 'http://evil.example', 'x-dsha-ext': '1' } }), 403, 'cross origin');
      assert.equal(await go('/__dsha/extensions/api/activate', { method: 'POST', body, headers: { cookie: 'ok', 'content-type': 'application/json', origin: base } }), 403, 'missing custom header');
      assert.equal(await go('/__dsha/extensions/api/activate', { method: 'POST', body, headers: { cookie: 'ok', 'content-type': 'text/plain', origin: base, 'x-dsha-ext': '1' } }), 415, 'simple content type');
      assert.equal(calls.length, 0);
      assert.equal(await go('/__dsha/extensions/api/activate', { method: 'POST', body, headers: { cookie: 'ok', 'content-type': 'application/json', origin: base, 'x-dsha-ext': '1' } }), 202);
      assert.deepEqual(calls, [['activate', 'dev-base']]);
      assert.equal(await go('/__dsha/extensions/api/remove', { method: 'POST', body, headers: { 'content-type': 'application/json', origin: base, 'x-dsha-ext': '1' } }), 401, 'POST without cookie');
      console.log('ok   routes: authorizeIndex first, Host-only rejected, CSRF guards (Origin/x-dsha-ext/content-type)');
    } finally { server.close(); }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

// 一键下载：固定 Release 地址、断点续传、重试、sha256 拒绝、空间预检；路由保护；页面引导与错误提示。
{
  const { createHash } = await import('node:crypto');
  const fs = await import('node:fs');
  const { createExtensionManager, packUrl, RELEASE_PREFIX } = await import('../app/src/main/assets/app-integration/ext/manager.js');
  const dir = mkdtempSync(join(tmpdir(), 'dshx-dl-'));
  try {
    const body = Buffer.alloc(300000, 7); for (let i = 0; i < body.length; i++) body[i] = (i * 31) & 255;
    const sha = createHash('sha256').update(body).digest('hex');
    const base = RELEASE_PREFIX + 'dsha-AllitorFk.-dsh0.2.1-rc.2';
    const catalogPath = join(dir, 'cat.json');
    const writeCat = (extra = {}) => fs.writeFileSync(catalogPath, JSON.stringify({ base: {}, download: { base }, packs: [
      { id: 'demo', file: 'demo.dshx', sha256: sha, bytes: body.length, installedBytes: 1, requires: [], ...extra }] }));
    writeCat();
    assert.equal(packUrl({ download: { base } }, { id: 'demo', file: 'demo.dshx' }), base + '/demo.dshx');
    for (const bad of ['https://evil.example/releases/download/t', 'https://github.com/mopth/DSHA-AllitorFk./releases/download/../x',
      'http://github.com/mopth/DSHA-AllitorFk./releases/download/t', RELEASE_PREFIX + 't/sub', undefined])
      assert.throws(() => packUrl({ download: { base: bad } }, { id: 'demo', file: 'demo.dshx' }), /EXT_DOWNLOAD_BASE/, String(bad));
    assert.throws(() => packUrl({ download: { base } }, { id: 'demo', file: '../demo.dshx' }), /EXT_ID/);
    // 真实目录里每个包都能算出固定地址。
    const real = JSON.parse(readFileSync(new URL('../app/src/main/assets/app-integration/ext-catalog.json', import.meta.url), 'utf8'));
    assert.equal(real.packs.length, 16);
    for (const p of real.packs) assert.equal(packUrl(real, p), real.download.base + '/' + p.id + '.dshx');

    const stream = (buf, chunk = 65536) => (async function* () { for (let i = 0; i < buf.length; i += chunk) yield buf.subarray(i, i + chunk); })();
    const ok200 = (buf, extra = {}) => ({ status: 200, headers: { 'content-length': String(buf.length), ...extra }, body: stream(buf) });
    const ok206 = (from, extra) => ({ status: 206, headers: { 'content-range': `bytes ${from}-${body.length - 1}/${body.length}`, 'content-length': String(body.length - from), ...extra }, body: stream(body.subarray(from)) });
    let calls = [];
    const mk = (fetchImpl, more = {}) => createExtensionManager({ root: dir, stateDir: join(dir, 'state'), catalogPath, fetch: fetchImpl, sleep: async () => {}, freeBytes: () => 1e12, ...more });
    const packs = join(dir, 'state/packs');
    const PART = join(packs, `.demo.${sha.slice(0, 8)}.download`);
    const reset = () => { fs.rmSync(join(dir, 'state'), { recursive: true, force: true }); calls = []; writeCat(); };
    const digestOf = (f) => createHash('sha256').update(fs.readFileSync(f)).digest('hex');

    // 1) 正常下载 + 进度 + manual 重定向参数
    reset();
    let progress = [];
    let m = mk(async (url, opt) => { calls.push([url, opt.headers.range, opt.redirect]); return ok200(body); });
    assert.equal(await m.download('demo', (d, t) => progress.push([d, t])), 'downloaded');
    assert.deepEqual(calls, [[base + '/demo.dshx', undefined, 'manual']]);
    assert.equal(digestOf(join(packs, 'demo.dshx')), sha);
    assert.deepEqual(progress.at(-1), [body.length, body.length]);
    assert.equal(await m.download('demo'), 'present');

    // 2) 合法重定向链（github.com → release-assets）可跟随；到其它主机 / http / userinfo / 端口 / 超过 3 跳一律拒绝
    reset();
    const asset = 'https://release-assets.githubusercontent.com/x/demo?sig=1';
    m = mk(async (url) => { calls.push(url); return url.startsWith(base) ? { status: 302, headers: { location: asset }, body: null } : ok200(body); });
    assert.equal(await m.download('demo'), 'downloaded');
    assert.deepEqual(calls, [base + '/demo.dshx', asset]);
    for (const loc of ['https://evil.example/demo.dshx', 'http://objects.githubusercontent.com/x', 'https://u:p@objects.githubusercontent.com/x',
      'https://objects.githubusercontent.com:8443/x', 'https://github.com.evil.example/x']) {
      reset();
      let fetched = [];
      m = mk(async (url) => { fetched.push(url); return url.startsWith(base) ? { status: 302, headers: { location: loc }, body: null } : ok200(body); });
      await assert.rejects(m.download('demo'), /EXT_DOWNLOAD_REDIRECT/, loc);
      assert.equal(fetched.length, 1, 'never contacted ' + loc);
      assert.ok(!fs.existsSync(join(packs, 'demo.dshx')));
    }
    reset();
    m = mk(async () => ({ status: 302, headers: { location: base + '/demo.dshx' }, body: null }));
    await assert.rejects(m.download('demo'), /EXT_DOWNLOAD_REDIRECT:TOO_MANY/);

    // 3) sha256 不符：拒绝并删除
    reset();
    const evil = Buffer.from(body); evil[5] ^= 1;
    m = mk(async () => ok200(evil));
    await assert.rejects(m.download('demo'), /EXT_PACK_DIGEST/);
    assert.ok(!fs.existsSync(join(packs, 'demo.dshx')) && !fs.existsSync(PART));

    // 4) 超长正文与超大 Content-Length：EXT_PACK_SIZE
    reset();
    m = mk(async () => ({ status: 200, headers: {}, body: stream(Buffer.concat([body, Buffer.alloc(10)])) }));
    await assert.rejects(m.download('demo'), /EXT_PACK_SIZE/);
    reset();
    fs.mkdirSync(packs, { recursive: true }); fs.writeFileSync(PART, body.subarray(0, 1000));
    m = mk(async () => ({ status: 206, headers: { 'content-range': `bytes 1000-${body.length - 1}/${body.length}`, 'content-length': String(body.length) }, body: stream(body.subarray(1000)) }));
    await assert.rejects(m.download('demo'), /EXT_PACK_SIZE/, 'content-length larger than remaining');

    // 5) 断网：重试 3 次后 EXT_NETWORK，已下部分保留；再次调用用 Range 续传，Content-Range 吻合才接上
    reset();
    let n = 0;
    m = mk(async (url, opt) => { n++;
      if (!opt.headers.range) return { status: 200, headers: {}, body: (async function* () { yield body.subarray(0, 100000); throw new Error('ECONNRESET'); })() };
      throw new Error('ENOTFOUND'); });
    await assert.rejects(m.download('demo'), /EXT_NETWORK/);
    assert.equal(n, 3);
    assert.equal(fs.statSync(PART).size, 100000);
    m = mk(async (url, opt) => { assert.equal(opt.headers.range, 'bytes=100000-'); return ok206(100000); });
    assert.equal(await m.download('demo'), 'downloaded');
    assert.equal(digestOf(join(packs, 'demo.dshx')), sha);

    // 6) 206 但 Content-Range 不吻合（起点/总长不对或缺失）：丢弃已下部分，从 0 重下
    for (const bad of [`bytes 0-${body.length - 1}/${body.length}`, `bytes 1000-${body.length - 1}/${body.length + 5}`, undefined]) {
      reset();
      fs.mkdirSync(packs, { recursive: true }); fs.writeFileSync(PART, Buffer.alloc(1000, 9));
      calls = [];
      m = mk(async (url, opt) => { calls.push(opt.headers.range);
        if (opt.headers.range) return { status: 206, headers: bad ? { 'content-range': bad } : {}, body: stream(body.subarray(1000)) };
        return ok200(body); });
      assert.equal(await m.download('demo'), 'downloaded', String(bad));
      assert.deepEqual(calls, ['bytes=1000-', undefined]);
      assert.equal(digestOf(join(packs, 'demo.dshx')), sha);
    }

    // 7) 服务器不支持 Range（回 200）：从头重下
    reset();
    fs.mkdirSync(packs, { recursive: true }); fs.writeFileSync(PART, Buffer.alloc(5000, 1));
    m = mk(async () => ok200(body));
    assert.equal(await m.download('demo'), 'downloaded');

    // 8) 连接挂起：空闲超时中止并重试，最终 EXT_NETWORK:TIMEOUT_IDLE，任务锁随之释放；总时长上限
    reset();
    n = 0;
    const hang = (signal) => (async function* () { yield body.subarray(0, 10); await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))); })();
    m = mk(async (url, opt) => { n++; return { status: 200, headers: {}, body: hang(opt.signal) }; }, { idleMs: 40 });
    const t0 = Date.now();
    await assert.rejects(m.download('demo'), /EXT_NETWORK:TIMEOUT_IDLE/);
    assert.equal(n, 3); assert.ok(Date.now() - t0 < 5000);
    reset();
    m = mk(async (url, opt) => new Promise((_, reject) => opt.signal.addEventListener('abort', () => reject(new Error('aborted')))), { idleMs: 10_000, totalMs: 60 });
    await assert.rejects(m.download('demo'), /EXT_NETWORK:TIMEOUT_TOTAL/);
    reset();
    m = mk(async (url, opt) => ({ status: 200, headers: {}, body: hang(opt.signal) }), { idleMs: 40 });
    m.start('download', 'demo');
    assert.equal(m.busy(), true);
    for (let k = 0; k < 100 && m.busy(); k++) await new Promise(r => setTimeout(r, 20));
    assert.equal(m.busy(), false, 'lock released after hung download');
    assert.match(m.list().job.error, /EXT_NETWORK:TIMEOUT_IDLE/);

    // 9) HTTP 404 → EXT_NETWORK:HTTP_404；空间预检不发请求；目录地址被改到别处拒绝
    reset();
    m = mk(async () => ({ status: 404, headers: {}, body: null }));
    await assert.rejects(m.download('demo'), /EXT_NETWORK:HTTP_404/);
    reset();
    let fetched = false;
    m = mk(async () => { fetched = true; return ok200(body); }, { freeBytes: () => 1000 });
    await assert.rejects(m.download('demo'), /EXT_NO_SPACE/);
    assert.equal(fetched, false);

    // 10) 不跟随符号链接：packs 目录或 .download 是链接时拒绝写入
    reset();
    const elsewhere = join(dir, 'elsewhere'); fs.mkdirSync(elsewhere, { recursive: true });
    fs.mkdirSync(join(dir, 'state'), { recursive: true }); fs.symlinkSync(elsewhere, packs);
    m = mk(async () => ok200(body));
    await assert.rejects(m.download('demo'), /EXT_PACKS_DIR/);
    reset();
    fs.mkdirSync(packs, { recursive: true }); fs.symlinkSync(join(elsewhere, 'target'), PART);
    await assert.rejects(m.download('demo'), /EXT_PACKS_DIR/);
    assert.ok(!fs.existsSync(join(elsewhere, 'target')));

    reset();
    fs.writeFileSync(catalogPath, JSON.stringify({ base: {}, download: { base: 'https://evil.example/x' }, packs: [{ id: 'demo', file: 'demo.dshx', sha256: sha, bytes: body.length, installedBytes: 1, requires: [] }] }));
    m = mk(async () => { throw new Error('should not fetch'); });
    await assert.rejects(m.download('demo'), /EXT_DOWNLOAD_BASE/);
    await assert.rejects(m.download('nope'), /EXT_UNKNOWN/);
    console.log('ok   download: pinned URL, manual redirects (3 hops, host allow-list), sha256 reject, size caps, retry+resume with exact Content-Range, restart, idle/total timeouts release the lock, HTTP error, space precheck, no symlink follow, base pinning');
  } finally { rmSync(dir, { recursive: true, force: true }); }

  // 路由：download/install 与 activate 同等保护，且只把 id 交给 manager（请求里的 URL 被忽略）。
  {
    const calls = []; let handler;
    const fakeManager = { cleanupStaging() {}, list: () => ({ packs: [] }), log: () => [], busy: () => false,
      start: (action, id) => { calls.push([action, id]); return 'j'; }, importStream: async () => {} };
    registerExtensionRoutes({ webServer: { register: (r) => { handler = r.handler; return () => {}; } },
      connection: { authorizeIndex: (req, res) => { if (req.headers.cookie === 'ok') return true; res.writeHead(401); res.end(); return false; } } }, { manager: fakeManager });
    const server = createServer((req, res) => handler(req, res));
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const go = (path, headers, body = JSON.stringify({ id: 'dev-base', url: 'https://evil.example/x.dshx' })) => fetch(base + path, { method: 'POST', body, headers }).then(r => r.status);
    const good = { cookie: 'ok', 'content-type': 'application/json', origin: base, 'x-dsha-ext': '1' };
    try {
      for (const route of ['download', 'install']) {
        const p = '/__dsha/extensions/api/' + route;
        assert.equal(await go(p, { ...good, cookie: '' }), 401, route + ' no cookie');
        assert.equal(await go(p, { ...good, origin: 'http://evil.example' }), 403, route + ' cross origin');
        assert.equal(await go(p, { ...good, 'x-dsha-ext': '' }), 403, route + ' no custom header');
        assert.equal(await go(p, { ...good, 'content-type': 'text/plain' }), 415, route + ' simple content type');
        assert.equal(calls.length, 0);
        assert.equal(await go(p, good), 202);
        assert.deepEqual(calls.pop(), [route, 'dev-base']);
      }
      assert.equal(await fetch(base + '/__dsha/extensions/api/download', { headers: { cookie: 'ok' } }).then(r => r.status), 405, 'GET is not a download trigger');
      console.log('ok   routes: download/install behind authorizeIndex + Origin + x-dsha-ext + JSON; only id is used');
    } finally { server.close(); }
  }

  // 页面：中英文引导、文件大小、自动校验说明、三类白话错误、两种安装方式。
  {
    const page = readFileSync(new URL('../app/src/main/assets/app-integration/ext/extensions.html', import.meta.url), 'utf8');
    for (const text of ['下载并安装', 'Download & install', '在浏览器中下载', 'Download in browser', '从文件导入', 'Import from file',
      '「下载」文件夹', 'Downloads folder', '自动核对 sha256', 'checked automatically', "T('文件 ','File ')",
      'EXT_NETWORK:', 'EXT_PACK_DIGEST:', 'EXT_NO_SPACE:', '网络连接失败', 'Network error', '校验没通过', 'failed its check', '存储空间不够', 'Not enough storage',
      "post(action,{id:p.id})", 'a.href=p.url', '重试下载并安装', '<progress'.slice(1)])
      assert.ok(page.includes(text), 'page missing: ' + text);
    assert.ok(!/Full 版/.test(page), 'no Full wording');
    console.log('ok   page: zh/en how-to (A one tap, B browser + import), sizes, auto hash check, plain errors');
  }
}
