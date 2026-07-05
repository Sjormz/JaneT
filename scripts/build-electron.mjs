import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const commonArgs = [
  'esbuild',
  '--bundle',
  '--platform=node',
  '--external:electron',
  '--external:node-pty',
  '--external:ssh2',
  '--external:ssh2-sftp-client',
  '--external:simple-git',
];

export function buildMainProcess(options = {}) {
  const stdio = options.stdio ?? 'inherit';
  execFileSync('npx', [
    ...commonArgs,
    'src/main/index.ts',
    '--outfile=dist/main/index.js',
  ], { cwd: root, stdio, shell: true });
}

export function buildPreload(options = {}) {
  const stdio = options.stdio ?? 'inherit';
  execFileSync('npx', [
    ...commonArgs,
    'src/main/preload.ts',
    '--outfile=dist/main/preload.js',
  ], { cwd: root, stdio, shell: true });
}

export function buildElectron(options = {}) {
  buildMainProcess(options);
  buildPreload(options);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const target = process.argv[2] ?? '--all';
  if (target === '--main') buildMainProcess();
  else if (target === '--preload') buildPreload();
  else if (target === '--all') buildElectron();
  else {
    console.error(`Unknown build target: ${target}`);
    process.exit(1);
  }
}
