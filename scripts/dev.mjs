// Development script - starts Vite dev server + Electron with renderer HMR
// and main/preload rebuild + restart.
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import fs from 'fs';
import http from 'http';
import { buildElectron } from './build-electron.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const distMain = path.join(root, 'dist/main');
const DEFAULT_DEV_SERVER_URL = 'http://127.0.0.1:5173';

export function parseDevServerUrl(value = DEFAULT_DEV_SERVER_URL) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`JANET_DEV_SERVER_URL must be a valid URL, received ${JSON.stringify(value)}`);
  }
  if (parsed.protocol !== 'http:') {
    throw new Error(`JANET_DEV_SERVER_URL must use http:, received ${parsed.protocol}`);
  }
  if (parsed.username || parsed.password) {
    throw new Error('JANET_DEV_SERVER_URL must not include credentials');
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  const safeHostname = /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(host);
  const safeIpv6 = host.includes(':') && /^[0-9A-Fa-f:.]+$/.test(host);
  if (!safeHostname && !safeIpv6) {
    throw new Error(`JANET_DEV_SERVER_URL contains an unsafe hostname: ${JSON.stringify(host)}`);
  }

  return {
    url: parsed.href,
    host,
    port: parsed.port ? Number(parsed.port) : 80,
  };
}

export function mainSourceDirectories(projectRoot = root) {
  return [path.join(projectRoot, 'src/main'), path.join(projectRoot, 'src/shared')];
}

export function npxExecutable(platform = process.platform) {
  return platform === 'win32' ? 'npx.cmd' : 'npx';
}

let devServer = parseDevServerUrl();

let viteProcess = null;
let electronProcess = null;
let electronLog = null;
let mainWatchers = [];
let isShuttingDown = false;
let isRestartingElectron = false;
let rebuildTimer = null;
let rebuildInFlight = Promise.resolve();

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

function isHttpReady(url) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        if (body.length < 64 * 1024) body += chunk;
      });
      response.on('end', () => {
        const statusOk = response.statusCode >= 200 && response.statusCode < 400;
        resolve(statusOk && body.includes('<meta name="application-name" content="JaneT"'));
      });
    });
    request.once('error', () => resolve(false));
    request.setTimeout(500, () => {
      request.destroy();
      resolve(false);
    });
  });
}

async function waitForHttpReady(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isHttpReady(url)) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

function buildMainProcess() {
  log('Building main process...');
  buildElectron();
  log('Main process built OK');
}

function killProcessTree(child, name) {
  return new Promise((resolve) => {
    if (!child || !child.pid || child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }

    const done = () => resolve();
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.once('exit', done);
      killer.once('error', () => {
        try { child.kill(); } catch {}
        done();
      });
      return;
    }

    try { child.kill('SIGTERM'); } catch {}
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        try { child.kill('SIGKILL'); } catch {}
      }
      done();
    }, 1000).unref?.();
  }).then(() => log(`Stopped ${name}`));
}

function openElectronLog() {
  if (electronLog !== null) fs.closeSync(electronLog);
  electronLog = fs.openSync(path.join(root, '.electron.log'), 'a');
  return electronLog;
}

function launchElectron() {
  log('Starting Electron...');
  electronProcess = spawn(npxExecutable(), ['electron', '.'], {
    cwd: root,
    stdio: ['ignore', openElectronLog(), electronLog],
    shell: false,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      JANET_DEV_SERVER_URL: devServer.url,
    },
  });
  electronProcess.on('error', (e) => log(`Electron spawn error: ${e.message}`));
  electronProcess.on('exit', (code, signal) => {
    log(`Electron exited with code ${code}${signal ? ` signal ${signal}` : ''}`);
    electronProcess = null;
    if (!isRestartingElectron && !isShuttingDown) {
      shutdown(code || 0);
    }
  });
}

async function restartElectron(reason) {
  if (isShuttingDown) return;
  log(`Restarting Electron (${reason})...`);
  isRestartingElectron = true;
  await killProcessTree(electronProcess, 'Electron');
  electronProcess = null;
  isRestartingElectron = false;
  launchElectron();
}

function scheduleMainRebuild(reason) {
  if (isShuttingDown) return;
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    rebuildInFlight = rebuildInFlight.then(async () => {
      try {
        log(`Main/preload change detected: ${reason}`);
        buildMainProcess();
        await restartElectron(reason);
      } catch (e) {
        log(`Main/preload rebuild FAILED: ${e.message}`);
      }
    });
  }, 150);
}

function watchMainProcess() {
  mainWatchers = mainSourceDirectories().map((sourceDir) => {
    const label = path.relative(root, sourceDir).replace(/\\/g, '/');
    const watcher = fs.watch(sourceDir, { recursive: true }, (_eventType, filename) => {
      if (!filename || !/\.(ts|js|json)$/.test(filename)) return;
      scheduleMainRebuild(`${label}/${filename.replace(/\\/g, '/')}`);
    });
    watcher.on('error', (e) => log(`${label} watcher error: ${e.message}`));
    return watcher;
  });
  log(`Watching ${mainSourceDirectories().map((dir) => path.relative(root, dir)).join(', ')} for main/preload changes`);
}

async function shutdown(code = 0) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  clearTimeout(rebuildTimer);
  for (const watcher of mainWatchers) watcher.close();
  mainWatchers = [];
  await killProcessTree(electronProcess, 'Electron');
  await killProcessTree(viteProcess, 'Vite');
  if (electronLog !== null) {
    try { fs.closeSync(electronLog); } catch {}
    electronLog = null;
  }
  process.exit(code);
}

// All-in-one log file so we can read it from outside.
const logPath = path.join(root, '.dev-run.log');
let logInitialized = false;
function initializeLog() {
  if (logInitialized) return;
  try { fs.unlinkSync(logPath); } catch {}
  logInitialized = true;
}
const log = (msg) => {
  const line = `[JaneT dev ${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(logPath, line);
  process.stdout.write(line);
};

async function main() {
  initializeLog();
  // Ensure dist/main exists
  if (!fs.existsSync(distMain)) {
    fs.mkdirSync(distMain, { recursive: true });
  }

  log('Starting dev run');
  loadDotEnv();
  devServer = parseDevServerUrl(process.env.JANET_DEV_SERVER_URL || DEFAULT_DEV_SERVER_URL);

  try {
    buildMainProcess();
  } catch (e) {
    log(`Main process build FAILED: ${e.message}`);
    process.exit(1);
  }

  // Step 2: Start Vite dev server in background unless one is already running.
  if (await isHttpReady(devServer.url)) {
    log(`Reusing existing JaneT Vite dev server at ${devServer.url}`);
  } else {
    log(`Starting Vite dev server at ${devServer.url}...`);
    const viteLog = fs.openSync(path.join(root, '.vite.log'), 'w');
    viteProcess = spawn(npxExecutable(), [
      'vite', '--config', 'vite.config.ts', '--host', devServer.host, '--port', String(devServer.port),
    ], {
      cwd: root,
      stdio: ['ignore', viteLog, viteLog],
      shell: false,
    });
    viteProcess.on('error', (e) => log(`Vite spawn error: ${e.message}`));
    viteProcess.on('exit', (code, signal) => {
      log(`Vite exited with code ${code}${signal ? ` signal ${signal}` : ''}`);
      viteProcess = null;
      if (!isShuttingDown) shutdown(code || 1);
    });

    if (!(await waitForHttpReady(devServer.url))) {
      log(`Vite dev server did not become ready at ${devServer.url}`);
      await killProcessTree(viteProcess, 'Vite');
      process.exit(1);
    }
  }

  fs.writeFileSync(path.join(root, '.electron.log'), '');
  watchMainProcess();
  launchElectron();

  process.on('SIGINT', () => { log('SIGINT received'); shutdown(0); });
  process.on('SIGTERM', () => { log('SIGTERM received'); shutdown(0); });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(async (err) => {
    console.error('[JaneT] Error:', err);
    await shutdown(1);
  });
}
