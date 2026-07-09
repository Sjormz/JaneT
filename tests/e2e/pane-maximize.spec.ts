import { test, expect, chromium, Browser, Page } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';

const root = path.resolve(__dirname, '../..');
const devServerUrl = process.env.JANET_DEV_SERVER_URL || 'http://127.0.0.1:5173';

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Could not allocate local port')));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

function isAppUrl(url: string): boolean {
  return url.includes('127.0.0.1:5173') || url.includes('localhost:5173') || url.endsWith('index.html');
}

function electronEnv(extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...process.env, ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  return env;
}

function killProcessTree(child: ChildProcess | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.once('exit', () => resolve());
      killer.once('error', () => {
        try { child.kill('SIGTERM'); } catch {}
        resolve();
      });
      return;
    }
    try { child.kill('SIGTERM'); } catch {}
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        try { child.kill('SIGKILL'); } catch {}
      }
      resolve();
    }, 1000).unref();
  });
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
  return chromium.connectOverCDP(`http://127.0.0.1:${port}`);
}

async function launchTwoPaneApp(): Promise<{ browser: Browser; electronProcess: ChildProcess; page: Page }> {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'janet-e2e-pane-max-'));
  const settingsPath = path.join(userData, 'settings.json');
  const remoteDebuggingPort = await getFreePort();

  fs.writeFileSync(settingsPath, JSON.stringify({
    theme: 'tokyo-night',
    fontSize: 14,
    sidebarSide: 'left',
    keybindings: {},
    workspaceTabs: [],
    session: {
      tabs: [{
        id: 'two-pane-tab',
        title: 'two panes',
        type: 'local',
        root: {
          type: 'split',
          direction: 'vertical',
          sizes: [1, 1],
          children: [{ type: 'leaf', title: 'left' }, { type: 'leaf', title: 'right' }],
        },
      }],
      activeTabId: 'two-pane-tab',
      sidebarOpen: true,
      tabsOpen: true,
      sidebarSection: 'files',
    },
  }, null, 2), 'utf-8');

  const electronProcess = spawn('npx', ['electron', '.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], {
    cwd: root,
    env: electronEnv({
      NODE_ENV: 'test',
      JANET_DEV_SERVER_URL: devServerUrl,
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
  let page = context.pages().find((candidate) => isAppUrl(candidate.url()));
  if (!page) page = await context.waitForEvent('page', { timeout: 10_000 });
  if (!isAppUrl(page.url())) {
    await page.waitForURL((url) => isAppUrl(url.href), { timeout: 10_000 }).catch(() => {});
  }
  page.on('console', (message) => console.log(`[renderer:${message.type()}] ${message.text()}`));
  await page.waitForLoadState('domcontentloaded');
  return { browser, electronProcess, page };
}

async function closeApp(browser: Browser, electronProcess: ChildProcess) {
  try {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        await page.evaluate(() => window.close()).catch(() => {});
      }
    }
    await browser.close().catch(() => {});
  } finally {
    await killProcessTree(electronProcess);
  }
}

test('maximizes and restores a terminal pane in Electron', async () => {
  const { browser, electronProcess, page } = await launchTwoPaneApp();
  try {
    await expect(page.locator('.terminal-leaf')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Maximize pane' })).toHaveCount(2);

    await page.getByRole('button', { name: 'Maximize pane' }).nth(1).click();

    await expect(page.locator('.terminal-leaf')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Restore pane layout' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Maximize pane' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Restore pane layout' }).click();

    await expect(page.locator('.terminal-leaf')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Maximize pane' })).toHaveCount(2);
  } finally {
    await closeApp(browser, electronProcess);
  }
});
