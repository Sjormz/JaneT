import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const LEGACY_WORKER_PATH = "var scriptPath = __dirname.replace('node_modules.asar', 'node_modules.asar.unpacked');";
export const APP_ASAR_WORKER_REWRITE = ".replace('app.asar', 'app.asar.unpacked')";

export function patchNodePtyWindowsWorkerSource(source) {
  if (source.includes(APP_ASAR_WORKER_REWRITE)) return source;
  if (!source.includes(LEGACY_WORKER_PATH)) {
    throw new Error('Unsupported node-pty Windows worker source; expected path resolver was not found.');
  }

  return source.replace(
    LEGACY_WORKER_PATH,
    `var scriptPath = __dirname
            .replace('node_modules.asar', 'node_modules.asar.unpacked')
            ${APP_ASAR_WORKER_REWRITE};`,
  );
}

export function patchNodePtyWindowsWorker(projectRoot) {
  const workerPath = path.join(
    projectRoot,
    'node_modules',
    'node-pty',
    'lib',
    'windowsConoutConnection.js',
  );
  const source = fs.readFileSync(workerPath, 'utf8');
  const patched = patchNodePtyWindowsWorkerSource(source);
  if (patched !== source) fs.writeFileSync(workerPath, patched);
  return workerPath;
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  patchNodePtyWindowsWorker(path.resolve(path.dirname(scriptPath), '..'));
}
