import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';

const root = path.resolve(__dirname, '../..');

function electronEnv(extra: NodeJS.ProcessEnv): Record<string, string> {
  const env = { ...process.env, ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

async function launchApp(decision: 'background' | 'stop' | 'cancel'): Promise<{
  app: ElectronApplication;
  page: Page;
  userData: string;
}> {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'janet-durable-e2e-'));
  const app = await electron.launch({
    args: ['.'],
    cwd: root,
    env: electronEnv({
      NODE_ENV: 'test',
      JANET_E2E_USER_DATA_DIR: userData,
      JANET_E2E_CLOSE_DECISION: decision,
    }),
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.terminal-container').first()).toBeVisible();
  await expect.poll(async () => page.locator('.xterm-rows').innerText(), { timeout: 10_000 }).not.toBe('');
  return { app, page, userData };
}

async function forceClose(app: ElectronApplication | undefined): Promise<void> {
  if (!app) return;
  try {
    await app.evaluate(({ app: electronApp }) => electronApp.exit(0));
  } catch {}
  await app.waitForEvent('close', { timeout: 5_000 }).catch(() => {});
}

async function runInTerminal(page: Page, command: string, marker: string): Promise<void> {
  const terminal = page.locator('.terminal-container').first();
  await terminal.click();
  await page.keyboard.type(command);
  await page.keyboard.press('Enter');
  await expect.poll(async () => page.locator('.xterm-rows').innerText(), { timeout: 15_000 }).toContain(marker);
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Could not allocate a test port')));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

async function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const settle = (connected: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(connected);
    };
    socket.setTimeout(500, () => settle(false));
    socket.once('connect', () => settle(true));
    socket.once('error', () => settle(false));
  });
}

async function launchSecondInstance(userData: string): Promise<void> {
  const electronPath = require('electron') as string;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(electronPath, ['.'], {
      cwd: root,
      env: electronEnv({
        NODE_ENV: 'test',
        JANET_E2E_USER_DATA_DIR: userData,
        JANET_E2E_CLOSE_DECISION: 'background',
      }),
      stdio: 'ignore',
    });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('Second JaneT instance did not hand off to the running workspace'));
    }, 10_000);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', () => {
      clearTimeout(timeout);
      // Electron can terminate the losing process by signal on Linux, which
      // reports a null exit code. The observable contract is verified by the
      // caller: the existing hidden workspace must become visible and stay live.
      resolve();
    });
  });
}

function highestTick(output: string): number {
  return Math.max(0, ...Array.from(output.matchAll(/__JT_TICK_(\d+)__/g), (match) => Number(match[1])));
}

test('keeps a running terminal alive while hidden and restores the same workspace on activate', async () => {
  let app: ElectronApplication | undefined;
  let userData: string | undefined;
  try {
    const launched = await launchApp('background');
    app = launched.app;
    userData = launched.userData;
    const { page } = launched;

    await runInTerminal(
      page,
      `node -e "let i=0;setInterval(()=>console.log('__JT_TICK_'+(++i)+'__'),100)"`,
      '__JT_TICK_1__',
    );
    const before = highestTick(await page.locator('.xterm-rows').innerText());

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
    await expect.poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false)).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 500));

    await app.evaluate(({ app: electronApp }) => electronApp.emit('activate'));
    await expect.poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false)).toBe(true);
    await expect.poll(async () => highestTick(await page.locator('.xterm-rows').innerText()), { timeout: 10_000 }).toBeGreaterThan(before);
  } finally {
    await forceClose(app);
    if (userData) fs.rmSync(userData, { recursive: true, force: true });
  }
});

test('defers an application quit when backgrounding active work is chosen', async () => {
  let app: ElectronApplication | undefined;
  let userData: string | undefined;
  try {
    const launched = await launchApp('background');
    app = launched.app;
    userData = launched.userData;
    const { page } = launched;

    await runInTerminal(
      page,
      `node -e "let i=0;setInterval(()=>console.log('__JT_QUIT_TICK_'+(++i)+'__'),100)"`,
      '__JT_QUIT_TICK_1__',
    );
    await app.evaluate(({ app: electronApp }) => electronApp.quit());

    await expect.poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false)).toBe(false);
    await app.evaluate(({ app: electronApp }) => electronApp.emit('activate'));
    await expect.poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false)).toBe(true);
    await expect.poll(async () => page.locator('.xterm-rows').innerText()).toContain('__JT_QUIT_TICK_');
  } finally {
    await forceClose(app);
    if (userData) fs.rmSync(userData, { recursive: true, force: true });
  }
});

test('restores a hidden workspace when JaneT is launched a second time', async () => {
  let app: ElectronApplication | undefined;
  let userData: string | undefined;
  try {
    const launched = await launchApp('background');
    app = launched.app;
    userData = launched.userData;
    await runInTerminal(
      launched.page,
      `node -e "setInterval(()=>console.log('__JT_SECOND_INSTANCE_ALIVE__'),100)"`,
      '__JT_SECOND_INSTANCE_ALIVE__',
    );
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
    await expect.poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false)).toBe(false);

    await launchSecondInstance(userData);

    await expect.poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false)).toBe(true);
    await expect.poll(async () => launched.page.locator('.xterm-rows').innerText()).toContain('__JT_SECOND_INSTANCE_ALIVE__');
  } finally {
    await forceClose(app);
    if (userData) fs.rmSync(userData, { recursive: true, force: true });
  }
});

test('allows a real application quit when only idle shells remain', async () => {
  let app: ElectronApplication | undefined;
  let userData: string | undefined;
  try {
    const launched = await launchApp('cancel');
    app = launched.app;
    userData = launched.userData;

    const closed = app.waitForEvent('close');
    await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => {});
    await closed;
    app = undefined;
  } finally {
    await forceClose(app);
    if (userData) fs.rmSync(userData, { recursive: true, force: true });
  }
});

test('keeps active work visible when close is cancelled', async () => {
  let app: ElectronApplication | undefined;
  let userData: string | undefined;
  try {
    const launched = await launchApp('cancel');
    app = launched.app;
    userData = launched.userData;
    await runInTerminal(
      launched.page,
      `node -e "setInterval(()=>console.log('__JT_CANCEL_ALIVE__'),100)"`,
      '__JT_CANCEL_ALIVE__',
    );

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());

    await expect.poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false)).toBe(true);
    await expect.poll(async () => launched.page.locator('.xterm-rows').innerText()).toContain('__JT_CANCEL_ALIVE__');
  } finally {
    await forceClose(app);
    if (userData) fs.rmSync(userData, { recursive: true, force: true });
  }
});

test('stops a JaneT-owned server before quitting', async () => {
  let app: ElectronApplication | undefined;
  let userData: string | undefined;
  const port = await freePort();
  try {
    const launched = await launchApp('stop');
    app = launched.app;
    userData = launched.userData;
    await runInTerminal(
      launched.page,
      `node -e "process.on('SIGINT',()=>{});process.on('SIGTERM',()=>{});require('http').createServer((q,s)=>s.end('ok')).listen(${port},'127.0.0.1',()=>console.log('__JT_SERVER_READY__'))"`,
      '__JT_SERVER_READY__',
    );
    await expect.poll(() => canConnect(port), { timeout: 5_000 }).toBe(true);

    const closed = app.waitForEvent('close');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
    await closed;
    app = undefined;

    await expect.poll(() => canConnect(port), { timeout: 5_000 }).toBe(false);
  } finally {
    await forceClose(app);
    if (userData) fs.rmSync(userData, { recursive: true, force: true });
  }
});
