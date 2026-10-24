// D3: the WebView shim only fills gaps and never replaces native implementations.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const src = readFileSync(new URL('../app/src/main/assets/app-integration/client.js', import.meta.url), 'utf8');
const m = /\(function installWebViewShim\(g\) \{[\s\S]*?\n {2}\}\)\(window\);/.exec(src);
assert.ok(m, 'shim present');
const ctx = vm.createContext({ setTimeout, clearTimeout });
vm.runInContext('delete Object.hasOwn; delete Array.prototype.at; delete Array.prototype.findLast; delete Promise.withResolvers; var window = globalThis; var marker = function(){}; globalThis.structuredClone = marker;', ctx);
vm.runInContext(m[0], ctx);
assert.equal(vm.runInContext('Object.hasOwn({a:1},"a") && [1,2,3].at(-1) === 3 && [1,2,3].findLast(x => x < 3) === 2', ctx), true);
assert.equal(vm.runInContext('typeof Promise.withResolvers().resolve', ctx), 'function');
assert.equal(vm.runInContext('typeof requestIdleCallback', ctx), 'function');
assert.equal(vm.runInContext('structuredClone === marker', ctx), true, 'native/existing kept');
assert.equal(vm.runInContext('Object.keys(Array.prototype).length', ctx), 0, 'non-enumerable');
console.log('webview shim tests passed');
