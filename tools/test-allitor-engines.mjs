// AllitorFk B4: engines.dsh range evaluation used by the Allitor page (node tools/test-allitor-engines.mjs).
import assert from 'node:assert/strict';
import { satisfies } from '../app/src/main/assets/app-integration/allitor/semver.js';
import { checkEngines, declaredRange } from '../app/src/main/assets/app-integration/allitor/engines.js';
const V = '0.2.1-rc.3';
for (const [range, want] of [['>=0.2.1-rc.1', true], ['^0.2.0', false], ['0.2.1-rc.3', true], ['>=0.2.0 <0.3.0', false],
  ['>=0.2.1-rc.3 <0.3.0', true], ['0.2.1-rc.2 || 0.2.1-rc.3', true], ['*', false], ['<=0.2.1-rc.2', false], ['bad range!', null]])
  assert.equal(satisfies(V, range), want, range);
for (const [v, range, want] of [['0.2.1', '^0.2.0', true], ['0.3.0', '^0.2.0', false], ['1.2.3', '1.x', true], ['1.2.3', '1.0.0 - 1.2', true],
  ['1.3.0', '1.0.0 - 1.2', false], ['0.0.3', '^0.0.3', true], ['0.0.4', '^0.0.3', false], ['0.2.9', '~0.2.1', true], ['0.3.0', '~0.2.1', false]])
  assert.equal(satisfies(v, range), want, v + ' ' + range);
assert.equal(declaredRange({ engines: { dsh: '>=0.2' }, peerDependencies: { '@deepseek-ai/dsh': '0.1.0' } }).field, 'engines.dsh');
assert.equal(checkEngines({}, V).state, 'undeclared');
assert.equal(checkEngines({ engines: { dsh: '^0.1.7' } }, V).state, 'incompatible');
assert.equal(checkEngines({ engines: { dsh: '>=0.2.1-rc.1 <0.3.0' } }, V).state, 'compatible');
assert.equal(checkEngines({ engines: { dsh: '??' } }, V).state, 'invalid');
console.log('PASS allitor engines');
