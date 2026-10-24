// Minimal layered MCP core (own implementation, inspired by the layering idea of ASM's McpServerCore):
//   transport (stdio line framing)  ->  protocol (JSON-RPC 2.0 + MCP lifecycle)  ->  registry (tools).
// The protocol layer never touches I/O; the registry never sees JSON-RPC. Each tool declares a tier
// ('read' | 'request' | 'act'); 'act' tools additionally rely on the host-side grant check.
export const PROTOCOL_VERSION = '2025-06-18';
export const TIERS = ['read', 'request', 'act'];

export function createRegistry() {
  const tools = new Map();
  return {
    add(def) {
      if (!/^[a-z][a-z0-9_]{1,63}$/.test(def.name) || tools.has(def.name)) throw new Error('TOOL_NAME ' + def.name);
      if (!TIERS.includes(def.tier)) throw new Error('TOOL_TIER ' + def.name);
      tools.set(def.name, def); return this;
    },
    list() { return [...tools.values()].map(t => ({ name: t.name, description: `[${t.tier}] ${t.description}`, inputSchema: t.inputSchema ?? { type: 'object', properties: {}, additionalProperties: false } })); },
    get(name) { return tools.get(name); },
  };
}

function validate(schema, args) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return 'arguments must be an object';
  const props = schema?.properties ?? {};
  for (const k of Object.keys(args)) if (!(k in props)) return `unknown argument ${k}`;
  for (const k of schema?.required ?? []) if (!(k in args)) return `missing argument ${k}`;
  for (const [k, v] of Object.entries(args)) {
    const p = props[k];
    if (p.type === 'string' && (typeof v !== 'string' || v.length > (p.maxLength ?? 4096))) return `${k} must be a string`;
    if (p.type === 'integer' && (!Number.isInteger(v) || v < (p.minimum ?? -Infinity) || v > (p.maximum ?? Infinity))) return `${k} out of range`;
    if (p.enum && !p.enum.includes(v)) return `${k} not allowed`;
  }
  return null;
}

export function createProtocol({ registry, info }) {
  let initialized = false;
  const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
  const err = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
  return async function handle(msg) {
    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return err(msg?.id ?? null, -32600, 'Invalid Request');
    const notification = !('id' in msg);
    if (notification) { if (msg.method === 'notifications/initialized') initialized = true; return null; }
    const { id, method, params = {} } = msg;
    if (method === 'initialize') return ok(id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: info });
    if (method === 'ping') return ok(id, {});
    if (method === 'tools/list') return ok(id, { tools: registry.list() });
    if (method === 'tools/call') {
      const tool = registry.get(params.name);
      if (!tool) return err(id, -32602, 'Unknown tool');
      const args = params.arguments ?? {};
      const bad = validate(tool.inputSchema, args);
      if (bad) return ok(id, { isError: true, content: [{ type: 'text', text: bad }] });
      try {
        const out = await tool.run(args);
        return ok(id, { content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out, null, 1) }] });
      } catch (e) { return ok(id, { isError: true, content: [{ type: 'text', text: String(e?.message ?? e).slice(0, 2000) }] }); }
    }
    void initialized;
    return err(id, -32601, 'Method not found');
  };
}

export function serveStdio(handle, { input = process.stdin, output = process.stdout, limit = 1 << 20 } = {}) {
  let buf = '';
  input.setEncoding('utf8');
  input.on('data', chunk => {
    buf += chunk;
    if (buf.length > limit) { buf = ''; output.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Message too large' } }) + '\n'); return; }
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg; try { msg = JSON.parse(line); } catch { output.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n'); continue; }
      Promise.resolve(handle(msg)).then(r => { if (r) output.write(JSON.stringify(r) + '\n'); });
    }
  });
}
