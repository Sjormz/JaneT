import { createRequire } from 'node:module';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const electronExternals = [
  'electron',
  'node-pty',
  'ssh2',
  'ssh2-sftp-client',
  'simple-git',
];

export function electronBuildOptions(entryPoint, outfile) {
  return {
    absWorkingDir: root,
    entryPoints: [entryPoint],
    outfile,
    bundle: true,
    platform: 'node',
    external: [...electronExternals],
  };
}

function buildSync(options) {
  return require('esbuild').buildSync(options);
}

export function buildMainProcess(options = {}) {
  const runBuild = options.build ?? buildSync;
  return runBuild(electronBuildOptions('src/main/index.ts', 'dist/main/index.js'));
}

export function buildPreload(options = {}) {
  const runBuild = options.build ?? buildSync;
  return runBuild(electronBuildOptions('src/main/preload.ts', 'dist/main/preload.js'));
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
