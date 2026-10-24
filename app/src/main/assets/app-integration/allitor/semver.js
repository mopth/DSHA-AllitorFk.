// Minimal semver range check for plugin engines.dsh (own implementation).
// Supports: exact, =, >, >=, <, <=, ^, ~, x/* wildcards, hyphen ranges, space-AND and || OR.
// Prereleases only satisfy comparators on the same major.minor.patch (npm semantics).
const RE = /^v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parse(v) {
  const m = RE.exec(String(v).trim());
  if (!m) return null;
  const n = s => (s === undefined || s === 'x' || s === '*') ? null : Number(s);
  return { major: Number(m[1]), minor: n(m[2]), patch: n(m[3]), pre: m[4] ? m[4].split('.') : [] };
}

function cmpPre(a, b) {
  if (!a.length && !b.length) return 0;
  if (!a.length) return 1;
  if (!b.length) return -1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === undefined) return -1;
    if (b[i] === undefined) return 1;
    const na = /^\d+$/.test(a[i]), nb = /^\d+$/.test(b[i]);
    if (na && nb) { const d = Number(a[i]) - Number(b[i]); if (d) return Math.sign(d); continue; }
    if (na) return -1;
    if (nb) return 1;
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

export function compare(a, b) {
  for (const k of ['major', 'minor', 'patch']) { const d = (a[k] ?? 0) - (b[k] ?? 0); if (d) return Math.sign(d); }
  return cmpPre(a.pre, b.pre);
}

function full(p) { return { major: p.major, minor: p.minor ?? 0, patch: p.patch ?? 0, pre: p.pre }; }

function expand(token) {
  // returns list of [op, version] comparators
  let m;
  if (token === '' || token === '*' || token === 'x') return [];
  if ((m = /^(\^|~)(.+)$/.exec(token))) {
    const p = parse(m[2]); if (!p) throw new Error('RANGE');
    const lo = full(p); let hi;
    if (m[1] === '^') {
      if (p.major > 0 || p.minor === null) hi = { major: p.major + 1, minor: 0, patch: 0, pre: ['0'], syn: true };
      else if (p.minor > 0 || p.patch === null) hi = { major: 0, minor: p.minor + 1, patch: 0, pre: ['0'], syn: true };
      else hi = { major: 0, minor: 0, patch: p.patch + 1, pre: ['0'], syn: true };
    } else {
      hi = upper(p.minor === null ? p : { ...p, patch: null });
    }
    return [['>=', lo], ['<', hi]];
  }
  if ((m = /^(>=|<=|>|<|=)?\s*(.+)$/.exec(token))) {
    const p = parse(m[2]); if (!p) throw new Error('RANGE');
    const op = m[1] || '=';
    if (p.minor === null || p.patch === null) {
      const lo = full(p);
      const hi = upper(p);
      if (op === '=') return [['>=', lo], ['<', hi]];
      if (op === '>') return [['>=', hi]];
      if (op === '<=') return [['<', hi]];
      return [[op, lo]];
    }
    return [[op, full(p)]];
  }
  throw new Error('RANGE');
}

function test(op, v, c) {
  const d = compare(v, c);
  return op === '=' ? d === 0 : op === '>' ? d > 0 : op === '>=' ? d >= 0 : op === '<' ? d < 0 : d <= 0;
}

function upper(p) {
  // exclusive upper bound for a partial version; marked synthetic so it never admits prereleases
  return p.minor === null ? { major: p.major + 1, minor: 0, patch: 0, pre: ['0'], syn: true }
    : { major: p.major, minor: p.minor + 1, patch: 0, pre: ['0'], syn: true };
}

function comparators(text) {
  const hy = /^(\S+)\s+-\s+(\S+)$/.exec(text);
  if (hy) {
    const a = parse(hy[1]), b = parse(hy[2]);
    if (!a || !b) throw new Error('RANGE');
    return [['>=', full(a)], b.minor === null || b.patch === null ? ['<', upper(b)] : ['<=', full(b)]];
  }
  return text.replace(/(>=|<=|>|<|=|\^|~)\s+/g, '$1').split(/\s+/).flatMap(expand);
}

/** true / false, or null when the range cannot be parsed. */
export function satisfies(version, range) {
  const v = parse(version);
  if (!v || v.minor === null || v.patch === null || typeof range !== 'string' || range.length > 256) return null;
  try {
    return range.split('||').some(part => {
      const comps = comparators(part.trim());
      if (!comps.every(([op, c]) => test(op, v, c))) return false;
      if (!v.pre.length) return true;
      return comps.some(([, c]) => !c.syn && c.pre.length && c.major === v.major && c.minor === v.minor && c.patch === v.patch);
    });
  } catch { return null; }
}
