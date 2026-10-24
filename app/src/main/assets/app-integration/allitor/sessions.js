// Per-site browser sessions (own implementation). Each site (hostname without a leading "www.") has its
// own cookie jar; nothing is shared across sites or with the user's DSH cookie. Memory only; clearable.
export const siteOf = host => String(host || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/^www\./, '');

export function createSessions({ now = () => Date.now(), maxCookies = 200 } = {}) {
  const jars = new Map(); // site -> Map(key -> cookie)
  const jar = site => { let j = jars.get(site); if (!j) { j = new Map(); jars.set(site, j); } return j; };
  const live = c => c.expires === null || c.expires > now();
  return {
    store(url, setCookie) {
      const u = new URL(url), site = siteOf(u.hostname), host = u.hostname.toLowerCase();
      for (const line of [].concat(setCookie ?? [])) {
        const parts = String(line).split(';').map(s => s.trim()); const [nv, ...attrs] = parts;
        const eq = nv.indexOf('='); if (eq <= 0) continue;
        const c = { name: nv.slice(0, eq).trim(), value: nv.slice(eq + 1).trim(), domain: host, hostOnly: true, path: '/', secure: false, expires: null };
        for (const a of attrs) {
          const [k, ...v] = a.split('='); const key = k.trim().toLowerCase(), val = v.join('=').trim();
          if (key === 'domain' && val) { const d = val.replace(/^\./, '').toLowerCase(); if (host === d || host.endsWith('.' + d)) { c.domain = d; c.hostOnly = false; } else { c.reject = true; } }
          else if (key === 'path' && val.startsWith('/')) c.path = val;
          else if (key === 'secure') c.secure = true;
          else if (key === 'max-age' && /^-?\d+$/.test(val)) c.expires = now() + Number(val) * 1000;
          else if (key === 'expires' && c.expires === null) { const t = Date.parse(val); if (!Number.isNaN(t)) c.expires = t; }
        }
        if (c.reject) continue;
        const j = jar(site), k = `${c.domain};${c.path};${c.name}`;
        if (!live(c)) { j.delete(k); continue; }
        j.set(k, c); while (j.size > maxCookies) j.delete(j.keys().next().value);
      }
    },
    header(url) {
      const u = new URL(url), host = u.hostname.toLowerCase(), j = jars.get(siteOf(host)); if (!j) return '';
      const out = [];
      for (const [k, c] of j) {
        if (!live(c)) { j.delete(k); continue; }
        if (c.hostOnly ? host !== c.domain : !(host === c.domain || host.endsWith('.' + c.domain))) continue;
        if (!u.pathname.startsWith(c.path)) continue;
        if (c.secure && u.protocol !== 'https:') continue;
        out.push(`${c.name}=${c.value}`);
      }
      return out.join('; ');
    },
    list() { return [...jars].map(([site, j]) => ({ site, cookies: [...j.values()].filter(live).length })).filter(s => s.cookies > 0); },
    clear(site) { if (site === undefined || site === '*') { const n = jars.size; jars.clear(); return n; } return jars.delete(siteOf(site)) ? 1 : 0; },
  };
}
