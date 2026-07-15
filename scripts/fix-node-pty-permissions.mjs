import { chmodSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const nodePtyRoot = path.join(root, 'node_modules', 'node-pty');
  const candidates = [path.join(nodePtyRoot, 'build', 'Release', 'spawn-helper')];
  const prebuildsRoot = path.join(nodePtyRoot, 'prebuilds');

  if (existsSync(prebuildsRoot)) {
    for (const entry of readdirSync(prebuildsRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) candidates.push(path.join(prebuildsRoot, entry.name, 'spawn-helper'));
    }
  }

  for (const helper of candidates) {
    if (existsSync(helper)) chmodSync(helper, 0o755);
  }
}
