// 扩展中心的页面与 API：全部先过官方 authorizeIndex（签名 Cookie），从不只看 Host 头；
// 写操作再要求同源 Origin、专用请求头 x-dsha-ext 与正确的 Content-Type，挡住跨站表单/简单请求。
import { readFileSync } from 'node:fs';
import { createExtensionManager } from './manager.js';

const BASE = '/__dsha/extensions';
const HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };

function sameOrigin(req) {
  const origin = req.headers.origin;
  const host = req.headers.host;
  return typeof origin === 'string' && typeof host === 'string' && (origin === `http://${host}` || origin === `https://${host}`);
}

function json(res, code, body) {
  res.writeHead(code, { ...HEADERS, 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readJson(req, limit = 4096) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw new Error('EXT_BODY_TOO_LARGE'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

export function registerExtensionRoutes(scoped, options = {}) {
  const manager = options.manager ?? createExtensionManager();
  manager.cleanupStaging();
  const handler = async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://dsh.invalid');
    if (!scoped.connection.authorizeIndex(req, res)) return;
    const sub = url.pathname.slice(BASE.length) || '/';
    try {
      if (req.method === 'GET' && sub === '/') {
        const page = readFileSync(new URL('./extensions.html', import.meta.url), 'utf8');
        res.writeHead(200, { ...HEADERS, 'content-type': 'text/html; charset=utf-8',
          'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" });
        res.end(page);
        return;
      }
      if (req.method === 'GET' && sub === '/api/state') return json(res, 200, { ...manager.list(), log: manager.log().slice(-120) });
      if (req.method !== 'POST') return json(res, 405, { error: 'EXT_METHOD' });
      if (!sameOrigin(req) || req.headers['x-dsha-ext'] !== '1') return json(res, 403, { error: 'EXT_FORBIDDEN' });
      // 下载/下载并安装与启用/移除同一套保护：authorizeIndex + 同源 Origin + x-dsha-ext + JSON。
      // 地址只由内置目录决定（请求体只给 id），不接受任何外部 URL。
      const ACTIONS = { '/api/activate': 'activate', '/api/remove': 'remove', '/api/download': 'download', '/api/install': 'install' };
      if (ACTIONS[sub]) {
        if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return json(res, 415, { error: 'EXT_CONTENT_TYPE' });
        const { id } = await readJson(req);
        const job = manager.start(ACTIONS[sub], String(id ?? ''));
        return json(res, 202, { job });
      }
      if (sub === '/api/import') {
        if (req.headers['content-type'] !== 'application/octet-stream') return json(res, 415, { error: 'EXT_CONTENT_TYPE' });
        if (manager.busy()) return json(res, 409, { error: 'EXT_BUSY' });
        await manager.importStream(req, url.searchParams.get('id') ?? '');
        return json(res, 200, { ok: true });
      }
      return json(res, 404, { error: 'EXT_NOT_FOUND' });
    } catch (error) {
      if (!res.headersSent) json(res, 400, { error: String(error.message ?? error) });
      else res.end();
    }
  };
  return scoped.webServer.register({ kind: 'prefix', path: BASE, handler });
}
