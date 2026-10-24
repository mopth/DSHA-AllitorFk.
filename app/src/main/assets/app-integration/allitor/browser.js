// Browser-control toolset, minimal working subset (e, own implementation).
// A text browser run by the Web process (optional Chromium engine via cdp.js), never the user's DSH cookies,
// public addresses only (DNS checked inside the socket lookup, so no rebinding window), bounded
// size/time/redirects. Every call needs a live user-approved 'browser' takeover grant.
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import zlib from 'node:zlib';

const MAX_BYTES = 2 * 1024 * 1024, MAX_REDIRECTS = 5, TIMEOUT_MS = 20_000, MAX_TEXT = 200_000;

// 16-byte classification (B1 fix): IPv4-mapped/compatible/NAT64/6to4 forms are reduced to their embedded
// IPv4 address and checked against the IPv4 table; IPv6 special ranges are matched by prefix length.
function v4Private(b) {
  const [a, c] = b;
  return a === 0 || a === 10 || a === 127 || (a === 100 && c >= 64 && c <= 127) || (a === 169 && c === 254)
    || (a === 172 && c >= 16 && c <= 31) || (a === 192 && c === 168) || (a === 192 && c === 0) || (a === 198 && (c === 18 || c === 19))
    || (a === 198 && c === 51 && b[2] === 100) || (a === 203 && c === 0 && b[2] === 113) || (a === 192 && c === 88 && b[2] === 99) || a >= 224;
}
function parseV4(s) {
  const p = s.split('.'); if (p.length !== 4) return null;
  const b = p.map(x => /^\d{1,3}$/.test(x) ? Number(x) : NaN); return b.every(x => x >= 0 && x <= 255) ? b : null;
}
export function parseV6(s) {
  let v = String(s).toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  if (!net.isIPv6(v)) return null;
  let tail = [];
  const lastColon = v.lastIndexOf(':');
  if (v.slice(lastColon + 1).includes('.')) {
    const b = parseV4(v.slice(lastColon + 1)); if (!b) return null;
    tail = [(b[0] << 8) | b[1], (b[2] << 8) | b[3]]; v = v.slice(0, lastColon + 1) + (v.endsWith('::') ? '' : '0');
    if (v.endsWith(':0') && !v.endsWith('::0')) v = v.slice(0, -2); else if (v.endsWith('::0')) v = v.slice(0, -1);
  }
  const [h, t = null] = v.split('::');
  const hp = h ? h.split(':').filter(x => x !== '') : [], tp = t === null ? [] : t.split(':').filter(x => x !== '');
  const words = t === null ? [...hp] : [...hp, ...Array(8 - hp.length - tp.length - tail.length).fill('0'), ...tp];
  const all = [...words.map(x => parseInt(x, 16)), ...tail];
  if (all.length !== 8 || all.some(x => !(x >= 0 && x <= 0xffff))) return null;
  return Uint8Array.from(all.flatMap(w => [w >> 8, w & 0xff]));
}
const prefix = (b, bytes, bits) => { for (let i = 0; i < bits; i++) { const m = 0x80 >> (i % 8); if ((b[i >> 3] & m) !== (bytes[i >> 3] & m)) return false; } return true; };
const P = (hex, bits) => ({ bytes: parseV6(hex), bits });
const V6_BLOCKED = [P('::', 128), P('::1', 128), P('fc00::', 7), P('fe80::', 10), P('fec0::', 10), P('ff00::', 8), P('2001:db8::', 32),
  P('100::', 64), P('2001::', 23), P('2001:10::', 28), P('2001:20::', 28)];
const V6_EMBED = [P('::ffff:0:0', 96), P('::', 96), P('64:ff9b::', 96), P('::ffff:0:0:0', 96)];

export function privateAddress(ip) {
  const s = String(ip).replace(/^\[|\]$/g, '');
  if (net.isIPv4(s)) return v4Private(parseV4(s));
  const b = parseV6(s);
  if (!b) return true; // unparseable: refuse
  for (const p of V6_BLOCKED) if (prefix(b, p.bytes, p.bits)) return true;
  for (const p of V6_EMBED) if (prefix(b, p.bytes, p.bits)) return v4Private(b.subarray(12, 16));
  if (prefix(b, parseV6('64:ff9b:1::'), 48)) return true; // local-use NAT64 (RFC 8215)
  if (prefix(b, parseV6('2002::'), 16)) return v4Private(b.subarray(2, 6)); // 6to4 embeds v4 in bits 16..47
  return false;
}

export function guardedLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error);
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: options.family || 4 }];
    if (!list.length || list.some(a => privateAddress(a.address))) {
      const e = new Error('BROWSER_PRIVATE_ADDRESS'); e.code = 'BROWSER_PRIVATE_ADDRESS'; return callback(e);
    }
    if (options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

export function checkUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { throw new Error('BROWSER_URL'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('BROWSER_SCHEME');
  if (u.username || u.password) throw new Error('BROWSER_CREDENTIALS_IN_URL');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && privateAddress(host)) throw new Error('BROWSER_PRIVATE_ADDRESS');
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host)) throw new Error('BROWSER_PRIVATE_ADDRESS');
  u.hash = '';
  return u;
}

function getOnce(u, { method = 'GET', body = null, headers = {}, maxBytes = MAX_BYTES, lookup = guardedLookup } = {}) {
  return new Promise((resolve, reject) => {
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, { method, lookup, agent: false, timeout: TIMEOUT_MS,
      headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android) DSHA-AllitorFk-TextBrowser/1', accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5', 'accept-encoding': 'gzip, deflate, br', ...headers,
        ...(body ? { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body) } : {}) } }, res => {
      const chunks = []; let size = 0;
      let stream = res;
      const enc = String(res.headers['content-encoding'] || '').toLowerCase();
      if (enc === 'gzip') stream = res.pipe(zlib.createGunzip()); else if (enc === 'deflate') stream = res.pipe(zlib.createInflate()); else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());
      stream.on('data', c => { size += c.length; if (size > maxBytes) { req.destroy(); resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), truncated: true }); } else chunks.push(c); });
      stream.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), truncated: false }));
      stream.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('BROWSER_TIMEOUT')));
    req.on('error', reject);
    req.end(body ?? undefined);
  });
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e.toLowerCase()] ?? m));
const strip = s => decode(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const attr = (tag, name) => { const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag); return m ? decode(m[2] ?? m[3] ?? m[4] ?? '') : null; };

export function parsePage(html, base) {
  const clean = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, '');
  const title = strip((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(clean) || [, ''])[1]);
  const links = [];
  for (const m of clean.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attr(m[1], 'href'); if (!href || /^(javascript|mailto|tel|data):/i.test(href)) continue;
    let url; try { url = new URL(href, base).href; } catch { continue; }
    links.push({ index: links.length, text: strip(m[2]).slice(0, 160), url });
    if (links.length >= 500) break;
  }
  const forms = [];
  for (const m of clean.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const method = (attr(m[1], 'method') || 'get').toLowerCase();
    let action; try { action = new URL(attr(m[1], 'action') || base, base).href; } catch { continue; }
    const fields = [];
    for (const f of m[2].matchAll(/<(input|textarea|select)\b([^>]*)>/gi)) {
      const name = attr(f[2], 'name'); if (!name) continue;
      const type = (attr(f[2], 'type') || f[1]).toLowerCase(); if (type === 'file' || type === 'submit' && !name) continue;
      // password values are never echoed back; hidden (e.g. CSRF) values are kept for submission only
      fields.push({ name, type, value: type === 'password' ? '' : attr(f[2], 'value') ?? '' });
    }
    forms.push({ index: forms.length, method, action, fields: fields.slice(0, 40) });
    if (forms.length >= 20) break;
  }
  const body = clean.replace(/<(br|p|div|li|h[1-6]|tr|section|article|header|footer)\b[^>]*>/gi, '\n');
  const text = decode(body.replace(/<[^>]*>/g, ' ')).replace(/[ \t\r\f\v]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim().slice(0, MAX_TEXT);
  return { title, text, links, forms };
}

const MAX_DOWNLOAD = 50 * 1024 * 1024;
const safeName = n => (String(n).split(/[\\/]/).pop() || 'download').replace(/[^\w.\-()\u4e00-\u9fff ]/g, '_').replace(/^\.+/, '_').slice(0, 120) || 'download';
const publicForm = f => ({ ...f, fields: f.fields.filter(x => x.type !== 'hidden').map(x => ({ name: x.name, type: x.type, value: x.value })) });

/**
 * allowed():      live 'browser' grant (read-only: GET pages, links, find, GET forms)
 * allowedFull():  live 'browser_full' grant (POST forms, per-site login sessions, downloads, JS, screenshots)
 */
export function createBrowser({ allowed = () => false, allowedFull = () => false, fetchPage, sessions, engine = null, downloadsDir = '/root/allitor-downloads', writeFile } = {}) {
  const state = { history: [], page: null, mode: 'text' };
  const need = () => { if (!allowed() && !allowedFull()) throw new Error('BROWSER_NOT_AUTHORIZED: ask the user with allitor_takeover_request(scope="browser") first'); };
  const needFull = what => { if (!allowedFull()) throw new Error(`BROWSER_FULL_NOT_AUTHORIZED: ${what} needs allitor_takeover_request(scope="browser_full")`); };
  const fetchOne = (u, opts = {}) => {
    const cookie = allowedFull() && sessions ? sessions.header(u.href) : '';
    return (fetchPage ?? getOnce)(u, { ...opts, headers: { ...(opts.headers ?? {}), ...(cookie ? { cookie } : {}) } });
  };
  const keep = (u, r) => { if (allowedFull() && sessions && r.headers?.['set-cookie']) sessions.store(u.href, r.headers['set-cookie']); };
  const load = async (raw, init = {}) => {
    let u = checkUrl(raw), opts = init;
    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      const r = await fetchOne(u, opts); keep(u, r);
      if ([301, 302, 303, 307, 308].includes(r.status) && r.headers.location) {
        u = checkUrl(new URL(r.headers.location, u).href);
        if (r.status !== 307 && r.status !== 308) opts = {};
        continue;
      }
      const type = String(r.headers['content-type'] || '');
      const text = r.body.toString('utf8');
      const page = /html|xml/i.test(type) || /^\s*</.test(text) ? parsePage(text, u.href) : { title: '', text: text.slice(0, MAX_TEXT), links: [], forms: [] };
      return { url: u.href, status: r.status, contentType: type.slice(0, 80), truncated: r.truncated, ...page };
    }
    throw new Error('BROWSER_TOO_MANY_REDIRECTS');
  };
  const summary = p => ({ url: p.url, status: p.status, title: p.title, textLength: p.text.length, links: p.links.length, forms: p.forms.length, truncated: p.truncated,
    mode: state.mode, preview: p.text.slice(0, 1500) });
  const setPage = p => { if (state.page) state.history.push(state.page.url); state.page = p; return summary(p); };
  const needEngine = () => { if (!engine?.available()) throw new Error('BROWSER_ENGINE_UNAVAILABLE: no Chromium on this device; use text mode'); return engine; };
  return {
    async open(url, { engine: mode = 'text' } = {}) {
      need();
      if (mode === 'chromium') {
        needFull('JavaScript rendering'); const u = checkUrl(url); const snap = await needEngine().open(u.href); state.mode = 'chromium';
        return setPage({ url: snap.url, status: 200, title: snap.title, text: snap.text, links: [], forms: [], truncated: false, contentType: 'text/html' });
      }
      state.mode = 'text'; return setPage(await load(url));
    },
    read({ offset = 0, limit = 4000 } = {}) { need(); const p = state.page; if (!p) throw new Error('BROWSER_NO_PAGE');
      const o = Math.max(0, offset | 0), l = Math.min(Math.max(1, limit | 0), 20000); return { url: p.url, offset: o, text: p.text.slice(o, o + l), total: p.text.length }; },
    links({ filter = '' } = {}) { need(); const p = state.page; if (!p) throw new Error('BROWSER_NO_PAGE');
      const f = String(filter).toLowerCase(); return p.links.filter(l => !f || l.text.toLowerCase().includes(f) || l.url.toLowerCase().includes(f)).slice(0, 100); },
    async follow({ index }) { need(); const l = state.page?.links[index]; if (!l) throw new Error('BROWSER_LINK_INDEX'); return this.open(l.url); },
    async back() { need(); const prev = state.history.pop(); if (!prev) throw new Error('BROWSER_NO_HISTORY'); state.page = await load(prev); state.mode = 'text'; return summary(state.page); },
    find({ text }) { need(); const p = state.page; if (!p) throw new Error('BROWSER_NO_PAGE'); const q = String(text ?? ''); if (!q) throw new Error('BROWSER_FIND_TEXT');
      const hits = []; let i = -1; const low = p.text.toLowerCase(), ql = q.toLowerCase();
      while ((i = low.indexOf(ql, i + 1)) >= 0 && hits.length < 20) hits.push({ offset: i, context: p.text.slice(Math.max(0, i - 80), i + q.length + 80) });
      return { url: p.url, hits }; },
    forms() { need(); return (state.page?.forms ?? []).map(publicForm); },
    async submit({ index, values = {} }) {
      need(); const f = state.page?.forms[index]; if (!f) throw new Error('BROWSER_FORM_INDEX');
      const params = new URLSearchParams();
      for (const field of f.fields) params.set(field.name, Object.hasOwn(values, field.name) ? String(values[field.name]) : field.value);
      if (f.method === 'get') { const u = new URL(f.action); u.search = params.toString(); return this.open(u.href); }
      if (f.method !== 'post') throw new Error('BROWSER_FORM_METHOD');
      needFull('POST forms');
      state.mode = 'text'; return setPage(await load(f.action, { method: 'POST', body: params.toString() }));
    },
    async download({ url, index }) {
      need(); needFull('downloads');
      const target = url ?? state.page?.links[index]?.url; if (!target) throw new Error('BROWSER_DOWNLOAD_TARGET');
      let u = checkUrl(target), r;
      for (let i = 0; i <= MAX_REDIRECTS; i++) {
        r = await fetchOne(u, { maxBytes: MAX_DOWNLOAD }); keep(u, r);
        if ([301, 302, 303, 307, 308].includes(r.status) && r.headers.location) { u = checkUrl(new URL(r.headers.location, u).href); continue; }
        break;
      }
      if (r.status < 200 || r.status >= 300) throw new Error('BROWSER_DOWNLOAD_STATUS ' + r.status);
      if (r.truncated) throw new Error('BROWSER_DOWNLOAD_TOO_LARGE (50 MiB cap)');
      const cd = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(String(r.headers['content-disposition'] || ''));
      const name = `${Date.now()}-${safeName(cd ? decodeURIComponent(cd[1]) : new URL(u).pathname)}`;
      const path = `${downloadsDir}/${name}`;
      (writeFile ?? defaultWrite)(downloadsDir, path, r.body);
      return { path, bytes: r.body.length, contentType: String(r.headers['content-type'] || '').slice(0, 80) };
    },
    async evaluate({ expression }) { need(); needFull('JavaScript execution'); if (state.mode !== 'chromium') throw new Error('BROWSER_JS_NEEDS_CHROMIUM: open the page with engine="chromium" first');
      return needEngine().evaluate(expression); },
    async screenshot() { need(); needFull('screenshots'); if (state.mode !== 'chromium') throw new Error('BROWSER_SCREENSHOT_NEEDS_CHROMIUM: open the page with engine="chromium" first');
      const file = `${downloadsDir}/screenshot-${Date.now()}.png`; defaultMkdir(downloadsDir); await needEngine().screenshot(file); return { path: file }; },
    sessions() { need(); return { text: sessions?.list() ?? [], chromium: engine?.available() ? 'per-site profiles' : 'unavailable' }; },
    async clearSession({ site = '*' } = {}) { const n = sessions?.clear(site) ?? 0; if (engine) await (site === '*' ? engine.clearAll() : engine.clearSite(site)); return { cleared: n, site }; },
    status() { return { authorized: allowed() || allowedFull(), full: allowedFull(), mode: state.mode, engine: engine?.available() ? 'chromium+text' : 'text',
      url: state.page?.url ?? null, title: state.page?.title ?? null, history: state.history.length, downloadsDir }; },
    reset() { state.history.length = 0; state.page = null; state.mode = 'text'; engine?.close(); },
  };
}

import { mkdirSync as _mkdir, writeFileSync as _write } from 'node:fs';
function defaultMkdir(dir) { _mkdir(dir, { recursive: true, mode: 0o755 }); }
function defaultWrite(dir, path, body) { defaultMkdir(dir); _write(path, body, { mode: 0o644, flag: 'wx' }); }
