// /__dsha/allitor: the user's control page and APIs (own implementation).
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { HEADERS, json, readJson, writeGate } from './guard.js';
import { createTakeover, SCOPES } from './takeover.js';
import { createPreviews, PREVIEW_CSP } from './preview.js';
import { createAnnotations, annotationText } from './annotations.js';
import { createBrowser } from './browser.js';
import { createSessions } from './sessions.js';
import { createChromiumEngine } from './cdp.js';
import { startEgressProxy } from './egress-proxy.js';
import { checkEngines } from './engines.js';
import { startAgentChannel } from './agent.js';
import { createNativeApprover } from './native-confirm.js';

export const BASE = '/__dsha/allitor';
const PAGE_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";

export function dshVersion(file = '/usr/local/lib/node_modules/@deepseek-ai/dsh/package.json') {
  try { return JSON.parse(readFileSync(file, 'utf8')).version ?? null; } catch { return null; }
}

export function scanPlugins(root = '/root/.dsh/plugin-src', version = dshVersion()) {
  const out = [];
  const visit = (dir, depth) => {
    let names = []; try { names = readdirSync(dir); } catch { return; }
    for (const name of names.slice(0, 400)) {
      const p = join(dir, name);
      let st; try { st = lstatSync(p); } catch { continue; }
      if (!st.isDirectory() || st.isSymbolicLink()) continue;
      if (name.startsWith('@') && depth === 0) { visit(p, 1); continue; }
      try {
        const pkg = JSON.parse(readFileSync(join(p, 'package.json'), 'utf8'));
        out.push({ name: String(pkg.name ?? name), version: String(pkg.version ?? ''), ...checkEngines(pkg, version ?? '0.0.0') });
      } catch {}
    }
  };
  visit(root, 0);
  return { dshVersion: version, plugins: out };
}

export function createAllitor(options = {}) {
  const takeover = options.takeover ?? createTakeover();
  const previews = options.previews ?? createPreviews(options.previewOptions);
  const annotations = options.annotations ?? createAnnotations();
  const sessions = options.sessions ?? createSessions();
  let proxy = null;
  const engine = options.engine !== undefined ? options.engine : createChromiumEngine({ profilesDir: options.profilesDir ?? '/root/.dsh/allitor/browser-profiles',
    downloadsDir: options.downloadsDir ?? '/root/allitor-downloads', proxyPort: async () => (proxy ??= await startEgressProxy()) });
  const browser = options.browser ?? createBrowser({ allowed: () => takeover.granted('browser'), allowedFull: () => takeover.granted('browser_full'),
    fetchPage: options.fetchPage, sessions, engine, downloadsDir: options.downloadsDir ?? '/root/allitor-downloads' });
  takeover.subscribe(() => { if (!takeover.granted('browser') && !takeover.granted('browser_full')) browser.reset(); });
  const ops = {
    'takeover.request': a => takeover.request(a),
    'takeover.status': a => takeover.status(a.id),
    'takeover.list': () => takeover.list(),
    'preview.start': a => { if (!takeover.granted('preview')) throw new Error('PREVIEW_NOT_AUTHORIZED: ask the user with allitor_takeover_request(scope="preview") first');
      const p = previews.start(a.dir, { entry: a.entry }); return { ...p, path: `${BASE}/annotate/${p.id}`, raw: `${BASE}/preview/${p.id}/` }; },
    'preview.stop': a => { if (!takeover.granted('preview')) throw new Error('PREVIEW_NOT_AUTHORIZED'); return { stopped: previews.stop(a.id) }; },
    'annotations.take': () => annotations.take('agent').map(a => ({ ...a, text: annotationText(a) })),
    'browser.open': a => browser.open(a.url, { engine: a.engine === 'chromium' ? 'chromium' : 'text' }), 'browser.read': a => browser.read(a), 'browser.links': a => browser.links(a),
    'browser.follow': a => browser.follow(a), 'browser.back': () => browser.back(), 'browser.find': a => browser.find(a),
    'browser.forms': () => browser.forms(), 'browser.submit': a => browser.submit(a), 'browser.status': () => browser.status(),
    'browser.download': a => browser.download(a), 'browser.eval': a => browser.evaluate(a), 'browser.screenshot': () => browser.screenshot(),
    'browser.sessions': () => browser.sessions(), 'browser.session_clear': a => { if (!takeover.granted('browser_full')) throw new Error('BROWSER_FULL_NOT_AUTHORIZED'); return browser.clearSession(a); },
  };
  return { takeover, previews, annotations, browser, sessions, ops, close() { browser.reset(); proxy?.close(); } };
}

export function registerAllitorRoutes(scoped, options = {}) {
  const core = options.core ?? createAllitor(options);
  // Verification key pinned now, at web start, before any agent turn can swap the file.
  const approve = options.confirm ?? createNativeApprover(options.approver);
  let channel = null;
  if (options.agent !== false) { try { channel = startAgentChannel({ dir: options.agentDir, ops: core.ops }); } catch (error) { console.warn('allitor agent channel disabled:', error?.message); } }
  const handler = async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://dsh.invalid');
    const sub = url.pathname.slice(BASE.length) || '/';
    let m;
    // Preview files are fetched by a CSP-sandboxed (opaque-origin) document, which never carries the
    // SameSite=Strict DSH cookie. They are therefore served by capability: a 128-bit preview id that
    // only the cookie-authenticated page and the agent channel ever see, read-only, GET only.
    if (req.method === 'GET' && (m = /^\/preview\/([A-Za-z0-9_-]{22})(\/.*)?$/.exec(sub))) {
      const r = core.previews.read(m[1], (m[2] ?? '/').slice(1));
      if (r.status !== 200) { res.writeHead(r.status, HEADERS); return res.end(); }
      res.writeHead(200, { ...HEADERS, 'content-type': r.type, 'content-security-policy': PREVIEW_CSP, 'cross-origin-resource-policy': 'same-origin' });
      return res.end(r.body);
    }
    if (!scoped.connection.authorizeIndex(req, res)) return;
    try {
      if (req.method === 'GET' && sub === '/') {
        res.writeHead(200, { ...HEADERS, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': PAGE_CSP });
        return res.end(readFileSync(new URL('./allitor.html', import.meta.url), 'utf8'));
      }
      if (req.method === 'GET' && (m = /^\/annotate\/([A-Za-z0-9_-]{22})$/.exec(sub))) {
        res.writeHead(200, { ...HEADERS, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': PAGE_CSP });
        return res.end(readFileSync(new URL('./annotate.html', import.meta.url), 'utf8').replace('__PREVIEW_ID__', m[1]));
      }
      if (req.method === 'GET' && sub === '/api/state')
        return json(res, 200, { scopes: SCOPES, takeover: core.takeover.list(), previews: core.previews.list(), annotations: core.annotations.all(),
          plugins: options.scanPlugins ? options.scanPlugins() : scanPlugins(), browserSessions: core.sessions.list(), browser: core.browser.status() });
      const blocked = writeGate(req);
      if (blocked) return json(res, blocked[0], { error: blocked[1] });
      const body = await readJson(req);
      if (sub === '/api/takeover/decide') {
        if (body.approve !== true) return json(res, 200, core.takeover.decide(body.id, false));
        const pending = core.takeover.status(body.id);
        if (!pending || pending.state !== 'pending') return json(res, 409, { error: 'TAKEOVER_NOT_PENDING' });
        // A forged cookie is possible from inside proot; only a human tap on the native dialog approves.
        let ok = false;
        try { ok = await approve(pending); }
        catch (error) { return json(res, 503, { error: String(error.message).slice(0, 200) }); }
        if (!ok) { core.takeover.decide(body.id, false); return json(res, 403, { error: 'TAKEOVER_NATIVE_DENIED' }); }
        return json(res, 200, core.takeover.decide(body.id, true));
      }
      if (sub === '/api/takeover/revoke') { if (body.all === true) { core.takeover.revokeAll(); return json(res, 200, { ok: true }); } return json(res, 200, core.takeover.revoke(body.id)); }
      if (sub === '/api/browser/sessions/clear') return json(res, 200, await core.browser.clearSession({ site: typeof body.site === 'string' ? body.site : '*' }));
      if (sub === '/api/preview/stop') return json(res, 200, { stopped: core.previews.stop(body.id) });
      if (sub === '/api/annotations') return json(res, 200, core.annotations.add(body));
      if (sub === '/api/annotations/take') return json(res, 200, core.annotations.take('client').map(a => ({ id: a.id, text: annotationText(a) })));
      return json(res, 404, { error: 'ALLITOR_NOT_FOUND' });
    } catch (error) {
      if (!res.headersSent) json(res, 400, { error: String(error?.message ?? error).slice(0, 300) });
      else res.end();
    }
  };
  const off = scoped.webServer.register({ kind: 'prefix', path: BASE, handler });
  return () => { channel?.close(); core.close?.(); typeof off === 'function' && off(); };
}
