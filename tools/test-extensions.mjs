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
