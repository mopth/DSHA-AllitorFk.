// T2 attack-path tests for the native signed takeover approval.
import assert from 'node:assert/strict';
import http from 'node:http';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNativeApprover, approvalMessage, verifyApproval, loadPublicKey } from '../app/src/main/assets/app-integration/allitor/native-confirm.js';

const ec = () => generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const native = ec(), attacker = ec();
const dir = mkdtempSync(join(tmpdir(), 'allitor-appr-'));
const tokenFile = join(dir, 'tok'); writeFileSync(tokenFile, 'a'.repeat(40)); chmodSync(tokenFile, 0o600);
const pubFile = join(dir, 'pub');
writeFileSync(pubFile, native.publicKey.export({ format: 'der', type: 'spki' }).toString('base64')); chmodSync(pubFile, 0o644);
const req = { id: '11111111-2222-4333-8444-555555555555', scope: 'browser_full', minutes: 60, reason: 'x' };

let behave; let lastQuery;
const server = http.createServer((q, r) => { const u = new URL(q.url, 'http://x'); lastQuery = Object.fromEntries(u.searchParams); behave(u, r); });
await new Promise(ok => server.listen(0, '127.0.0.1', ok));
const port = server.address().port;
const approve = createNativeApprover({ port, tokenFile, pubKeyFile: pubFile });
const signed = (key, id, scope, minutes, nonce) => sign('sha256', Buffer.from(approvalMessage({ id, scope, minutes }, nonce)), key).toString('base64');
const reply = (r, o) => { r.writeHead(200); r.end(JSON.stringify(o)); };

// 1. squatter answers the legacy plain "批准"
behave = (u, r) => { r.writeHead(200); r.end('批准'); };
assert.equal(await approve(req), false);
// 2. squatter signs with its own key
behave = (u, r) => reply(r, { decision: 'approved', id: req.id, nonce: u.searchParams.get('nonce'), sig: signed(attacker.privateKey, req.id, req.scope, req.minutes, u.searchParams.get('nonce')) });
assert.equal(await approve(req), false);
// 3. replay: valid native signature over an old nonce
const oldNonce = 'ab'.repeat(16); const oldSig = signed(native.privateKey, req.id, req.scope, req.minutes, oldNonce);
behave = (u, r) => reply(r, { decision: 'approved', id: req.id, nonce: u.searchParams.get('nonce'), sig: oldSig });
assert.equal(await approve(req), false);
// 4. signature for a different id / scope / minutes
behave = (u, r) => { const n = u.searchParams.get('nonce'); reply(r, { decision: 'approved', id: req.id, nonce: n, sig: signed(native.privateKey, req.id, 'browser', req.minutes, n) }); };
assert.equal(await approve(req), false);
behave = (u, r) => { const n = u.searchParams.get('nonce'); reply(r, { decision: 'approved', id: req.id, nonce: n, sig: signed(native.privateKey, req.id, req.scope, 240, n) }); };
assert.equal(await approve(req), false);
behave = (u, r) => { const n = u.searchParams.get('nonce'); reply(r, { decision: 'approved', id: 'other', nonce: n, sig: signed(native.privateKey, 'other', req.scope, req.minutes, n) }); };
assert.equal(await approve(req), false);
// 5. denied
behave = (u, r) => reply(r, { decision: 'denied', id: req.id, nonce: u.searchParams.get('nonce') });
assert.equal(await approve(req), false);
// 6. genuine native approval
behave = (u, r) => { const n = u.searchParams.get('nonce'); reply(r, { decision: 'approved', id: req.id, nonce: n, sig: signed(native.privateKey, req.id, req.scope, req.minutes, n) }); };
assert.equal(await approve(req), true);
assert.match(lastQuery.nonce, /^[0-9a-f]{32}$/); assert.equal(lastQuery.id, req.id); assert.equal(lastQuery.minutes, '60');
// 7. pubkey file swapped after pinning: attacker-signed reply still refused
writeFileSync(pubFile, attacker.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'));
behave = (u, r) => { const n = u.searchParams.get('nonce'); reply(r, { decision: 'approved', id: req.id, nonce: n, sig: signed(attacker.privateKey, req.id, req.scope, req.minutes, n) }); };
assert.equal(await approve(req), false);
// 8. no key available -> fail closed (reject)
const none = createNativeApprover({ port, tokenFile, pubKeyFile: join(dir, 'missing') });
await assert.rejects(none(req), /NATIVE_APPROVAL_UNAVAILABLE/);
// 9. non-EC key refused
const rsa = generateKeyPairSync('rsa', { modulusLength: 1024 });
const rsaFile = join(dir, 'rsa'); writeFileSync(rsaFile, rsa.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'));
assert.throws(() => loadPublicKey(rsaFile));
assert.equal(verifyApproval(native.publicKey, req, 'n', null), false);
server.close();
console.log('allitor native approval tests passed');
