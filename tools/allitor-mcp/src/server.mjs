#!/usr/bin/env node
// allitor-mcp: AllitorFk agent tools over the Web process's Unix-socket agent channel.
import net from 'node:net';
import { readFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { createRegistry, createProtocol, serveStdio } from './mcp-core.mjs';

export const VERSION = '0.1.0';
const DIR = process.env.ALLITOR_AGENT_DIR || '/root/.dsh/allitor';

export function readToken(dir = DIR) {
  const file = join(dir, 'agent.token'); const st = lstatSync(file);
  if (!st.isFile() || st.isSymbolicLink() || (st.mode & 0o077) !== 0 || st.size > 128) throw new Error('AGENT_TOKEN_FILE');
  return readFileSync(file, 'ascii').trim();
}

export function call(op, args = {}, dir = DIR) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(join(dir, 'agent.sock')); let buf = '';
    sock.setTimeout(90_000, () => { sock.destroy(); reject(new Error('AGENT_TIMEOUT')); });
    sock.on('connect', () => { try { sock.write(JSON.stringify({ id: 1, token: readToken(dir), op, args }) + '\n'); } catch (e) { sock.destroy(); reject(e); } });
    sock.on('data', d => { buf += d; const nl = buf.indexOf('\n'); if (nl < 0) return; sock.end();
      try { const r = JSON.parse(buf.slice(0, nl)); r.ok ? resolve(r.result) : reject(new Error(r.error)); } catch (e) { reject(e); } });
    sock.on('error', e => reject(new Error('AGENT_CHANNEL_UNAVAILABLE: ' + e.code)));
  });
}

const S = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const str = (maxLength = 2048) => ({ type: 'string', maxLength });
export function buildRegistry(rpc = call) {
  const r = createRegistry();
  const t = (name, tier, description, inputSchema, op, map = a => a) => r.add({ name, tier, description, inputSchema, run: a => rpc(op, map(a)) });
  t('allitor_takeover_request', 'request', '请求用户授权 AI 接管（browser=只读文本浏览；browser_full=执行 JS/POST 表单/按站点登录会话/截图/下载，最长 60 分钟；preview=静态页预览）。用户在 AllitorFk 控制台 /__dsha/allitor 批准后才生效，可随时撤销。',
    S({ scope: { type: 'string', enum: ['browser', 'browser_full', 'preview'] }, reason: str(500), minutes: { type: 'integer', minimum: 1, maximum: 240 } }, ['scope', 'reason']), 'takeover.request');
  t('allitor_takeover_status', 'read', '查询授权请求状态。', S({ id: str(64) }, ['id']), 'takeover.status');
  t('allitor_preview_start', 'act', '把沙箱内目录作为静态站点预览（需 preview 授权）；返回用户可打开并框选批注的页面路径。', S({ dir: str(1024), entry: str(256) }, ['dir']), 'preview.start');
  t('allitor_preview_stop', 'act', '停止预览。', S({ id: str(64) }, ['id']), 'preview.stop');
  t('allitor_annotations_take', 'read', '取回用户在预览页框选的新批注。', S({}), 'annotations.take');
  t('browser_open', 'act', '打开公网 http(s) 页面（需 browser 授权；拒绝内网/回环地址）。engine=chromium 渲染 JS（需 browser_full 且设备有 Chromium）。', S({ url: str(2048), engine: { type: 'string', enum: ['text', 'chromium'] } }, ['url']), 'browser.open', a => ({ url: a.url, engine: a.engine }));
  t('browser_read', 'read', '读取当前页正文（分页）。', S({ offset: { type: 'integer', minimum: 0, maximum: 10_000_000 }, limit: { type: 'integer', minimum: 100, maximum: 20000 } }), 'browser.read');
  t('browser_links', 'read', '列出当前页链接（可按文本过滤）。', S({ filter: str(200) }), 'browser.links');
  t('browser_follow', 'act', '按编号打开链接。', S({ index: { type: 'integer', minimum: 0, maximum: 100000 } }, ['index']), 'browser.follow');
  t('browser_back', 'act', '后退。', S({}), 'browser.back');
  t('browser_find', 'read', '在当前页查找文本。', S({ text: str(200) }, ['text']), 'browser.find');
  t('browser_forms', 'read', '列出当前页表单。', S({}), 'browser.forms');
  t('browser_submit', 'act', '提交表单；POST 需 browser_full。values 为 JSON 对象字符串。', S({ form: { type: 'integer', minimum: 0, maximum: 1000 }, values: str(8192) }, ['form']), 'browser.submit',
    a => ({ index: a.form, values: a.values ? JSON.parse(a.values) : {} }));
  t('browser_download', 'act', '下载链接或 URL 到沙箱 /root/allitor-downloads（需 browser_full，50 MiB 上限）。', S({ url: str(2048), index: { type: 'integer', minimum: 0, maximum: 100000 } }), 'browser.download');
  t('browser_eval', 'act', '在 Chromium 当前页执行 JS 并返回结果（需 browser_full）。', S({ expression: str(20000) }, ['expression']), 'browser.eval');
  t('browser_screenshot', 'act', '截取 Chromium 当前页 PNG 到沙箱（需 browser_full）。', S({}), 'browser.screenshot');
  t('browser_sessions', 'read', '列出按站点隔离的登录会话。', S({}), 'browser.sessions');
  t('browser_session_clear', 'act', '清除某站点（或 * 全部）的登录会话。', S({ site: str(255) }), 'browser.session_clear');
  t('browser_status', 'read', '浏览器与授权状态。', S({}), 'browser.status');
  return r;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('/allitor-mcp')) {
  if (process.argv.includes('--version')) { console.log('allitor-mcp ' + VERSION); process.exit(0); }
  serveStdio(createProtocol({ registry: buildRegistry(), info: { name: 'allitor-mcp', version: VERSION } }));
}
