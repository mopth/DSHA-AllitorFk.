// Browser additions: browser_full gate, POST forms, per-site sessions, downloads, egress proxy SSRF refusal,
// and (when ALLITOR_TEST_CHROMIUM=1 and a Chromium exists) JS execution + screenshot through the proxy.
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, statSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import net from 'node:net';
const A = '../app/src/main/assets/app-integration/allitor/';
const { createBrowser } = await import(A + 'browser.js');
const { createSessions, siteOf } = await import(A + 'sessions.js');
const { startEgressProxy } = await import(A + 'egress-proxy.js');
const { createChromiumEngine, findChromium, chromiumArgs } = await import(A + 'cdp.js');
const { createTakeover, SCOPES } = await import(A + 'takeover.js');

assert.ok(SCOPES.browser_full && SCOPES.browser_full.maxMinutes <= 60);
assert.equal(siteOf('WWW.Example.com'), 'example.com');

// sessions: isolation, domain rules, expiry, clear
let now = 1000; const ss = createSessions({ now: () => now });
ss.store('https://a.example/login', ['sid=1; Path=/; HttpOnly; Secure', 'evil=1; Domain=b.example', 'short=1; Max-Age=1']);
assert.equal(ss.header('https://a.example/x'), 'sid=1; short=1');
assert.equal(ss.header('http://a.example/x'), 'short=1', 'secure cookie only over https');
assert.equal(ss.header('https://b.example/'), '', 'no cross-site leakage, foreign Domain rejected');
now += 5000; assert.equal(ss.header('https://a.example/'), 'sid=1');
assert.equal(ss.list().length, 1); assert.equal(ss.clear('a.example'), 1); assert.equal(ss.header('https://a.example/'), '');

// browser gate + POST + cookies + downloads
const tk = createTakeover(); const dl = mkdtempSync(join(tmpdir(), 'allitor-dl-'));
const seen = [];
const site = {
  'https://shop.example/': () => ({ status: 200, headers: { 'content-type': 'text/html' }, body: '<form method="post" action="/login"><input type="hidden" name="csrf" value="T0K"><input name="user"><input type="password" name="pw" value="leak"></form><a href="/f.zip">f</a>' }),
  'https://shop.example/login': (o) => ({ status: 302, headers: { location: '/home', 'set-cookie': ['sid=abc; Path=/'] }, body: '' }),
  'https://shop.example/home': () => ({ status: 200, headers: { 'content-type': 'text/html' }, body: '<title>Home</title><p>welcome</p>' }),
  'https://shop.example/f.zip': () => ({ status: 200, headers: { 'content-type': 'application/zip', 'content-disposition': 'attachment; filename="../../etc/x.zip"' }, body: 'PK' }),
  'https://other.example/': () => ({ status: 200, headers: { 'content-type': 'text/html' }, body: '<p>o</p>' }),
};
const fetchPage = async (u, o = {}) => { seen.push({ url: u.href, method: o.method ?? 'GET', body: o.body ?? null, cookie: o.headers?.cookie ?? '' });
  const r = site[u.href]?.(o) ?? { status: 404, headers: {}, body: '' }; return { ...r, body: Buffer.from(r.body), truncated: false }; };
const sessions = createSessions();
const br = createBrowser({ allowed: () => tk.granted('browser'), allowedFull: () => tk.granted('browser_full'), fetchPage, sessions, engine: null, downloadsDir: dl });
await assert.rejects(br.open('https://shop.example/'), /NOT_AUTHORIZED/);
const g = tk.request({ scope: 'browser', reason: 'r' }); tk.decide(g.id, true);
await br.open('https://shop.example/');
const forms = br.forms();
assert.equal(forms[0].fields.find(f => f.name === 'csrf'), undefined, 'hidden fields not echoed');
assert.equal(forms[0].fields.find(f => f.name === 'pw').value, '', 'password value never echoed');
await assert.rejects(br.submit({ index: 0, values: { user: 'u', pw: 'p' } }), /BROWSER_FULL_NOT_AUTHORIZED/);
await assert.rejects(br.download({ index: 0 }), /BROWSER_FULL_NOT_AUTHORIZED/);
await assert.rejects(br.evaluate({ expression: '1' }), /BROWSER_FULL_NOT_AUTHORIZED/);
await assert.rejects(br.screenshot(), /BROWSER_FULL_NOT_AUTHORIZED/);
const f = tk.request({ scope: 'browser_full', reason: 'login', minutes: 999 }); assert.equal(f.minutes, 60); tk.decide(f.id, true);
const home = await br.submit({ index: 0, values: { user: 'u', pw: 'p' } });
assert.equal(home.title, 'Home');
const post = seen.find(x => x.method === 'POST'); assert.equal(post.url, 'https://shop.example/login');
assert.equal(new URLSearchParams(post.body).get('csrf'), 'T0K'); assert.equal(new URLSearchParams(post.body).get('pw'), 'p');
assert.equal(seen.at(-1).method, 'GET', '302 after POST becomes GET'); assert.equal(seen.at(-1).cookie, 'sid=abc', 'session cookie sent on same site');
await br.open('https://other.example/'); assert.equal(seen.at(-1).cookie, '', 'not sent to another site');
await br.open('https://shop.example/');
const d = await br.download({ index: 0 });
assert.ok(d.path.startsWith(dl + '/') && !d.path.includes('..'), 'download confined to sandbox dir'); assert.equal(statSync(d.path).size, 2);
await assert.rejects(br.evaluate({ expression: '1' }), /NEEDS_CHROMIUM/);
await assert.rejects(br.open('http://127.0.0.1/', {}), /PRIVATE/);
await assert.rejects(br.open('https://shop.example/', { engine: 'chromium' }), /ENGINE_UNAVAILABLE/);
assert.equal(br.sessions().text[0].site, 'shop.example');
assert.equal((await br.clearSession({ site: '*' })).cleared, 1); assert.equal(br.sessions().text.length, 0);
tk.revokeAll(); await assert.rejects(br.open('https://shop.example/'), /NOT_AUTHORIZED/);

// egress proxy refuses loopback/private for both CONNECT and plain http
const local = http.createServer((q, s) => s.end('secret')); await new Promise(r => local.listen(0, '127.0.0.1', r));
const proxy = await startEgressProxy();
const connect = target => new Promise(r => { const s = net.connect(proxy.port, '127.0.0.1', () => s.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`)); s.once('data', d => { r(d.toString().split('\r\n')[0]); s.destroy(); }); });
assert.match(await connect(`127.0.0.1:${local.address().port}`), /403/);
assert.match(await connect('10.0.0.1:443'), /403/);
for (const t of ['[::ffff:127.0.0.1]:443', '[::ffff:7f00:1]:443', '[64:ff9b::a9fe:a9fe]:443', '[::127.0.0.1]:443', '[fe80::1]:443']) assert.match(await connect(t), /403/, t);
assert.match(await connect(`localhost:${local.address().port}`), /403/);
const plain = await new Promise(r => http.get({ host: '127.0.0.1', port: proxy.port, path: `http://127.0.0.1:${local.address().port}/` }, res => { r(res.statusCode); res.resume(); }));
assert.equal(plain, 403);
assert.ok(chromiumArgs({ profileDir: '/p', proxyPort: 1 }).includes('--proxy-bypass-list=<-loopback>'));

// optional real Chromium run
const exe = findChromium({ ALLITOR_CHROMIUM: process.env.ALLITOR_CHROMIUM });
if (process.env.ALLITOR_TEST_CHROMIUM === '1' && exe) {
  const prof = mkdtempSync(join(tmpdir(), 'allitor-prof-'));
  // This test box resolves public names to a 198.18/15 egress gateway, which the real guard (correctly) refuses;
  // a second proxy maps only example.com to it and still refuses everything else.
  const { address: gw } = await import('node:dns').then(d => d.promises.lookup('example.com'));
  const testProxy = await startEgressProxy({ resolve: async h => { if (h === 'example.com') return gw; throw new Error('BROWSER_PRIVATE_ADDRESS'); } });
  const eng = createChromiumEngine({ executable: exe, profilesDir: prof, downloadsDir: dl, proxyPort: testProxy.port });
  const snap = await eng.open('https://example.com/');
  assert.match(snap.title, /Example/);
  assert.equal(JSON.parse((await eng.evaluate('JSON.stringify(1+1)')).value), 2);
  const leak = await eng.evaluate(`fetch("http://127.0.0.1:${local.address().port}/").then(r => r.text()).catch(e => "blocked")`);
  assert.notEqual(leak.value, 'secret', 'page JS cannot reach loopback');
  const shot = join(dl, 'shot.png'); await eng.screenshot(shot); assert.ok(statSync(shot).size > 1000);
  assert.ok(readdirSync(prof).includes('example.com'), 'per-site profile');
  await eng.clearSite('example.com'); assert.ok(!existsSync(join(prof, 'example.com')));
  await eng.close(); testProxy.close(); console.log('chromium engine: JS, screenshot, loopback refusal, per-site profile ok');
}
proxy.close(); local.close();
console.log('browser full tests passed');
