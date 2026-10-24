// Sandbox static-page preview (d, own implementation).
// Serves one registered directory read-only under the signed-cookie Web origin, with a CSP sandbox
// so the page runs on an opaque origin (cannot read DSH cookies, storage or call DSH APIs).
import { lstatSync, realpathSync, openSync, fstatSync, readSync, closeSync, constants } from 'node:fs';
import { join, normalize, sep, extname } from 'node:path';
import { randomBytes } from 'node:crypto';

const TYPES = { '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.woff2': 'font/woff2', '.wasm': 'application/wasm' };
export const PREVIEW_CSP = "sandbox allow-scripts allow-forms allow-popups; default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'";
const MAX_FILE = 32 * 1024 * 1024;

export function createPreviews({ allowedRoots = ['/root', '/sdcard', '/storage', '/tmp'], max = 8 } = {}) {
  const items = new Map();
  return {
    start(dir, { entry = 'index.html' } = {}) {
      if (typeof dir !== 'string' || !dir.startsWith('/')) throw new Error('PREVIEW_DIR_ABSOLUTE');
      const st = lstatSync(dir);
      if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('PREVIEW_DIR');
      const real = realpathSync(dir);
      if (!allowedRoots.some(root => real === root || real.startsWith(root.endsWith(sep) ? root : root + sep))) throw new Error('PREVIEW_DIR_OUTSIDE');
      if (/(^|\/)\.(dsh|ssh|gnupg)(\/|$)/.test(real)) throw new Error('PREVIEW_DIR_PRIVATE');
      if (items.size >= max) items.delete(items.keys().next().value);
      const id = randomBytes(16).toString('base64url');
      const safeEntry = String(entry).replace(/^\/+/, '');
      if (safeEntry.split('/').includes('..')) throw new Error('PREVIEW_ENTRY');
      items.set(id, { id, root: real, entry: safeEntry, startedAt: Date.now() });
      return { id, root: real, entry: safeEntry };
    },
    stop(id) { return items.delete(String(id)); },
    list() { return [...items.values()]; },
    /** Resolve and read one file without following symlinks out of the root. */
    read(id, rel) {
      const item = items.get(String(id));
      if (!item) return { status: 404 };
      let path = decodeURIComponent(String(rel || item.entry)).replace(/^\/+/, '');
      if (path === '' || path.endsWith('/')) path += 'index.html';
      if (path.includes('\0') || path.split('/').some(p => p === '..')) return { status: 400 };
      const full = normalize(join(item.root, path));
      if (!full.startsWith(item.root + sep)) return { status: 400 };
      // every component must be a real (non-symlink) entry inside the root
      let cur = item.root;
      for (const part of path.split('/')) {
        cur = join(cur, part);
        let s; try { s = lstatSync(cur); } catch { return { status: 404 }; }
        if (s.isSymbolicLink()) return { status: 403 };
      }
      let fd;
      try {
        fd = openSync(full, constants.O_RDONLY | constants.O_NOFOLLOW);
        const s = fstatSync(fd);
        if (!s.isFile()) return { status: 404 };
        if (s.size > MAX_FILE) return { status: 413 };
        const buf = Buffer.alloc(s.size); let off = 0;
        while (off < s.size) { const n = readSync(fd, buf, off, s.size - off, off); if (n <= 0) break; off += n; }
        return { status: 200, body: buf.subarray(0, off), type: TYPES[extname(full).toLowerCase()] ?? 'application/octet-stream' };
      } catch { return { status: 404 }; } finally { if (fd !== undefined) closeSync(fd); }
    },
  };
}
