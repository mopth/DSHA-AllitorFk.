// AllitorFk rc.3 guarded surfaces (own code; ideas from the competitor review, no code copied).
// User routes: official authorizeIndex (signed cookie) first, never Host-only; writes also need
// a same-origin Origin, the x-dsha-allitor: 1 header and a JSON body (blocks cross-site forms).
import { timingSafeEqual } from 'node:crypto';

export const HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };

export function sameOrigin(req) {
  const origin = req.headers.origin, host = req.headers.host;
  return typeof origin === 'string' && typeof host === 'string' && (origin === `http://${host}` || origin === `https://${host}`);
}

/** Returns null when allowed, else [status, code]. authorizeIndex has already run. */
export function writeGate(req) {
  if (req.method !== 'POST') return [405, 'ALLITOR_METHOD'];
  if (!sameOrigin(req) || req.headers['x-dsha-allitor'] !== '1') return [403, 'ALLITOR_FORBIDDEN'];
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return [415, 'ALLITOR_CONTENT_TYPE'];
  return null;
}

export function json(res, code, body, extra = {}) {
  res.writeHead(code, { ...HEADERS, 'content-type': 'application/json; charset=utf-8', ...extra });
  res.end(JSON.stringify(body));
}

export async function readJson(req, limit = 16 * 1024) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw new Error('ALLITOR_BODY_TOO_LARGE'); chunks.push(chunk); }
  const text = Buffer.concat(chunks).toString('utf8') || '{}';
  const value = JSON.parse(text);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('ALLITOR_BODY');
  return value;
}

export function tokenEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
