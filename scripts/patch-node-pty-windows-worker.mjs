import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const LEGACY_WORKER_PATH = "var scriptPath = __dirname.replace('node_modules.asar', 'node_modules.asar.unpacked');";
export const APP_ASAR_WORKER_REWRITE = ".replace('app.asar', 'app.asar.unpacked')";
export const WINDOWS_PATCH_POSTCONDITIONS = {
  worker: [
    APP_ASAR_WORKER_REWRITE,
    ".replace('node_modules.asar', 'node_modules.asar.unpacked')",
  ],
};

function replaceRequired(source, before, after, description) {
  if (!source.includes(before)) {
    throw new Error(`Unsupported node-pty Windows source; expected ${description} was not found.`);
  }
  return source.replace(before, after);
}

function requireMarkers(source, markers, description) {
  const missing = markers.filter((marker) => !source.includes(marker));
  if (missing.length > 0) {
    throw new Error(`Incomplete node-pty Windows ${description} patch: ${missing.join(', ')}`);
  }
}

export function patchNodePtyWindowsWorkerSource(source) {
  if (source.includes(APP_ASAR_WORKER_REWRITE)) {
    requireMarkers(source, WINDOWS_PATCH_POSTCONDITIONS.worker, 'worker');
    return source;
  }
  const patched = replaceRequired(
    source,
    LEGACY_WORKER_PATH,
    `var scriptPath = __dirname
            .replace('node_modules.asar', 'node_modules.asar.unpacked')
            ${APP_ASAR_WORKER_REWRITE};`,
    'worker path resolver',
  );
  requireMarkers(patched, WINDOWS_PATCH_POSTCONDITIONS.worker, 'worker');
  return patched;
}

export function patchNodePtyWindowsWorker(projectRoot) {
  const target = path.join(projectRoot, 'node_modules', 'node-pty', 'lib', 'windowsConoutConnection.js');
  const source = fs.readFileSync(target, 'utf8');
  const patched = patchNodePtyWindowsWorkerSource(source);
  if (patched !== source) fs.writeFileSync(target, patched);
  return target;
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  patchNodePtyWindowsWorker(path.resolve(path.dirname(scriptPath), '..'));
}
