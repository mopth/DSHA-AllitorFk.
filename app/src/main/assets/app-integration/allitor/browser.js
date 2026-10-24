// Browser-control toolset, minimal working subset (e, own implementation).
// A text browser run by the Web process: plain GET/HEAD-less fetches without the user's cookies,
// public addresses only (DNS checked inside the socket lookup, so no rebinding window), bounded
// size/time/redirects. Every call needs a live user-approved 'browser' takeover grant.
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import zlib from 'node:zlib';

const MAX_BYTES = 2 * 1024 * 1024, MAX_REDIRECTS = 5, TIMEOUT_MS = 20_000, MAX_TEXT = 200_000;

export function privateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return privateAddress(v.slice(7));
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9')
    || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('ff');
}

function guardedLookup(hostname, options, callback) {
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

function getOnce(u, { lookup = guardedLookup } = {}) {
  return new Promise((resolve, reject) => {
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, { method: 'GET', lookup, agent: false, timeout: TIMEOUT_MS,
      headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android) DSHA-AllitorFk-TextBrowser/1', accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5', 'accept-encoding': 'gzip, deflate, br' } }, res => {
      const chunks = []; let size = 0;
      let stream = res;
      const enc = String(res.headers['content-encoding'] || '').toLowerCase();
      if (enc === 'gzip') stream = res.pipe(zlib.createGunzip()); else if (enc === 'deflate') stream = res.pipe(zlib.createInflate()); else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());
      stream.on('data', c => { size += c.length; if (size > MAX_BYTES) { req.destroy(); resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), truncated: true }); } else chunks.push(c); });
      stream.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), truncated: false }));
      stream.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('BROWSER_TIMEOUT')));
    req.on('error', reject);
    req.end();
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
      const type = (attr(f[2], 'type') || f[1]).toLowerCase(); if (type === 'password' || type === 'file' || type === 'hidden' && /csrf|token/i.test(name)) continue;
      fields.push({ name, type, value: attr(f[2], 'value') ?? '' });
    }
    forms.push({ index: forms.length, method, action, fields: fields.slice(0, 40) });
    if (forms.length >= 20) break;
  }
  const body = clean.replace(/<(br|p|div|li|h[1-6]|tr|section|article|header|footer)\b[^>]*>/gi, '\n');
  const text = decode(body.replace(/<[^>]*>/g, ' ')).replace(/[ \t\r\f\v]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim().slice(0, MAX_TEXT);
  return { title, text, links, forms };
}

export function createBrowser({ allowed = () => false, fetchPage } = {}) {
  const state = { history: [], page: null };
  const need = () => { if (!allowed()) throw new Error('BROWSER_NOT_AUTHORIZED: ask the user with allitor_takeover_request(scope="browser") first'); };
  const load = async (raw) => {
    let u = checkUrl(raw);
    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      const r = await (fetchPage ?? getOnce)(u);
      if ([301, 302, 303, 307, 308].includes(r.status) && r.headers.location) { u = checkUrl(new URL(r.headers.location, u).href); continue; }
      const type = String(r.headers['content-type'] || '');
      const text = r.body.toString('utf8');
      const page = /html|xml/i.test(type) || /^\s*</.test(text) ? parsePage(text, u.href) : { title: '', text: text.slice(0, MAX_TEXT), links: [], forms: [] };
      return { url: u.href, status: r.status, contentType: type.slice(0, 80), truncated: r.truncated, ...page };
    }
    throw new Error('BROWSER_TOO_MANY_REDIRECTS');
  };
  const summary = p => ({ url: p.url, status: p.status, title: p.title, textLength: p.text.length, links: p.links.length, forms: p.forms.length, truncated: p.truncated,
    preview: p.text.slice(0, 1500) });
  return {
    async open(url) { need(); const p = await load(url); if (state.page) state.history.push(state.page.url); state.page = p; return summary(p); },
    read({ offset = 0, limit = 4000 } = {}) { need(); const p = state.page; if (!p) throw new Error('BROWSER_NO_PAGE');
      const o = Math.max(0, offset | 0), l = Math.min(Math.max(1, limit | 0), 20000); return { url: p.url, offset: o, text: p.text.slice(o, o + l), total: p.text.length }; },
    links({ filter = '' } = {}) { need(); const p = state.page; if (!p) throw new Error('BROWSER_NO_PAGE');
      const f = String(filter).toLowerCase(); return p.links.filter(l => !f || l.text.toLowerCase().includes(f) || l.url.toLowerCase().includes(f)).slice(0, 100); },
    async follow({ index }) { need(); const l = state.page?.links[index]; if (!l) throw new Error('BROWSER_LINK_INDEX'); return this.open(l.url); },
    async back() { need(); const prev = state.history.pop(); if (!prev) throw new Error('BROWSER_NO_HISTORY'); state.page = await load(prev); return summary(state.page); },
    find({ text }) { need(); const p = state.page; if (!p) throw new Error('BROWSER_NO_PAGE'); const q = String(text ?? ''); if (!q) throw new Error('BROWSER_FIND_TEXT');
      const hits = []; let i = -1; const low = p.text.toLowerCase(), ql = q.toLowerCase();
      while ((i = low.indexOf(ql, i + 1)) >= 0 && hits.length < 20) hits.push({ offset: i, context: p.text.slice(Math.max(0, i - 80), i + q.length + 80) });
      return { url: p.url, hits }; },
    forms() { need(); return state.page?.forms ?? []; },
    async submit({ index, values = {} }) { need(); const f = state.page?.forms[index]; if (!f) throw new Error('BROWSER_FORM_INDEX');
      if (f.method !== 'get') throw new Error('BROWSER_FORM_POST_NOT_SUPPORTED');
      const u = new URL(f.action); for (const field of f.fields) u.searchParams.set(field.name, Object.hasOwn(values, field.name) ? String(values[field.name]) : field.value);
      return this.open(u.href); },
    status() { return { authorized: allowed(), url: state.page?.url ?? null, title: state.page?.title ?? null, history: state.history.length }; },
    reset() { state.history.length = 0; state.page = null; },
  };
}
