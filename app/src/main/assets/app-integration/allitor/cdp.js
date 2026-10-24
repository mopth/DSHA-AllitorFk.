// Optional Chromium engine over the DevTools protocol pipe (own implementation; no third-party driver).
// One headless Chromium per site profile (isolated user-data-dir), all traffic through the public-only
// egress proxy, downloads confined to the sandbox downloads directory.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { siteOf } from './sessions.js';

const CANDIDATES = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/opt/dsha-ext/chromium/bin/chromium'];
export function findChromium(env = process.env) {
  if (env.ALLITOR_CHROMIUM && existsSync(env.ALLITOR_CHROMIUM)) return env.ALLITOR_CHROMIUM;
  return CANDIDATES.find(p => existsSync(p)) ?? null;
}

export function chromiumArgs({ profileDir, proxyPort, root = process.getuid?.() === 0 }) {
  return ['--headless=new', '--remote-debugging-pipe', `--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--disable-quic', '--disable-background-networking', '--disable-sync', '--disable-extensions', '--mute-audio',
    `--proxy-server=http://127.0.0.1:${proxyPort}`, '--proxy-bypass-list=<-loopback>',
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--webrtc-ip-handling-policy=disable_non_proxied_udp',
    '--window-size=1280,800', ...(root ? ['--no-sandbox'] : []), 'about:blank'];
}

function launch(executable, args) {
  const child = spawn(executable, args, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  const pending = new Map(), listeners = new Set(); let id = 0, buf = Buffer.alloc(0), closed = false;
  child.stdio[2].on('data', () => {});
  child.stdio[4].on('data', chunk => {
    buf = Buffer.concat([buf, chunk]); let i;
    while ((i = buf.indexOf(0)) >= 0) {
      const msg = JSON.parse(buf.subarray(0, i).toString('utf8')); buf = buf.subarray(i + 1);
      if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.reject(new Error('CDP ' + msg.error.message)) : p.resolve(msg.result); }
      else for (const f of listeners) f(msg);
    }
  });
  child.on('exit', () => { closed = true; for (const p of pending.values()) p.reject(new Error('BROWSER_ENGINE_EXITED')); pending.clear(); });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    if (closed) return reject(new Error('BROWSER_ENGINE_EXITED'));
    const n = ++id; pending.set(n, { resolve, reject });
    child.stdio[3].write(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  });
  const waitFor = (pred, ms) => new Promise((resolve, reject) => {
    const t = setTimeout(() => { listeners.delete(f); reject(new Error('BROWSER_TIMEOUT')); }, ms);
    const f = m => { if (pred(m)) { clearTimeout(t); listeners.delete(f); resolve(m); } }; listeners.add(f);
  });
  const exited = new Promise(r => child.on('exit', r));
  const close = () => { if (!closed) { child.kill('SIGTERM'); const t = setTimeout(() => child.kill('SIGKILL'), 3000); exited.then(() => clearTimeout(t)); } return exited; };
  return { send, waitFor, on: f => listeners.add(f), close };
}

export function createChromiumEngine({ executable = findChromium(), profilesDir, downloadsDir, proxyPort, launcher = launch, timeoutMs = 25_000 } = {}) {
  let cur = null; // { site, conn, sessionId }
  const ensure = async site => {
    if (!executable) throw new Error('BROWSER_ENGINE_UNAVAILABLE: no Chromium found (set ALLITOR_CHROMIUM or install one); text mode still works');
    if (cur?.site === site) return cur;
    if (cur) { await cur.conn.close(); cur = null; }
    const profileDir = join(profilesDir, site.replace(/[^a-z0-9.-]/g, '_'));
    mkdirSync(profileDir, { recursive: true, mode: 0o700 }); mkdirSync(downloadsDir, { recursive: true });
    const port = typeof proxyPort === 'function' ? await proxyPort() : proxyPort;
    const conn = launcher(executable, chromiumArgs({ profileDir, proxyPort: port }));
    const { targetId } = await conn.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await conn.send('Target.attachToTarget', { targetId, flatten: true });
    await conn.send('Page.enable', {}, sessionId);
    await conn.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadsDir, eventsEnabled: true });
    cur = { site, conn, sessionId };
    return cur;
  };
  return {
    available: () => Boolean(executable),
    async open(url) {
      const s = await ensure(siteOf(new URL(url).hostname));
      const loaded = s.conn.waitFor(m => m.method === 'Page.loadEventFired' && m.sessionId === s.sessionId, timeoutMs).catch(() => null);
      const nav = await s.conn.send('Page.navigate', { url }, s.sessionId);
      if (nav.errorText) throw new Error('BROWSER_NAVIGATE ' + nav.errorText);
      await loaded;
      return this.snapshot();
    },
    async evaluate(expression, { maxChars = 20000 } = {}) {
      if (!cur) throw new Error('BROWSER_NO_PAGE');
      const r = await cur.conn.send('Runtime.evaluate', { expression: String(expression), returnByValue: true, awaitPromise: true, timeout: 15000, userGesture: true }, cur.sessionId);
      if (r.exceptionDetails) throw new Error('BROWSER_JS ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text).slice(0, 500));
      const v = r.result?.value; const text = typeof v === 'string' ? v : JSON.stringify(v ?? null);
      return { value: text.slice(0, maxChars), truncated: text.length > maxChars };
    },
    async snapshot() {
      const r = await this.evaluate('JSON.stringify({url: location.href, title: document.title, text: (document.body && document.body.innerText || "").slice(0, 200000)})', { maxChars: 250000 });
      return JSON.parse(r.value);
    },
    async screenshot(file) {
      if (!cur) throw new Error('BROWSER_NO_PAGE');
      const { data } = await cur.conn.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, cur.sessionId);
      writeFileSync(file, Buffer.from(data, 'base64'), { mode: 0o644 });
      return file;
    },
    downloads() { try { return readdirSync(downloadsDir).filter(n => !n.endsWith('.crdownload')); } catch { return []; } },
    async clearSite(site) { const key = siteOf(site); if (cur?.site === key) { const c = cur; cur = null; await c.conn.close(); }
      rmSync(join(profilesDir, key.replace(/[^a-z0-9.-]/g, '_')), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); },
    async clearAll() { if (cur) { const c = cur; cur = null; await c.conn.close(); } rmSync(profilesDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); },
    close() { const c = cur; cur = null; return c ? c.conn.close() : Promise.resolve(); },
  };
}
