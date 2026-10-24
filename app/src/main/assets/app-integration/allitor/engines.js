// Plugin engines.dsh compatibility (B4, own implementation).
import { satisfies } from './semver.js';

/** Declared dsh range: engines.dsh first (plugin-market convention), then peerDependencies. */
export function declaredRange(pkg) {
  const e = pkg?.engines?.dsh;
  if (typeof e === 'string' && e.trim()) return { field: 'engines.dsh', range: e.trim() };
  const p = pkg?.peerDependencies?.['@deepseek-ai/dsh'];
  if (typeof p === 'string' && p.trim()) return { field: 'peerDependencies', range: p.trim() };
  return null;
}

export function checkEngines(pkg, dshVersion) {
  const declared = declaredRange(pkg);
  if (!declared) return { state: 'undeclared', message: '插件未声明 engines.dsh，兼容性未知' };
  const ok = satisfies(dshVersion, declared.range);
  if (ok === null) return { state: 'invalid', ...declared, message: `${declared.field} 范围无法解析：${declared.range}` };
  return ok ? { state: 'compatible', ...declared, message: `兼容：${declared.field}=${declared.range}，当前 dsh ${dshVersion}` }
    : { state: 'incompatible', ...declared, message: `不兼容：${declared.field}=${declared.range}，当前 dsh ${dshVersion}` };
}
