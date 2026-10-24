// F3/F4: tool-duration badges and the max-tokens "continue" button (DOM-observer only, no host node edits).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
class El {
  constructor(tag, attrs = {}) { this.tagName = tag; this.attrs = { ...attrs }; this.children = []; this.parentElement = null; this.textContent = ''; this.listeners = {}; }
  setAttribute(k, v) { this.attrs[k] = String(v); } getAttribute(k) { return this.attrs[k] ?? null; } hasAttribute(k) { return k in this.attrs; }
  appendChild(c) { c.parentElement = this; this.children.push(c); return c; }
  remove() { const p = this.parentElement; if (p) p.children = p.children.filter(x => x !== this); this.parentElement = null; }
  addEventListener(t, f) { this.listeners[t] = f; }
  *walk() { for (const c of this.children) { yield c; yield* c.walk(); } }
  matches(sel) {
    if (sel === '[data-chat-call-id]') return this.hasAttribute('data-chat-call-id');
    if (sel === '[data-tool][data-state]') return this.hasAttribute('data-tool') && this.hasAttribute('data-state');
    if (sel === '[data-dsha-tool-duration]') return this.hasAttribute('data-dsha-tool-duration');
    if (sel === '[data-dsha-maxtokens-continue]') return this.hasAttribute('data-dsha-maxtokens-continue');
    if (sel === '[class*="_maxTokensTitle"]') return String(this.attrs.class || '').includes('_maxTokensTitle');
    throw new Error('sel ' + sel);
  }
  querySelectorAll(sel) { return [...this.walk()].filter(e => e.matches(sel)); }
  querySelector(sel) {
    if (sel.startsWith(':scope > ')) { const s = sel.slice(9); return this.children.find(c => c.matches(s)) ?? null; }
    return this.querySelectorAll(sel)[0] ?? null;
  }
}
const body = new El('body'), head = new El('head');
const document = { body, head, querySelectorAll: s => body.querySelectorAll(s), createElement: t => new El(t), querySelector: () => null, documentElement: new El('html') };
let mod;
const sandbox = { document, sessionStorage: { getItem: () => null, setItem() {} }, setInterval: () => 0, clearInterval() {}, setTimeout, clearTimeout,
  requestAnimationFrame: f => f(), MutationObserver: class { constructor(f) { this.f = f; } observe() {} disconnect() {} } };
sandbox.window = sandbox; sandbox.window.__ModuleLoader__ = { load: ({ factory }) => { mod = factory(); } };
vm.createContext(sandbox);
vm.runInContext(readFileSync(new URL('../app/src/main/assets/app-integration/client.js', import.meta.url), 'utf8'), sandbox);
assert.equal(mod.formatDuration(850), '850ms'); assert.equal(mod.formatDuration(2340), '2.3s'); assert.equal(mod.formatDuration(125000), '2m5s');
let t = 1000;
const row = body.appendChild(new El('div', { 'data-chat-call-id': 'c1' })), tool = row.appendChild(new El('div', { 'data-tool': 'bash', 'data-state': 'running' }));
const old = body.appendChild(new El('div', { 'data-chat-call-id': 'c0' })); old.appendChild(new El('div', { 'data-tool': 'fs', 'data-state': 'ok' }));
const off = mod.installToolDurations(document, () => t);
const badge = () => row.querySelector(':scope > [data-dsha-tool-duration]');
assert.match(badge().textContent, /…$/, 'live badge while running');
assert.equal(old.querySelector(':scope > [data-dsha-tool-duration]'), null, 'no badge for calls finished before observation');
t = 3500; tool.setAttribute('data-state', 'ok');
// trigger a rescan via a second install-less path: call the observer callback indirectly by re-installing is not needed;
// the scan is exported through the interval/observer, so simulate by installing a fresh observer pass:
off(); const off2 = mod.installToolDurations(document, () => t); void off2;
assert.equal(badge(), null, 'fresh install has no start time for an already-finished call');
// full lifecycle in one install
const row2 = body.appendChild(new El('div', { 'data-chat-call-id': 'c2' })), tool2 = row2.appendChild(new El('div', { 'data-tool': 'web', 'data-state': 'preparing' }));
let observer; sandbox.MutationObserver = class { constructor(f) { observer = f; } observe() {} disconnect() {} };
vm.runInContext('void 0', sandbox);
t = 10_000; const off3 = mod.installToolDurations(document, () => t);
t = 12_500; tool2.setAttribute('data-state', 'error'); observer();
assert.equal(row2.querySelector(':scope > [data-dsha-tool-duration]').textContent, '⏱ 2.5s');
off3(); assert.equal(body.querySelectorAll('[data-dsha-tool-duration]').length, 0, 'cleanup removes badges');
// F4: continue button appends "继续" to the draft, never sends
const notice = body.appendChild(new El('div')); notice.appendChild(new El('div', { class: 'Sixlwa_maxTokensTitle' }));
const calls = [];
const ctx = { sessions: { list: { getSnapshot: () => ({ byId: { s1: { id: 's1', retainedBy: { mainView: 1 } } } }) }, binding: id => ({ sessionId: id }) },
  conversation: { input: { requestDraftInitialization: (b, o) => calls.push([b.sessionId, o]) } } };
const off4 = mod.installMaxTokensContinue(ctx, document);
const btn = body.querySelector('[data-dsha-maxtokens-continue]'); assert.ok(btn);
btn.listeners.click();
assert.equal(JSON.stringify(calls), JSON.stringify([['s1', { prompt: '继续', whenDraftExists: 'append' }]]));
mod.installMaxTokensContinue(ctx, document); assert.equal(body.querySelectorAll('[data-dsha-maxtokens-continue]').length, 1, 'idempotent');
off4();
console.log('tool duration + max-tokens continue tests passed');
