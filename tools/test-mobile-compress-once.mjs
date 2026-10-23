// AllitorFk defensive fix for download "Failed to fetch" (root cause NOT confirmed):
// a response is compressed at most once and Content-Length always describes the bytes sent.
// Real loopback HTTP sockets; no Android/user data. Optional: DSHA_TYPESCRIPT=<path to typescript>
// also transpiles src/compress.ts and checks the same pure guards (src/lib alignment).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { gzipSync, gunzipSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as lib from '../app/src/main/assets/builtin-plugins/dsh-web-mobile/lib/compress.js';

const PLUGIN = 'app/src/main/assets/builtin-plugins/dsh-web-mobile';
const json = JSON.stringify({ items: Array.from({ length: 800 }, (_, i) => ({ i, name: 'file-' + i })) });

async function fixture(handler, run) {
  const dispose = lib.installResponseCompression();
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try { await run(server.address().port); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); dispose(); }
}
function get(port, headers = { 'Accept-Encoding': 'gzip, br' }) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => resolve({ res, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject); req.end();
  });
}
function assertLengthHonest({ res, body }) {
  if (res.headers['content-length'] !== undefined)
    assert.equal(Number(res.headers['content-length']), body.byteLength, 'Content-Length must equal bytes on the wire');
  else assert.equal(res.headers['transfer-encoding'], 'chunked');
}

test('another layer that already gzipped (header set before end) is passed through once', async () => {
  const gz = gzipSync(Buffer.from(json));
  await fixture((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' }); // deferred by the hook
    res.setHeader('Content-Encoding', 'gzip');                   // upstream layer decides later
    res.setHeader('Content-Length', gz.byteLength);
    res.end(gz);
  }, async port => {
    const result = await get(port);
    assert.equal(result.res.headers['content-encoding'], 'gzip');
    assertLengthHonest(result);
    assert.equal(gunzipSync(result.body).toString(), json, 'exactly one gzip layer');
  });
});

test('mislabelled gzip body without Content-Encoding is never compressed a second time', async () => {
  const gz = gzipSync(Buffer.from(json + ' '.repeat(5000)));
  await fixture((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': gz.byteLength });
    res.end(gz);
  }, async port => {
    const result = await get(port);
    assert.equal(result.res.headers['content-encoding'], undefined);
    assertLengthHonest(result);
    assert.deepEqual(result.body, gz);
  });
});

test('declared Content-Length that disagrees with the body is not re-framed by the hook', () => {
  const body = Buffer.from(json);
  assert.equal(lib.declaredLengthMatches({ 'Content-Length': String(body.byteLength) }, body), true);
  assert.equal(lib.declaredLengthMatches({}, body), true);
  assert.equal(lib.declaredLengthMatches({ 'content-length': '12' }, body), false);
  assert.equal(lib.declaredLengthMatches({ 'content-length': 'abc' }, body), false);
});

test('plain large JSON is still compressed once, without a stale Content-Length', async () => {
  await fixture((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) });
    res.end(json);
  }, async port => {
    const result = await get(port, { 'Accept-Encoding': 'gzip' });
    assert.equal(result.res.headers['content-encoding'], 'gzip');
    assertLengthHonest(result);
    assert.equal(gunzipSync(result.body).toString(), json);
  });
});

test('normal pages and small JSON are byte-identical with their Content-Length', async () => {
  const html = '<!doctype html>' + 'x'.repeat(20000);
  await fixture((req, res) => {
    if (req.url === '/small') { res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': 7 }); res.end('{"a":1}'); }
    else { res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Length': html.length }); res.end(html); }
  }, async port => {
    const page = await get(port);
    assert.equal(page.res.headers['content-encoding'], undefined);
    assertLengthHonest(page);
    assert.equal(page.body.toString(), html);
    const small = await new Promise((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port, path: '/small', headers: { 'Accept-Encoding': 'gzip' } }, res => {
        const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({ res, body: Buffer.concat(chunks) }));
      });
      req.on('error', reject); req.end();
    });
    assert.equal(small.res.headers['content-encoding'], undefined);
    assertLengthHonest(small);
  });
});

test('guards recognise encoded payloads', () => {
  assert.equal(lib.looksEncoded(gzipSync(Buffer.from('{}'))), true);
  assert.equal(lib.looksEncoded(Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0])), true);
  assert.equal(lib.looksEncoded(Buffer.from('{"a":1}')), false);
});

test('src/compress.ts stays aligned with the shipped lib/compress.js', async t => {
  const source = readFileSync(path.join(PLUGIN, 'src/compress.ts'), 'utf8');
  for (const name of ['headerValue', 'isDeferrable', 'varyWithAcceptEncoding', 'looksEncoded',
    'declaredLengthMatches', 'alreadyEncoded', 'installResponseCompression'])
    assert.match(source, new RegExp('export function ' + name + '\\('), name);
  for (const constant of ['MAX_JSON_BYTES', 'MAX_COMPRESSIONS'])
    assert.match(source, new RegExp('export const ' + constant + ' = '), constant);
  const tsPath = process.env.DSHA_TYPESCRIPT;
  if (!tsPath) { t.diagnostic('DSHA_TYPESCRIPT not set: transpile check skipped'); return; }
  const ts = createRequire(import.meta.url)(tsPath);
  const output = ts.transpileModule(source, { reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  assert.deepEqual(output.diagnostics ?? [], []);
  const dir = mkdtempSync(path.join(tmpdir(), 'dsha-compress-'));
  try {
    const file = path.join(dir, 'compress.mjs');
    writeFileSync(file, output.outputText);
    const src = await import(pathToFileURL(file).href);
    assert.equal(src.MAX_JSON_BYTES, lib.MAX_JSON_BYTES);
    assert.equal(src.MAX_COMPRESSIONS, lib.MAX_COMPRESSIONS);
    const samples = [{}, { 'content-encoding': 'gzip', 'content-type': 'application/json' },
      { 'Content-Type': 'application/json' }, { 'content-type': 'text/html' },
      { 'content-type': 'application/json', 'cache-control': 'no-transform' }];
    for (const headers of samples) assert.equal(src.isDeferrable(headers), lib.isDeferrable(headers));
    const body = Buffer.from(json);
    assert.equal(src.looksEncoded(gzipSync(body)), lib.looksEncoded(gzipSync(body)));
    assert.equal(src.declaredLengthMatches({ 'content-length': '3' }, body), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
