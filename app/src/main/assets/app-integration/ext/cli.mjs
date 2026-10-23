#!/usr/bin/env node
// 与 App 内扩展中心同一套代码的命令行入口（盒内 qemu/chroot 验证与救援用）。
// 用法：node cli.mjs list | activate <id> | remove <id> | import <file> <id>
import { createReadStream } from 'node:fs';
import { createExtensionManager } from './manager.js';

const [cmd, a, b] = process.argv.slice(2);
const manager = createExtensionManager({ onLog: (line) => process.stderr.write(line + '\n') });
try {
  if (cmd === 'list') console.log(JSON.stringify(manager.list(), null, 1));
  else if (cmd === 'activate') await manager.activate(a);
  else if (cmd === 'remove') await manager.remove(a);
  else if (cmd === 'import') await manager.importStream(createReadStream(a), b);
  else { console.error('usage: list | activate <id> | remove <id> | import <file> <id>'); process.exit(2); }
} catch (error) {
  console.error('ERROR ' + error.message);
  process.exit(1);
}
