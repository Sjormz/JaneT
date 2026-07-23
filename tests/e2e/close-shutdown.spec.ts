import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
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

function createEditorFixture(userData: string): { directory: string; fileName: string } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'janet-close-editor-'));
  const fileName = 'dirty-close.ts';
  fs.writeFileSync(path.join(directory, fileName), 'export const clean = true;\n', 'utf8');
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({
    theme: 'tokyo-night',
    fontSize: 14,
    sidebarSide: 'right',
    keybindings: {},
    workspaceTabs: [],
    session: {
      tabs: [{
        id: 'dirty-close-tab',
        title: 'Dirty close',
        type: 'local',
        cwd: directory,
        root: { type: 'leaf', title: 'terminal', terminalType: 'local', cwd: directory },
      }],
      activeTabId: 'dirty-close-tab',
      sidebarOpen: true,
      tabsOpen: true,
      sidebarSection: 'files',
    },
  }), 'utf8');
  return { directory, fileName };
}

test('closing the window stops managed terminal work and exits without an active-work prompt', async () => {
  let app: ElectronApplication | undefined;
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'janet-close-e2e-'));
  const port = await freePort();

  try {
    app = await electron.launch({
      args: ['.'],
      cwd: root,
      env: electronEnv({
        NODE_ENV: 'test',
        JANET_E2E_USER_DATA_DIR: userData,
      }),
    });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.terminal-container').first()).toBeVisible();
    await expect.poll(async () => page.locator('.xterm-rows').innerText(), { timeout: 10_000 }).not.toBe('');

    await runInTerminal(
      page,
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
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test('cancelling dirty-editor close keeps the same JaneT window open', async () => {
  let app: ElectronApplication | undefined;
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'janet-close-e2e-'));
  const fixture = createEditorFixture(userData);

  try {
    app = await electron.launch({
      args: ['.'],
      cwd: root,
      env: electronEnv({
        NODE_ENV: 'test',
        JANET_E2E_USER_DATA_DIR: userData,
      }),
    });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.getByRole('button', { name: `Open file ${fixture.fileName}` }).click();
    const editor = page.getByRole('textbox', { name: `Editing ${fixture.fileName}` });
    await expect(editor).toBeAttached({ timeout: 20_000 });
    await editor.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
    await editor.pressSequentially('x');
    await expect(page.getByRole('tab', { name: `${fixture.fileName}, unsaved changes` })).toBeVisible();

    await page.evaluate(() => window.janet.windowClose());
    const dialog = page.getByRole('alertdialog', { name: /Save 1 changed file before closing JaneT\?/ });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    await expect(editor).toBeAttached();
    await expect.poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  } finally {
    await forceClose(app);
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});
