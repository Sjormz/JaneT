import { test, expect, chromium, Browser, Page } from '@playwright/test';
import { spawn, ChildProcess, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';

const root = path.resolve(__dirname, '../..');
const slowMode = process.env.JANET_E2E_SLOW === '1';
const devMode = process.env.JANET_E2E_DEV === '1';

interface LaunchOptions {
  seedSession?: boolean;
}

async function slowPause(ms = 1500) {
  if (slowMode) await new Promise((resolve) => setTimeout(resolve, ms));
}

function isPortOpen(port: number): Promise<boolean> {
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

async function closeElectron(browser: Browser, electronProcess: ChildProcess, viteProcess?: ChildProcess) {
  try {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        await page.evaluate(() => window.close()).catch(() => {});
      }
    }
    await browser.close().catch(() => {});
  } finally {
    if (!electronProcess.killed) {
      electronProcess.kill('SIGTERM');
      setTimeout(() => {
        if (!electronProcess.killed) electronProcess.kill('SIGKILL');
      }, 1000).unref();
    }
    if (viteProcess && !viteProcess.killed) {
      viteProcess.kill('SIGTERM');
      setTimeout(() => {
        if (!viteProcess.killed) viteProcess.kill('SIGKILL');
      }, 1000).unref();
    }
  }
}

function requiredEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function electronEnv(extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...process.env, ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  return env;
}

function readEvents(eventsPath: string): Array<Record<string, any>> {
  if (!fs.existsSync(eventsPath)) return [];
  return fs.readFileSync(eventsPath, 'utf-8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function readSettings(settingsPath: string): Record<string, any> {
  return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
}

async function waitForShellCreateCount(eventsPath: string, count: number) {
  await expect.poll(
    () => readEvents(eventsPath).filter((event) => event.type === 'ssh:createShell:start').length,
    { timeout: 20_000 },
  ).toBeGreaterThanOrEqual(count);
}

async function runMarkedLs(page: Page, marker: string) {
  const terminal = page.locator('.terminal-container').first();
  await expect(terminal).toBeVisible();
  await slowPause();
  await terminal.click();
  await slowPause(750);
  await page.keyboard.press('Control+L');
  await slowPause(500);
  await page.keyboard.type(`printf "__JANET_${marker}_START__\\n"; ls; printf "__JANET_${marker}_DONE__\\n"`);
  await slowPause(1000);
  await page.keyboard.press('Enter');

  await expect.poll(async () => page.locator('.xterm-rows').innerText(), { timeout: 20_000 }).toContain(`__JANET_${marker}_START__`);
  await expect.poll(async () => page.locator('.xterm-rows').innerText(), { timeout: 20_000 }).toContain(`__JANET_${marker}_DONE__`);
  await slowPause(2000);
}

async function connectCdp(port: number): Promise<Browser> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`Could not connect to Electron CDP on port ${port}`);
}

async function launchRealSshApp(options: LaunchOptions = {}): Promise<{
  browser: Browser;
  electronProcess: ChildProcess;
  viteProcess?: ChildProcess;
  page: Page;
  eventsPath: string;
  settingsPath: string;
}> {
  const host = requiredEnv('JANET_E2E_SSH_HOST');
  const username = requiredEnv('JANET_E2E_SSH_USERNAME');
  const password = requiredEnv('JANET_E2E_SSH_PASSWORD');
  const privateKey = process.env.JANET_E2E_SSH_PRIVATE_KEY;
  const port = Number(process.env.JANET_E2E_SSH_PORT || 22);
  if (!host) {
    throw new Error('Set JANET_E2E_SSH_HOST to run this test. Password/key auth is optional when your SSH setup allows implicit auth.');
  }

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'janet-e2e-real-ssh-'));
  const eventsPath = path.join(userData, 'events.ndjson');
  const settingsPath = path.join(userData, 'settings.json');
  const remoteDebuggingPort = 10_300 + Math.floor(Math.random() * 1000);
  const profile = {
    id: 'real-ssh-profile',
    host,
    port,
    ...(username ? { username } : {}),
    auth: privateKey ? 'key' as const : 'password' as const,
    ...(privateKey ? { privateKey } : { password }),
  };
  const seedSession = options.seedSession !== false;

  fs.writeFileSync(settingsPath, JSON.stringify({
    theme: 'tokyo-night',
    fontSize: 14,
    sidebarSide: 'left',
    keybindings: {},
    workspaceTabs: [],
    sshProfiles: [profile],
    session: seedSession ? {
      tabs: [{
        id: 'real-ssh-tab',
        title: 'real ssh',
        type: 'ssh',
        sshProfileId: profile.id,
        root: { type: 'leaf', title: 'ssh' },
      }],
      activeTabId: 'real-ssh-tab',
      sidebarOpen: true,
      tabsOpen: true,
      sidebarSection: 'files',
    } : undefined,
  }, null, 2), 'utf-8');

  if (devMode) {
    execFileSync('npx', ['esbuild', 'src/main/index.ts', '--bundle', '--platform=node', '--outfile=dist/main/index.js', '--external:electron', '--external:node-pty', '--external:ssh2', '--external:ssh2-sftp-client', '--external:simple-git'], { cwd: root, stdio: 'inherit', shell: true });
    execFileSync('npx', ['esbuild', 'src/main/preload.ts', '--bundle', '--platform=node', '--outfile=dist/main/preload.js', '--external:electron'], { cwd: root, stdio: 'inherit', shell: true });
  }

  const viteProcess = devMode && !(await isPortOpen(5173)) ? spawn('npx', ['vite', '--config', 'vite.config.ts', '--host', '127.0.0.1'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  }) : undefined;
  viteProcess?.stdout?.on('data', (chunk) => console.log(`[vite] ${chunk}`));
  viteProcess?.stderr?.on('data', (chunk) => console.error(`[vite] ${chunk}`));
  if (devMode) {
    const deadline = Date.now() + 10000;
    while (!(await isPortOpen(5173)) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!(await isPortOpen(5173))) throw new Error('Vite dev server did not become ready on port 5173');
  }

  const electronProcess = spawn('npx', ['electron', '.'], {
    cwd: root,
    env: electronEnv({
      NODE_ENV: devMode ? 'development' : 'test',
      JANET_E2E_EVENTS_PATH: eventsPath,
      JANET_E2E_USER_DATA_DIR: userData,
      JANET_E2E_REMOTE_DEBUGGING_PORT: String(remoteDebuggingPort),
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  });
  electronProcess.stdout?.on('data', (chunk) => console.log(`[electron] ${chunk}`));
  electronProcess.stderr?.on('data', (chunk) => console.error(`[electron] ${chunk}`));

  const browser = await connectCdp(remoteDebuggingPort);
  const context = browser.contexts()[0] ?? await browser.newContext();
  let page = context.pages().find((candidate) => candidate.url().includes('localhost:5173') || candidate.url().endsWith('index.html'));
  if (!page) page = await context.waitForEvent('page', { timeout: 10_000 });
  if (!page.url().includes('localhost:5173') && !page.url().endsWith('index.html')) {
    await page.waitForURL((url) => url.href.includes('localhost:5173') || url.href.endsWith('index.html'), { timeout: 10_000 }).catch(() => {});
  }
  page.on('console', (message) => console.log(`[renderer:${message.type()}] ${message.text()}`));
  await page.waitForLoadState('domcontentloaded');
  return { browser, electronProcess, viteProcess, page, eventsPath, settingsPath };
}

test('connects to a real SSH host and runs ls', async () => {
  test.skip(!requiredEnv('JANET_E2E_SSH_HOST'), 'Set JANET_E2E_SSH_HOST to run this test.');

  const { browser, electronProcess, viteProcess, page, eventsPath } = await launchRealSshApp();
  try {
    await waitForShellCreateCount(eventsPath, 1);
    await runMarkedLs(page, 'LS');
  } finally {
    await closeElectron(browser, electronProcess, viteProcess);
  }
});

test('restores real SSH terminal after refresh and runs ls again', async () => {
  test.skip(!requiredEnv('JANET_E2E_SSH_HOST'), 'Set JANET_E2E_SSH_HOST to run this test.');

  const { browser, electronProcess, viteProcess, page, eventsPath } = await launchRealSshApp();
  try {
    await waitForShellCreateCount(eventsPath, 1);
    await slowPause(2000);
    await runMarkedLs(page, 'BEFORE_REFRESH');

    await slowPause(2500);
    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect(page.locator('.terminal-container').first()).toBeVisible();
    await waitForShellCreateCount(eventsPath, 2);
    await slowPause(2000);
    await runMarkedLs(page, 'AFTER_REFRESH');
  } finally {
    await closeElectron(browser, electronProcess, viteProcess);
  }
});

test('opens saved SSH profile, persists profile id, refreshes, and runs ls again', async () => {
  test.skip(!requiredEnv('JANET_E2E_SSH_HOST'), 'Set JANET_E2E_SSH_HOST to run this test.');

  const {
    browser, electronProcess, viteProcess, page, eventsPath, settingsPath,
  } = await launchRealSshApp({ seedSession: false });
  try {
    await page.getByRole('button', { name: 'SSH' }).click();
    await page.getByRole('button', { name: /connect to .*:22/i }).click();

    await waitForShellCreateCount(eventsPath, 1);
    await runMarkedLs(page, 'OPENED_PROFILE');

    await expect.poll(() => {
      const session = readSettings(settingsPath).session;
      return session?.tabs?.find((tab: any) => tab.type === 'ssh')?.sshProfileId;
    }, { timeout: 5_000 }).toBe('real-ssh-profile');

    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect(page.locator('.terminal-container').first()).toBeVisible();
    await waitForShellCreateCount(eventsPath, 2);
    await runMarkedLs(page, 'OPENED_PROFILE_AFTER_REFRESH');
  } finally {
    await closeElectron(browser, electronProcess, viteProcess);
  }
});
