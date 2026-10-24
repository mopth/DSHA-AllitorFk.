// AllitorFk B2/c/d/e/A1 core: takeover, preview, annotations, browser SSRF guard, write gate, agent channel, MCP core.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync, statSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
const A = '../app/src/main/assets/app-integration/allitor/';
const { createTakeover } = await import(A + 'takeover.js');
const { createPreviews } = await import(A + 'preview.js');
const { createAnnotations, annotationText } = await import(A + 'annotations.js');
const { createBrowser, checkUrl, privateAddress, parsePage } = await import(A + 'browser.js');
const { writeGate, tokenEquals } = await import(A + 'guard.js');
const { createAllitor, registerAllitorRoutes, scanPlugins } = await import(A + 'routes.js');
const { startAgentChannel } = await import(A + 'agent.js');
const { createRegistry, createProtocol } = await import('./allitor-mcp/src/mcp-core.mjs');
const { buildRegistry, call } = await import('./allitor-mcp/src/server.mjs');

// takeover: default none, request -> approve -> revoke, expiry, scope isolation
let t0 = 0; const tk = createTakeover({ now: () => t0 });
assert.equal(tk.granted('browser'), false);
const r = tk.request({ scope: 'browser', reason: 'read docs', minutes: 999 });
assert.equal(r.minutes, 120); assert.equal(tk.granted('browser'), false);
assert.throws(() => tk.request({ scope: 'shell', reason: 'x' }), /TAKEOVER_SCOPE/);
tk.decide(r.id, true); assert.equal(tk.granted('browser'), true); assert.equal(tk.granted('preview'), false);
assert.throws(() => tk.decide(r.id, true), /NOT_PENDING/);
tk.revoke(r.id); assert.equal(tk.granted('browser'), false);
const r2 = tk.request({ scope: 'preview', reason: 'x', minutes: 1 }); tk.decide(r2.id, true); t0 += 61_000; assert.equal(tk.granted('preview'), false);
const r3 = tk.request({ scope: 'preview', reason: 'x' }); t0 += 11 * 60_000; assert.equal(tk.status(r3.id).state, 'expired');

// preview: root restriction, private dirs, traversal, symlink refusal
const root = realpathSync(mkdtempSync(join(tmpdir(), 'allitor-')));
mkdirSync(join(root, 'site')); writeFileSync(join(root, 'site/index.html'), '<h1>hi</h1>'); writeFileSync(join(root, 'secret.txt'), 's');
symlinkSync(join(root, 'secret.txt'), join(root, 'site/link.txt'));
mkdirSync(join(root, '.dsh'));
const pv = createPreviews({ allowedRoots: [root] });
assert.throws(() => pv.start('/etc'), /OUTSIDE/);
assert.throws(() => pv.start(join(root, '.dsh')), /PRIVATE/);
const p = pv.start(join(root, 'site')); assert.equal(p.id.length, 22);
assert.equal(pv.read(p.id, '').status, 200); assert.equal(pv.read(p.id, '').body.toString(), '<h1>hi</h1>');
assert.equal(pv.read(p.id, '../secret.txt').status, 400); assert.equal(pv.read(p.id, '%2e%2e/secret.txt').status, 400);
assert.equal(pv.read(p.id, 'link.txt').status, 403); assert.equal(pv.read('nope', '').status, 404);

// annotations: per-consumer single delivery
const an = createAnnotations();
an.add({ previewId: p.id, path: '/', rect: { x: 1, y: 2, w: 30, h: 40 }, viewport: { w: 360, h: 640 }, note: '按钮太小' });
assert.equal(an.take('client').length, 1); assert.equal(an.take('client').length, 0); assert.equal(an.take('agent').length, 0, 'no duplicate delivery');
assert.match(annotationText(an.all()[0]), /按钮太小/);

// browser: SSRF guard + authorization
for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.1', '172.16.0.1', '169.254.169.254', '::1', 'fd00::1', '0.0.0.0', '100.64.0.1', '::ffff:127.0.0.1']) assert.equal(privateAddress(ip), true, ip);
assert.equal(privateAddress('93.184.216.34'), false);
assert.throws(() => checkUrl('file:///etc/passwd')); assert.throws(() => checkUrl('http://127.0.0.1/')); assert.throws(() => checkUrl('http://u:p@example.com/'));
let allow = false;
const pages = { 'https://example.com/': { status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from('<title>Ex</title><p>Hello world</p><a href="/b">B</a><form action="/s"><input name="q" value=""></form>') },
  'https://example.com/b': { status: 302, headers: { location: 'http://127.0.0.1/' }, body: Buffer.alloc(0) } };
const br = createBrowser({ allowed: () => allow, fetchPage: async u => pages[u.href] ?? { status: 404, headers: {}, body: Buffer.alloc(0) } });
await assert.rejects(br.open('https://example.com/'), /NOT_AUTHORIZED/);
allow = true;
const o = await br.open('https://example.com/'); assert.equal(o.title, 'Ex'); assert.equal(o.links, 1);
assert.equal(br.find({ text: 'hello' }).hits.length, 1);
await assert.rejects(br.follow({ index: 0 }), /./); // redirect into loopback refused
assert.equal(br.forms()[0].method, 'get');
assert.ok(parsePage('<script>alert(1)</script><p>x</p>', 'https://a.example/').text.includes('x'));

// write gate: Origin model on top of authorizeIndex
const req = (h, m = 'POST') => ({ method: m, headers: { host: '127.0.0.1:3180', ...h } });
assert.equal(writeGate(req({ origin: 'http://127.0.0.1:3180', 'x-dsha-allitor': '1', 'content-type': 'application/json' })), null);
assert.equal(writeGate(req({ origin: 'http://evil.example', 'x-dsha-allitor': '1', 'content-type': 'application/json' }))[0], 403);
assert.equal(writeGate(req({ 'x-dsha-allitor': '1', 'content-type': 'application/json' }))[0], 403);
assert.equal(writeGate(req({ origin: 'http://127.0.0.1:3180', 'content-type': 'application/json' }))[0], 403);
assert.equal(writeGate(req({}, 'GET'))[0], 405);
assert.equal(tokenEquals('a', 'a'), true); assert.equal(tokenEquals('a', 'b'), false); assert.equal(tokenEquals(undefined, 'a'), false);

// routes over a real HTTP server with a fake authorizeIndex (cookie "ok=1")
const core = createAllitor({ previewOptions: { allowedRoots: [root] }, fetchPage: async () => ({ status: 200, headers: {}, body: Buffer.from('x') }) });
let handler; const agentDir = join(root, 'agent');
const off = registerAllitorRoutes({ webServer: { register: d => { handler = d.handler; return () => {}; } },
  connection: { authorizeIndex: (q, s) => { if (q.headers.cookie === 'ok=1') return true; s.writeHead(401); s.end(); return false; } } },
  { core, agentDir, scanPlugins: () => ({ dshVersion: '0.2.1-rc.3', plugins: [] }) });
const srv = http.createServer((q, s) => handler(q, s)); await new Promise(f => srv.listen(0, '127.0.0.1', f));
const port = srv.address().port, base = `http://127.0.0.1:${port}/__dsha/allitor`;
const H = { cookie: 'ok=1', origin: `http://127.0.0.1:${port}`, 'x-dsha-allitor': '1', 'content-type': 'application/json' };
assert.equal((await fetch(base + '/api/state')).status, 401);
assert.equal((await fetch(base + '/api/state', { headers: { cookie: 'ok=1' } })).status, 200);
assert.equal((await fetch(base + '/api/takeover/revoke', { method: 'POST', headers: { ...H, origin: 'http://evil' }, body: '{"all":true}' })).status, 403);
assert.equal((await fetch(base + '/', { headers: { cookie: 'ok=1' } })).headers.get('content-security-policy').includes("default-src 'none'"), true);

// agent channel: token required, no approve op, takeover flow end to end
await new Promise(f => setTimeout(f, 50));
assert.equal(statSync(join(agentDir, 'agent.token')).mode & 0o777, 0o600);
assert.equal(statSync(agentDir).mode & 0o777, 0o700);
const req1 = await call('takeover.request', { scope: 'preview', reason: '预览', minutes: 5 }, agentDir);
await assert.rejects(call('takeover.decide', { id: req1.id, approve: true }, agentDir), /AGENT_OP/);
await assert.rejects(call('preview.start', { dir: join(root, 'site') }, agentDir), /PREVIEW_NOT_AUTHORIZED/);
assert.equal((await fetch(base + '/api/takeover/decide', { method: 'POST', headers: H, body: JSON.stringify({ id: req1.id, approve: true }) })).status, 200);
const started = await call('preview.start', { dir: join(root, 'site') }, agentDir);
const prev = await fetch(`http://127.0.0.1:${port}${started.raw}`); // capability URL, no cookie
assert.equal(prev.status, 200); assert.match(prev.headers.get('content-security-policy'), /^sandbox allow-scripts/);
assert.equal((await fetch(base + '/preview/AAAAAAAAAAAAAAAAAAAAAA/')).status, 404);
assert.equal((await fetch(base + '/api/annotations', { method: 'POST', headers: H, body: JSON.stringify({ previewId: started.id, path: '/', rect: { x: 0, y: 0, w: 10, h: 10 }, viewport: { w: 100, h: 100 }, note: 'n1' }) })).status, 200);
const taken = await (await fetch(base + '/api/annotations/take', { method: 'POST', headers: H, body: '{}' })).json();
assert.equal(taken.length, 1); assert.match(taken[0].text, /n1/);
assert.equal((await call('annotations.take', {}, agentDir)).length, 0, 'already delivered to composer');
await fetch(base + '/api/takeover/revoke', { method: 'POST', headers: H, body: '{"all":true}' });
await assert.rejects(call('preview.stop', { id: started.id }, agentDir), /PREVIEW_NOT_AUTHORIZED/);
await assert.rejects(call('browser.session_clear', { site: '*' }, agentDir), /BROWSER_FULL_NOT_AUTHORIZED/);
await assert.rejects(call('preview.start', { dir: join(root, 'site') }, agentDir), /NOT_AUTHORIZED/);
writeFileSync(join(root, 'badtok'), 'x');
// forged token is refused
const { default: net } = await import('node:net');
const forged = await new Promise(f => { const s = net.connect(join(agentDir, 'agent.sock'), () => s.write('{"token":"x","op":"takeover.list"}\n')); s.on('data', d => { f(JSON.parse(d)); s.end(); }); });
assert.equal(forged.error, 'AGENT_TOKEN');

// MCP core layering + allitor-mcp registry
const reg = createRegistry(); assert.throws(() => reg.add({ name: 'x_y', tier: 'root', run() {} }), /TOOL_TIER/);
const proto = createProtocol({ registry: buildRegistry(async (op, a) => ({ op, a })), info: { name: 't', version: '0' } });
assert.equal((await proto({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })).result.serverInfo.name, 't');
const tl = (await proto({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).result.tools;
assert.ok(tl.some(x => x.name === 'browser_open' && x.description.startsWith('[act]')));
assert.ok(!tl.some(x => /approve|decide|revoke/.test(x.name)));
const bad = await proto({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'browser_open', arguments: { url: 'x', extra: 1 } } });
assert.equal(bad.result.isError, true);
const good = await proto({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'browser_submit', arguments: { form: 0, values: '{"q":"a"}' } } });
assert.deepEqual(JSON.parse(good.result.content[0].text), { op: 'browser.submit', a: { index: 0, values: { q: 'a' } } });
assert.equal(await proto({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
assert.equal(scanPlugins(join(root, 'none'), '0.2.1-rc.3').plugins.length, 0);

off(); srv.close();
console.log('allitor core tests passed');
