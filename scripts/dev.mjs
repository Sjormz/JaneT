// Development script - starts Vite dev server + Electron
import { spawn, execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import net from 'net';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const distMain = path.join(root, 'dist/main');

function loadDotEnv() {
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const index = trimmed.indexOf('=');
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1);
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

// All-in-one log file so we can read it from outside.
const logPath = path.join(root, '.dev-run.log');
try { fs.unlinkSync(logPath); } catch {}
const log = (msg) => {
  const line = `[JaneT dev ${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(logPath, line);
  process.stdout.write(line);
};

async function main() {
  // Ensure dist/main exists
  if (!fs.existsSync(distMain)) {
    fs.mkdirSync(distMain, { recursive: true });
  }

  log('Starting dev run');
  loadDotEnv();

  // Step 1: Build main process
  log('Building main process...');
  try {
    execSync(`npx esbuild src/main/index.ts --bundle --platform=node --outfile=dist/main/index.js --external:electron --external:node-pty --external:ssh2 --external:ssh2-sftp-client --external:simple-git`, {
      cwd: root,
      stdio: 'inherit',
    });
    execSync(`npx esbuild src/main/preload.ts --bundle --platform=node --outfile=dist/main/preload.js --external:electron`, {
      cwd: root,
      stdio: 'inherit',
    });
    log('Main process built OK');
  } catch (e) {
    log(`Main process build FAILED: ${e.message}`);
    process.exit(1);
  }

  // Step 2: Start Vite dev server in background unless one is already running.
  let viteProcess = null;
  if (await isPortOpen(5173)) {
    log('Reusing existing Vite dev server on port 5173');
  } else {
    log('Starting Vite dev server...');
    const viteLog = fs.openSync(path.join(root, '.vite.log'), 'w');
    viteProcess = spawn('npx', ['vite', '--config', 'vite.config.ts', '--host', '127.0.0.1'], {
      cwd: root,
      stdio: ['ignore', viteLog, viteLog],
      shell: true,
    });
    viteProcess.on('error', (e) => log(`Vite spawn error: ${e.message}`));
    viteProcess.on('exit', (code) => log(`Vite exited with code ${code}`));

    const deadline = Date.now() + 10000;
    while (!(await isPortOpen(5173)) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!(await isPortOpen(5173))) {
      log('Vite dev server did not become ready on port 5173');
      viteProcess.kill();
      process.exit(1);
    }
  }

  // Step 3: Start Electron
  log('Starting Electron...');
  const electronLog = fs.openSync(path.join(root, '.electron.log'), 'w');
  const electronProcess = spawn('npx', ['electron', '.'], {
    cwd: root,
    stdio: ['ignore', electronLog, electronLog],
    shell: true,
    env: {
      ...process.env,
      NODE_ENV: 'development',
    },
  });
  electronProcess.on('error', (e) => log(`Electron spawn error: ${e.message}`));
  electronProcess.on('exit', (code) => {
    log(`Electron exited with code ${code}`);
    viteProcess?.kill();
    process.exit(code || 0);
  });

  process.on('SIGINT', () => {
    log('SIGINT received, killing processes');
    electronProcess.kill();
    viteProcess?.kill();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[JaneT] Error:', err);
  process.exit(1);
});
