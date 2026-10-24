// Public-only egress proxy for the optional Chromium engine (own implementation). Chromium is started with
// --proxy-server pointing here and --proxy-bypass-list=<-loopback>, so every request (including loopback)
// goes through this proxy, which resolves names itself and refuses private/loopback/link-local targets.
import http from 'node:http';
import net from 'node:net';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { guardedLookup, privateAddress } from './browser.js';

function resolvePublic(host) {
  return new Promise((resolve, reject) => {
    const h = host.replace(/^\[|\]$/g, '');
    if (net.isIP(h)) return privateAddress(h) ? reject(new Error('BROWSER_PRIVATE_ADDRESS')) : resolve(h);
    if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(h)) return reject(new Error('BROWSER_PRIVATE_ADDRESS'));
    guardedLookup(h, {}, (e, address) => e ? reject(e) : resolve(address));
  });
}

export const CONNECT_PORTS = new Set([443, 80]);
export const HTTP_PORTS = new Set([80, 8080]);

function authorized(req, expected) {
  const got = Buffer.from(String(req.headers['proxy-authorization'] || '')), want = Buffer.from(expected);
  return got.length === want.length && timingSafeEqual(got, want);
}

export function startEgressProxy({ log = () => {}, resolve = resolvePublic, token = randomBytes(24).toString('base64url') } = {}) {
  // Per-launch random credential: only the Chromium we start (via CDP Fetch.authRequired) knows it.
  const expected = 'Basic ' + Buffer.from('allitor:' + token).toString('base64');
  const deny407 = 'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="allitor"\r\nContent-Length: 0\r\n\r\n';
  // `resolve` is injectable for tests only; production callers use the public-only resolver.
  const server = http.createServer(async (req, res) => {
    if (!authorized(req, expected)) { res.writeHead(407, { 'proxy-authenticate': 'Basic realm="allitor"' }); return res.end(); }
    let u; try { u = new URL(req.url); } catch { res.writeHead(400); return res.end(); }
    if (u.protocol !== 'http:') { res.writeHead(400); return res.end(); }
    if (!HTTP_PORTS.has(Number(u.port || 80))) { res.writeHead(403); return res.end('port not allowed'); }
    try {
      const ip = await resolve(u.hostname);
      const headers = { ...req.headers }; delete headers['proxy-connection']; delete headers['proxy-authorization'];
      const up = http.request({ host: ip, port: u.port || 80, path: u.pathname + u.search, method: req.method, headers, servername: u.hostname }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
      up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
      req.pipe(up);
    } catch (e) { log('egress refused ' + u.hostname); res.writeHead(403, { 'content-type': 'text/plain' }); res.end(String(e.message)); }
  });
  server.on('connect', async (req, client, head) => {
    if (!authorized(req, expected)) { client.end(deny407); return; }
    const m = /^(\[[^\]]+\]|[^:]+):(\d{1,5})$/.exec(req.url || '');
    if (!m) { client.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return; }
    if (!CONNECT_PORTS.has(Number(m[2]))) { client.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    try {
      const ip = await resolve(m[1]);
      const up = net.connect(Number(m[2]), ip, () => { client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head?.length) up.write(head); up.pipe(client); client.pipe(up); });
      up.on('error', () => client.destroy()); client.on('error', () => up.destroy());
    } catch { log('egress refused ' + m[1]); client.end('HTTP/1.1 403 Forbidden\r\n\r\n'); }
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, token, close: () => server.close() })));
}
