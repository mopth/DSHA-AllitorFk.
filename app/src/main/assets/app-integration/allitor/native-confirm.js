// Second factor for takeover approval (own implementation). The DSH browser-session signing secret lives in
// /root/.dsh/.credentials.yaml inside the same proot the agent's shell runs in, so a cookie alone does not
// prove a human clicked. Approval therefore also requires a tap on a native Android dialog shown by the
// host app (outside proot) through the device bridge's /app/ask. Fails closed when the bridge is unavailable.
import { lstatSync, readFileSync } from 'node:fs';
import http from 'node:http';

export const APPROVE = '批准', DENY = '拒绝';

function bridgeToken(file = '/root/.dsh/.bridge_token') {
  const st = lstatSync(file);
  if (!st.isFile() || st.isSymbolicLink() || (st.mode & 0o077) !== 0 || st.size > 129) throw new Error('BRIDGE_TOKEN_FILE');
  return readFileSync(file, 'ascii').trim();
}

export function questionFor(r, scopes) {
  const label = scopes[r.scope]?.zh ?? r.scope;
  return `AllitorFk：是否批准 AI 接管？\n权限：${r.scope}（${label}）\n时长：${r.minutes} 分钟\nAI 自述理由（未经核实）：${String(r.reason).slice(0, 300)}`;
}

export function nativeConfirm(question, { port = 3190, tokenFile, timeoutMs = 130_000 } = {}) {
  return new Promise((resolve, reject) => {
    let token; try { token = bridgeToken(tokenFile); } catch (e) { return reject(new Error('NATIVE_CONFIRM_UNAVAILABLE: ' + e.message)); }
    const path = '/app/ask?' + new URLSearchParams({ q: question, options: `${APPROVE}|${DENY}` });
    const req = http.request({ host: '127.0.0.1', port, path, method: 'GET', headers: { 'X-Token': token }, agent: false, timeout: timeoutMs }, res => {
      let body = ''; res.setEncoding('utf8');
      res.on('data', d => { body += d; if (body.length > 4096) req.destroy(); });
      res.on('end', () => resolve(res.statusCode === 200 && body.trim() === APPROVE));
    });
    req.on('timeout', () => req.destroy(new Error('NATIVE_CONFIRM_TIMEOUT')));
    req.on('error', e => reject(new Error('NATIVE_CONFIRM_UNAVAILABLE: ' + e.message)));
    req.end();
  });
}
