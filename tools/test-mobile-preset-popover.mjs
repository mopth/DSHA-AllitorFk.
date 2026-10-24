// AllitorFk：模式（agent preset）菜单是锚定小卡片，不是全宽底部弹层。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../app/src/main/assets/builtin-plugins/dsh-web-mobile/lib/client.js', import.meta.url), 'utf8');
assert.ok(src.includes('DSHA_PRESET_POPOVER_V1'), 'popover patch applied');
assert.ok(!src.includes('手机端紧凑底部弹层'), 'bottom-sheet block removed');
const rules = [...src.matchAll(/\[role="menu"\]:has\(\[class\*="cubgiG_item"\]\)\s*\{([^}]*)\}/g)].map(m => m[1]);
assert.equal(rules.length, 1, 'exactly one shell rule');
const shell = rules[0];
for (const bad of [/bottom:\s*12px/, /left:\s*50%/, /translateX\(-50%\)/, /top:\s*auto/, /width:\s*min\(100%/])
  assert.ok(!bad.test(shell), 'shell must not pin/centre: ' + bad);
for (const good of ['bottom: auto', 'transform: none', 'width: max-content', 'min-width: 0', 'max-height: min(60dvh, 360px)'])
  assert.ok(shell.includes(good), 'shell missing: ' + good);
assert.ok(/cubgiG_item"\]\)::before \{ content: none !important; \}/.test(src), 'no drag handle');
assert.ok(/cubgiG_itemDesc"\] \{[^}]*text-overflow: ellipsis/.test(src), 'one-line description');
console.log('ok   preset menu: anchored host popover (no bottom pin, no centring, content width, one-line desc)');
