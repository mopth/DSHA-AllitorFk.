// rc.3 non-blockers: browser_full cookies wiped when the grant is revoked/expires; trailing-dot local names refused.
import assert from 'node:assert/strict';
import { createAllitor } from '../app/src/main/assets/app-integration/allitor/routes.js';
import { createTakeover } from '../app/src/main/assets/app-integration/allitor/takeover.js';
import { createSessions } from '../app/src/main/assets/app-integration/allitor/sessions.js';
import { checkUrl } from '../app/src/main/assets/app-integration/allitor/browser.js';

let t = 1_000_000;
const takeover = createTakeover({ now: () => t });
const sessions = createSessions({ now: () => t });
const core = createAllitor({ takeover, sessions, engine: null, agent: false, fullSweepMs: 3_600_000 });
const tick = () => new Promise(r => setTimeout(r, 5));

const grant = () => { const r = takeover.request({ scope: 'browser_full', reason: '登录', minutes: 30 }); takeover.decide(r.id, true); return r; };
// revoke clears
let r = grant(); core.watchFull();
sessions.store('https://example.com/', 'sid=1; Path=/');
assert.ok(sessions.list().length > 0);
takeover.revoke(r.id); await tick();
assert.equal(sessions.list().length, 0, 'revoke must clear sessions');
// expiry clears (no event fires; the periodic sweep calls watchFull)
r = grant(); core.watchFull();
sessions.store('https://example.com/', 'sid=2; Path=/');
t += 31 * 60_000; core.watchFull(); await tick();
assert.equal(sessions.list().length, 0, 'expiry must clear sessions');
core.close();

for (const u of ['http://localhost./', 'http://foo.localhost../', 'http://printer.local./', 'http://db.internal./', 'http://LOCALHOST./'])
  assert.throws(() => checkUrl(u), /PRIVATE|URL/, u);
console.log('allitor session autoclear + trailing-dot tests passed');
