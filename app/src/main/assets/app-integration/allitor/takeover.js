// AI takeover permission (B2, own implementation). Default: nothing granted.
// The agent may only *ask*; approval, denial and revocation come from the signed-cookie user page.
// Grants live in this Web process's memory only, so a shell inside the sandbox cannot forge one.
import { randomUUID } from 'node:crypto';

export const SCOPES = {
  browser: { zh: '代你浏览网页（只读取公开 http/https 页面，不带你的登录 Cookie）', maxMinutes: 120 },
  browser_full: { zh: '完整浏览器：执行网页 JS、提交 POST 表单、按站点隔离的登录会话、截图、下载到沙箱（仍禁止内网/回环）', maxMinutes: 60 },
  preview: { zh: '在沙箱里发布静态页面预览（只读所选目录）', maxMinutes: 240 },
};

export function createTakeover({ now = () => Date.now(), maxPending = 8 } = {}) {
  const requests = new Map(); // id -> request
  const listeners = new Set();
  const emit = () => { for (const f of listeners) try { f(); } catch {} };
  const expire = () => {
    const t = now();
    for (const r of requests.values()) {
      if (r.state === 'granted' && r.expiresAt <= t) { r.state = 'expired'; r.endedAt = t; }
      if (r.state === 'pending' && r.requestedAt + 10 * 60_000 <= t) { r.state = 'expired'; r.endedAt = t; }
    }
    // keep a bounded history
    const ended = [...requests.values()].filter(r => !['pending', 'granted'].includes(r.state)).sort((a, b) => a.endedAt - b.endedAt);
    while (ended.length > 32) requests.delete(ended.shift().id);
  };
  const view = r => ({ id: r.id, scope: r.scope, reason: r.reason, minutes: r.minutes, state: r.state,
    requestedAt: r.requestedAt, decidedAt: r.decidedAt ?? null, expiresAt: r.expiresAt ?? null });
  return {
    request({ scope, reason, minutes }) {
      expire();
      if (!Object.hasOwn(SCOPES, scope)) throw new Error('TAKEOVER_SCOPE');
      const text = String(reason ?? '').trim().slice(0, 500);
      if (!text) throw new Error('TAKEOVER_REASON');
      const m = Math.min(Math.max(Number.isInteger(minutes) ? minutes : 30, 1), SCOPES[scope].maxMinutes);
      if ([...requests.values()].filter(r => r.state === 'pending').length >= maxPending) throw new Error('TAKEOVER_TOO_MANY_PENDING');
      const r = { id: randomUUID(), scope, reason: text, minutes: m, state: 'pending', requestedAt: now() };
      requests.set(r.id, r); emit();
      return view(r);
    },
    decide(id, approve) {
      expire();
      const r = requests.get(String(id));
      if (!r || r.state !== 'pending') throw new Error('TAKEOVER_NOT_PENDING');
      r.decidedAt = now();
      if (approve) { r.state = 'granted'; r.expiresAt = r.decidedAt + r.minutes * 60_000; }
      else { r.state = 'denied'; r.endedAt = r.decidedAt; }
      emit();
      return view(r);
    },
    revoke(id) {
      expire();
      const r = requests.get(String(id));
      if (!r || r.state !== 'granted') throw new Error('TAKEOVER_NOT_GRANTED');
      r.state = 'revoked'; r.endedAt = now(); emit();
      return view(r);
    },
    revokeAll() { for (const r of requests.values()) if (r.state === 'granted' || r.state === 'pending') { r.state = 'revoked'; r.endedAt = now(); } emit(); },
    /** true only for a live, user-approved grant of exactly this scope */
    granted(scope) { expire(); return [...requests.values()].some(r => r.state === 'granted' && r.scope === scope); },
    status(id) { expire(); const r = requests.get(String(id)); return r ? view(r) : null; },
    list() { expire(); return [...requests.values()].map(view).sort((a, b) => b.requestedAt - a.requestedAt); },
    subscribe(f) { listeners.add(f); return () => listeners.delete(f); },
  };
}
