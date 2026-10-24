// Public-only egress proxy for the optional Chromium engine (own implementation). Chromium is started with
// --proxy-server pointing here and --proxy-bypass-list=<-loopback>, so every request (including loopback)
// goes through this proxy, which resolves names itself and refuses private/loopback/link-local targets.
import http from 'node:http';
import net from 'node:net';
import { guardedLookup, privateAddress } from './browser.js';

function resolvePublic(host) {
  return new Promise((resolve, reject) => {
    const h = host.replace(/^\[|\]$/g, '');
    if (net.isIP(h)) return privateAddress(h) ? reject(new Error('BROWSER_PRIVATE_ADDRESS')) : resolve(h);
    if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(h)) return reject(new Error('BROWSER_PRIVATE_ADDRESS'));
    guardedLookup(h, {}, (e, address) => e ? reject(e) : resolve(address));
  });
}

export function startEgressProxy({ log = () => {}, resolve = resolvePublic } = {}) {
  // `resolve` is injectable for tests only; production callers use the public-only resolver.
  const server = http.createServer(async (req, res) => {
    let u; try { u = new URL(req.url); } catch { res.writeHead(400); return res.end(); }
    if (u.protocol !== 'http:') { res.writeHead(400); return res.end(); }
    try {
      const ip = await resolve(u.hostname);
      const headers = { ...req.headers }; delete headers['proxy-connection']; delete headers['proxy-authorization'];
      const up = http.request({ host: ip, port: u.port || 80, path: u.pathname + u.search, method: req.method, headers, servername: u.hostname }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
      up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
      req.pipe(up);
    } catch (e) { log('egress refused ' + u.hostname); res.writeHead(403, { 'content-type': 'text/plain' }); res.end(String(e.message)); }
  });
  server.on('connect', async (req, client, head) => {
    const m = /^(\[[^\]]+\]|[^:]+):(\d{1,5})$/.exec(req.url || '');
    if (!m) { client.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return; }
    try {
      const ip = await resolve(m[1]);
      const up = net.connect(Number(m[2]), ip, () => { client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head?.length) up.write(head); up.pipe(client); client.pipe(up); });
      up.on('error', () => client.destroy()); client.on('error', () => up.destroy());
    } catch { log('egress refused ' + m[1]); client.end('HTTP/1.1 403 Forbidden\r\n\r\n'); }
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, close: () => server.close() })));
}
