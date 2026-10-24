// Second factor for takeover approval (own implementation).
// The DSH cookie secret is readable inside proot, so a cookie alone does not prove a human clicked.
// Approval needs a tap on a dedicated native dialog (/app/allitor/approve) that renders the request
// fields itself (id, scope, minutes) and, on a genuine tap, signs
//   allitor-approval-v1|id|scope|minutes|nonce
// with a non-exportable Android Keystore EC P-256 key. This side only holds the public key (pinned at
// process start) and a fresh nonce, so a squatter on 127.0.0.1:3190 or a forged "批准" body cannot approve.
// Fails closed on any error.
import { lstatSync, readFileSync } from 'node:fs';
import { createPublicKey, randomBytes, verify } from 'node:crypto';
import http from 'node:http';

export const APPROVE = '批准', DENY = '拒绝';
export const PUBKEY_FILE = '/root/.dsh/.allitor_approval_pub';

function secretFile(file, max) {
  const st = lstatSync(file);
  if (!st.isFile() || st.isSymbolicLink() || (st.mode & 0o022) !== 0 || st.size > max) throw new Error('BAD_FILE ' + file);
  return readFileSync(file, 'ascii').trim();
}

export function loadPublicKey(file = PUBKEY_FILE) {
  const b64 = secretFile(file, 512);
  if (!/^[A-Za-z0-9+/=]{80,400}$/.test(b64)) throw new Error('APPROVAL_PUBKEY_FORMAT');
  const key = createPublicKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'spki' });
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new Error('APPROVAL_PUBKEY_TYPE');
  return key;
}

export function approvalMessage({ id, scope, minutes }, nonce) {
  return `allitor-approval-v1|${id}|${scope}|${minutes}|${nonce}`;
}

/** Pure verification; exported for tests. */
export function verifyApproval(publicKey, request, nonce, reply) {
  if (!reply || reply.decision !== 'approved' || typeof reply.sig !== 'string') return false;
  if (reply.id !== request.id || reply.nonce !== nonce) return false;
  if (!/^[A-Za-z0-9+/=]{16,200}$/.test(reply.sig)) return false;
  try {
    return verify('sha256', Buffer.from(approvalMessage(request, nonce), 'utf8'), publicKey, Buffer.from(reply.sig, 'base64'));
  } catch { return false; }
}

export function questionFor(r, scopes) { // kept for display/tests; the native dialog renders its own text
  const label = scopes[r.scope]?.zh ?? r.scope;
  return `AllitorFk：是否批准 AI 接管？\n请求 ID：${r.id}\n权限：${r.scope}（${label}）\n时长：${r.minutes} 分钟\nAI 自述理由（未经核实）：${String(r.reason).slice(0, 300)}`;
}

/** Factory pinning the verification key once (at web start) so later file swaps are ignored. */
export function createNativeApprover({ port = 3190, tokenFile = '/root/.dsh/.bridge_token', pubKeyFile = PUBKEY_FILE, timeoutMs = 130_000, publicKey } = {}) {
  let pinned = publicKey ?? null;
  if (!pinned) { try { pinned = loadPublicKey(pubKeyFile); } catch { pinned = null; } }
  return function nativeApprove(request) {
    return new Promise((resolve, reject) => {
      if (!pinned) { try { pinned = loadPublicKey(pubKeyFile); } catch (e) { return reject(new Error('NATIVE_APPROVAL_UNAVAILABLE: ' + e.message)); } }
      let token; try { token = secretFile(tokenFile, 129); } catch (e) { return reject(new Error('NATIVE_APPROVAL_UNAVAILABLE: ' + e.message)); }
      const nonce = randomBytes(16).toString('hex');
      const path = '/app/allitor/approve?' + new URLSearchParams({ id: request.id, scope: request.scope, minutes: String(request.minutes), nonce, reason: String(request.reason ?? '').slice(0, 300) });
      const req = http.request({ host: '127.0.0.1', port, path, method: 'GET', headers: { 'X-Token': token }, agent: false, timeout: timeoutMs }, res => {
        let body = ''; res.setEncoding('utf8');
        res.on('data', d => { body += d; if (body.length > 4096) req.destroy(); });
        res.on('end', () => {
          let reply = null; try { reply = JSON.parse(body); } catch {}
          resolve(res.statusCode === 200 && verifyApproval(pinned, request, nonce, reply));
        });
      });
      req.on('timeout', () => req.destroy(new Error('NATIVE_APPROVAL_TIMEOUT')));
      req.on('error', e => reject(new Error('NATIVE_APPROVAL_UNAVAILABLE: ' + e.message)));
      req.end();
    });
  };
}
