// Agent channel (own implementation): a Unix socket in a 0700 directory plus a 0600 token file.
// The MCP tool server inside the sandbox talks to the Web process here; it can ask for a takeover,
// read annotations and drive the text browser, but it has no operation that approves anything.
import net from 'node:net';
import { mkdirSync, writeFileSync, renameSync, chmodSync, lstatSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { tokenEquals } from './guard.js';

export function startAgentChannel({ dir = '/root/.dsh/allitor', ops, log = () => {} } = {}) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = lstatSync(dir);
  if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('AGENT_DIR');
  chmodSync(dir, 0o700);
  const token = randomBytes(32).toString('base64url');
  const tokenFile = join(dir, 'agent.token'), tmp = tokenFile + '.' + process.pid + '.tmp';
  writeFileSync(tmp, token, { mode: 0o600 }); renameSync(tmp, tokenFile);
  const sock = join(dir, 'agent.sock');
  try { if (lstatSync(sock).isSocket()) unlinkSync(sock); } catch {}
  const server = net.createServer(conn => {
    conn.setTimeout(120_000, () => conn.destroy());
    let buf = '';
    conn.on('data', async chunk => {
      buf += chunk.toString('utf8');
      if (buf.length > 256 * 1024) { conn.destroy(); return; }
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        let msg; try { msg = JSON.parse(line); } catch { conn.write(JSON.stringify({ ok: false, error: 'AGENT_JSON' }) + '\n'); continue; }
        const id = msg?.id ?? null;
        if (!tokenEquals(msg?.token, token)) { conn.write(JSON.stringify({ id, ok: false, error: 'AGENT_TOKEN' }) + '\n'); continue; }
        const op = ops[String(msg.op)];
        if (typeof op !== 'function') { conn.write(JSON.stringify({ id, ok: false, error: 'AGENT_OP' }) + '\n'); continue; }
        try { conn.write(JSON.stringify({ id, ok: true, result: await op(msg.args ?? {}) }) + '\n'); }
        catch (error) { conn.write(JSON.stringify({ id, ok: false, error: String(error?.message ?? error).slice(0, 500) }) + '\n'); }
      }
    });
    conn.on('error', () => {});
  });
  server.listen(sock, () => { try { chmodSync(sock, 0o600); } catch {} log('allitor agent channel ready'); });
  return { token, sock, tokenFile, close() { server.close(); try { unlinkSync(sock); } catch {} } };
}
