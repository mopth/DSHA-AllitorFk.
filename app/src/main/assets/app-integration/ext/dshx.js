// DSHA 离线扩展包（.dshx = gzip 包裹的 PAX tar）的安全解包器；独立实现，不复用任何第三方插件代码。
// 只接受普通文件与目录；拒绝绝对路径、..、空段、符号链接、硬链接、设备与 FIFO；
// 逐条计算 sha256，结束后与包内 SHA256SUMS 双向比对（多一条少一条都拒绝）。
import { createReadStream, mkdirSync, openSync, writeSync, closeSync, fsyncSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createGunzip } from 'node:zlib';
import { join } from 'node:path';

const BLOCK = 512;
const SEGMENT = /^[^\x00-\x1f\x7f/\\]+$/;
const MAX_ENTRY = 4 * 1024 * 1024 * 1024;

export function safeEntryName(name, pid) {
  if (typeof name !== 'string' || name.length === 0 || name.length > 4096) throw new Error('DSHX_PATH');
  const clean = name.endsWith('/') ? name.slice(0, -1) : name;
  const parts = clean.split('/');
  if (clean.startsWith('/') || parts.some(p => p === '' || p === '.' || p === '..' || !SEGMENT.test(p))) throw new Error('DSHX_PATH:' + name);
  const allowed = clean === 'dshx.json' || clean === 'SHA256SUMS' || clean === 'repo' || clean === 'licenses' || clean === 'tree'
    || /^repo\/[^/]+$/.test(clean) || clean.startsWith('licenses/')
    || ['tree/opt', 'tree/opt/dsha-ext', `tree/opt/dsha-ext/${pid}`].includes(clean) || clean.startsWith(`tree/opt/dsha-ext/${pid}/`);
  if (!allowed) throw new Error('DSHX_PATH_SCOPE:' + name);
  return clean;
}

function octal(buf, start, len) {
  const text = buf.toString('ascii', start, start + len).replace(/\0.*$/s, '').trim();
  if (text === '') return 0;
  if (!/^[0-7]+$/.test(text)) throw new Error('DSHX_HEADER_NUMBER');
  return parseInt(text, 8);
}

function checksumOk(header) {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += (i >= 148 && i < 156) ? 32 : header[i];
  return sum === octal(header, 148, 8);
}

function parsePax(body) {
  const out = {};
  let pos = 0;
  while (pos < body.length) {
    const space = body.indexOf(0x20, pos);
    if (space < 0) throw new Error('DSHX_PAX');
    const len = parseInt(body.toString('ascii', pos, space), 10);
    if (!Number.isSafeInteger(len) || len <= 0 || pos + len > body.length) throw new Error('DSHX_PAX');
    const record = body.toString('utf8', space + 1, pos + len - 1);
    const eq = record.indexOf('=');
    if (eq < 0) throw new Error('DSHX_PAX');
    out[record.slice(0, eq)] = record.slice(eq + 1);
    pos += len;
  }
  return out;
}

/**
 * 流式解包到 dest（必须是新建的空目录）。返回 {files:Map(name->sha256), dirs:Set}。
 * onProgress(bytes) 可选。
 */
export async function extractDshx(file, dest, pid, onProgress) {
  mkdirSync(dest, { recursive: false, mode: 0o700 });
  const files = new Map();
  const dirs = new Set();
  let pending = Buffer.alloc(0);
  let state = { kind: 'header' };
  let pax = null;
  let zeroBlocks = 0;
  let done = false;
  let read = 0;
  const startEntry = (header) => {
    if (!checksumOk(header)) throw new Error('DSHX_HEADER_CHECKSUM');
    const magic = header.toString('ascii', 257, 263);
    if (magic !== 'ustar\0' && magic !== 'ustar ') throw new Error('DSHX_HEADER_MAGIC');
    const type = String.fromCharCode(header[156] || 48);
    let name = header.toString('utf8', 0, 100).replace(/\0.*$/s, '');
    const prefix = header.toString('utf8', 345, 500).replace(/\0.*$/s, '');
    if (prefix) name = prefix + '/' + name;
    let size = octal(header, 124, 12);
    const mode = octal(header, 100, 8);
    if (pax) { if (pax.path !== undefined) name = pax.path; if (pax.size !== undefined) size = Number(pax.size); pax = null; }
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_ENTRY) throw new Error('DSHX_SIZE');
    if (type === 'x') return { kind: 'pax', size, left: size, chunks: [] };
    if (type === 'g') return { kind: 'skip', size, left: size };
    const clean = safeEntryName(name, pid);
    if (type === '5') {
      if (size !== 0) throw new Error('DSHX_DIR_SIZE');
      mkdirSync(join(dest, clean), { recursive: true, mode: 0o755 });
      dirs.add(clean);
      return { kind: 'header' };
    }
    if (type !== '0') throw new Error('DSHX_ENTRY_TYPE:' + type + ':' + clean);
    if (files.has(clean)) throw new Error('DSHX_DUPLICATE:' + clean);
    const parent = clean.includes('/') ? clean.slice(0, clean.lastIndexOf('/')) : '';
    if (parent) mkdirSync(join(dest, parent), { recursive: true, mode: 0o755 });
    // wx：目标必须不存在，杜绝借既有链接写到暂存目录之外。
    const fd = openSync(join(dest, clean), 'wx', (mode & 0o111) ? 0o755 : 0o644);
    return { kind: 'file', name: clean, size, left: size, fd, hash: createHash('sha256') };
  };
  const consume = (buf) => {
    let off = 0;
    while (off < buf.length && !done) {
      if (state.kind === 'header') {
        const need = BLOCK - pending.length;
        const take = Math.min(need, buf.length - off);
        pending = Buffer.concat([pending, buf.subarray(off, off + take)]);
        off += take;
        if (pending.length < BLOCK) return;
        const header = pending; pending = Buffer.alloc(0);
        if (header.every(b => b === 0)) { if (++zeroBlocks === 2) done = true; continue; }
        if (zeroBlocks) throw new Error('DSHX_TRAILER');
        state = startEntry(header);
        if (state.kind !== 'header' && state.size === 0) state = finish(state);
        continue;
      }
      if (state.padLeft === undefined) state.padLeft = Math.ceil(state.size / BLOCK) * BLOCK - state.size;
      const take = Math.min(state.left + state.padLeft, buf.length - off);
      const dataTake = Math.min(state.left, take);
      if (dataTake) {
        const slice = buf.subarray(off, off + dataTake);
        if (state.kind === 'file') { writeSync(state.fd, slice); state.hash.update(slice); }
        else if (state.kind === 'pax') state.chunks.push(Buffer.from(slice));
      }
      state.left -= dataTake;
      state.padLeft -= take - dataTake;
      off += take;
      if (state.left === 0 && state.padLeft === 0) state = finish(state);
    }
  };
  const finish = (s) => {
    if (s.kind === 'file') { fsyncSync(s.fd); closeSync(s.fd); files.set(s.name, s.hash.digest('hex')); }
    else if (s.kind === 'pax') pax = parsePax(Buffer.concat(s.chunks));
    return { kind: 'header' };
  };
  try {
    const raw = createReadStream(file, { highWaterMark: 1 << 20 });
    const gunzip = createGunzip({ chunkSize: 1 << 20 });
    raw.on('data', (c) => { read += c.length; });
    raw.on('error', (e) => gunzip.destroy(e));
    for await (const chunk of raw.pipe(gunzip)) {
      consume(chunk);
      onProgress?.(read);
      if (done) { raw.destroy(); break; }
    }
  } finally {
    if (state.kind === 'file') try { closeSync(state.fd); } catch {}
  }
  if (!done) throw new Error('DSHX_TRUNCATED');
  return { files, dirs };
}

/** 包内 SHA256SUMS 与实际解出的文件必须一一对应。 */
export function verifySums(sumsText, files) {
  const listed = new Map();
  for (const line of sumsText.split('\n')) {
    if (!line) continue;
    const m = /^([a-f0-9]{64})  (.+)$/.exec(line);
    if (!m || listed.has(m[2])) throw new Error('DSHX_SUMS_FORMAT');
    listed.set(m[2], m[1]);
  }
  for (const [name, sum] of listed) if (files.get(name) !== sum) throw new Error('DSHX_SUM_MISMATCH:' + name);
  for (const name of files.keys()) if (name !== 'SHA256SUMS' && !listed.has(name)) throw new Error('DSHX_UNLISTED:' + name);
}
