import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const root = path.resolve(__dirname, '../..');
const USER_DATA_PREFIX = 'janet-terminal-copy-e2e-';
const MARKER = 'JANET_TERMINAL_COPY_MARKER';
const INPUT_SUFFIX = '_AFTER_PASTE';

function electronEnv(extra: NodeJS.ProcessEnv): Record<string, string> {
  const env = { ...process.env, ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function createUserData(): string {
  const userData = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), USER_DATA_PREFIX));
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ mainDirectory: userData,
    theme: 'tokyo-night',
    fontSize: 14,
    sidebarSide: 'left',
    keybindings: { 'close-tab': 'Ctrl+C' },
    workspaceTabs: [],
    session: {
      tabs: [{
        id: 'terminal-copy-tab',
        title: 'terminal copy',
        type: 'local',
        root: {
          type: 'leaf',
          title: 'copy',
          terminalType: 'local',
          startupCommands: [`node -e "console.log('${MARKER}')"`],
        },
      }],
      activeTabId: 'terminal-copy-tab',
      sidebarOpen: false,
      tabsOpen: true,
      sidebarSection: 'files',
    },
  }, null, 2), 'utf-8');
  return userData;
}

async function forceClose(app: ElectronApplication | undefined): Promise<void> {
  if (!app) return;
  try {
    await app.evaluate(({ app: electronApp }) => electronApp.exit(0));
  } catch {}
  await app.waitForEvent('close', { timeout: 5_000 }).catch(() => {});
}

async function markerPosition(page: Page): Promise<{ x: number; y: number }> {
  const rows = page.locator('.xterm-rows > div');
  await expect.poll(async () => (
    (await rows.allInnerTexts()).some((line) => line.trim() === MARKER)
  ), { timeout: 15_000 }).toBe(true);
  const texts = await rows.allInnerTexts();
  const index = texts.findIndex((line) => line.trim() === MARKER);
  const box = await rows.nth(index).boundingBox();
  expect(box).not.toBeNull();
  return { x: box!.x + 72, y: box!.y + box!.height / 2 };
}

async function dragMarker(page: Page, forceSelection = true): Promise<void> {
  const rows = page.locator('.xterm-rows > div');
  const texts = await rows.allInnerTexts();
  const index = texts.findIndex((line) => line.trim() === MARKER);
  expect(index).toBeGreaterThanOrEqual(0);
  const box = await rows.nth(index).boundingBox();
  expect(box).not.toBeNull();
  const y = box!.y + box!.height / 2;
  if (forceSelection) await page.keyboard.down('Shift');
  await page.mouse.move(box!.x + 1, y);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width - 2, y, { steps: 12 });
  await page.mouse.up();
  if (forceSelection) await page.keyboard.up('Shift');
}

async function selectMarker(page: Page, position: { x: number; y: number }): Promise<void> {
  await page.mouse.dblclick(position.x, position.y);
}

test('copies selected xterm text with keyboard shortcuts and right-click', async () => {
  test.setTimeout(60_000);
  const userData = createUserData();
  let app: ElectronApplication | undefined;

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
    const position = await markerPosition(page);

    for (const shortcut of [process.platform === 'darwin' ? 'Meta+C' : 'Control+C', 'Control+Shift+C']) {
      await app.evaluate(({ clipboard }) => clipboard.clear());
      await selectMarker(page, position);
      await page.keyboard.press(shortcut);
      await expect.poll(() => app!.evaluate(({ clipboard }) => clipboard.readText())).toBe(MARKER);
      await expect(page.locator('.terminal-container')).toHaveCount(1);
    }

    await app.evaluate(({ clipboard }) => clipboard.writeText('STALE_CLIPBOARD'));
    await selectMarker(page, position);
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+C' : 'Control+C');
    await expect.poll(() => app!.evaluate(({ clipboard }) => clipboard.readText())).toBe(MARKER);
    await page.keyboard.press(process.platform === 'darwin'
      ? 'Meta+V'
      : process.platform === 'linux' ? 'Control+Shift+V' : 'Control+V');
    await page.keyboard.type(INPUT_SUFFIX);
    await page.keyboard.press('Enter');
    await expect.poll(async () => page.locator('.xterm-rows').innerText(), { timeout: 15_000 })
      .toContain(`${MARKER}${INPUT_SUFFIX}`);

    await app.evaluate(({ clipboard }) => clipboard.clear());
    await selectMarker(page, position);
    await page.mouse.click(position.x, position.y, { button: 'right' });
    await expect.poll(() => app!.evaluate(({ clipboard }) => clipboard.readText())).toBe(MARKER);
  } finally {
    await forceClose(app);
    fs.rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('copies from an alternate-screen TUI that owns all-motion mouse tracking', async () => {
  test.setTimeout(60_000);
  const userData = createUserData();
  let app: ElectronApplication | undefined;

  try {
    app = await electron.launch({
      args: ['.'],
      cwd: root,
      env: electronEnv({
        NODE_ENV: 'test',
        JANET_E2E_USER_DATA_DIR: userData,
        JANET_TERMINAL_DIAGNOSTICS: '1',
      }),
    });
    const page = await app.firstWindow();
    const diagnosticEvents: unknown[] = [];
    page.on('console', async (message) => {
      if (!message.text().includes('[JaneT terminal diagnostics]')) return;
      const value = await message.args()[1]?.jsonValue().catch(() => null);
      if (value) diagnosticEvents.push(value);
    });
    await page.waitForLoadState('domcontentloaded');
    await markerPosition(page);
    const termId = await page.locator('.terminal-container').getAttribute('data-terminal-id');
    expect(termId).toBeTruthy();
    await app.evaluate(({ BrowserWindow }, id) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('terminal:onData', {
        source: 'local',
        id,
        data: '\u001b[?1049h\u001b[?1000h\u001b[?1003h\u001b[?1006hJANET_TERMINAL_COPY_MARKER\r\n',
        generation: 999,
        sequence: 999,
      });
    }, termId);
    await markerPosition(page);

    await app.evaluate(({ clipboard }) => clipboard.clear());
    await dragMarker(page);
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+C' : 'Control+C');

    await expect.poll(
      async () => (await app!.evaluate(({ clipboard }) => clipboard.readText())).trim(),
      { message: JSON.stringify(diagnosticEvents) },
    ).toBe(MARKER);
  } finally {
    await forceClose(app);
    fs.rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('retains an ordinary TUI drag through a redraw without turning copy into interrupt', async () => {
  const userData = createUserData();
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({ args: ['.'], cwd: root, env: electronEnv({ NODE_ENV: 'test', JANET_E2E_USER_DATA_DIR: userData }) });
    const page = await app.firstWindow();
    await markerPosition(page);
    const termId = await page.locator('.terminal-container').getAttribute('data-terminal-id');
    const output = (data: string) => app!.evaluate(({ BrowserWindow }, payload) => {
      BrowserWindow.getAllWindows()[0].webContents.send('terminal:onData', { source: 'local', generation: 999, sequence: 999, ...payload });
    }, { id: termId, data });
    await app.evaluate(({ ipcMain }) => {
      (globalThis as any).__copyInput = [];
      ipcMain.removeHandler('terminal:write');
      ipcMain.handle('terminal:write', (_event, { data }) => { (globalThis as any).__copyInput.push(data); });
    });
    await output(`\x1b[?1049h\x1b[?1003h\x1b[?1006h${MARKER}\r\n`);
    const position = await markerPosition(page);
    await dragMarker(page, false);
    await output('\x1b[2J\x1b[HREDRAW_REPLACEMENT');
    await expect(page.locator('.xterm-rows')).toContainText('REDRAW_REPLACEMENT');
    await page.keyboard.press('Control+Shift+C');
    await expect.poll(async () => (await app!.evaluate(({ clipboard }) => clipboard.readText())).trim()).toBe(MARKER);
    await app.evaluate(({ clipboard }) => clipboard.writeText('UNCHANGED'));
    await page.mouse.click(position.x, position.y);
    await page.keyboard.press('Control+Shift+C');
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('UNCHANGED');
    await output(`\x1b[2J\x1b[H${MARKER}\r\n`);
    await markerPosition(page);
    await dragMarker(page, false);
    await page.keyboard.type('x');
    await page.keyboard.press('Control+Shift+C');
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('UNCHANGED');
    expect(await app.evaluate(() => (globalThis as any).__copyInput)).not.toContain('\x03');
  } finally {
    await forceClose(app);
    fs.rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('opens word-labelled OSC 8 links through the browser bridge in a mouse-tracking TUI', async () => {
  const userData = createUserData();
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({ args: ['.'], cwd: root, env: electronEnv({ NODE_ENV: 'test', JANET_E2E_USER_DATA_DIR: userData }) });
    const page = await app.firstWindow();
    await markerPosition(page);
    const termId = await page.locator('.terminal-container').getAttribute('data-terminal-id');
    await app.evaluate(({ BrowserWindow, shell }, id) => {
      (globalThis as any).__openedTerminalLinks = [];
      shell.openExternal = async (url: string) => { (globalThis as any).__openedTerminalLinks.push(url); };
      BrowserWindow.getAllWindows()[0].webContents.send('terminal:onData', {
        source: 'local', id, generation: 999, sequence: 999,
        data: '\x1b[?1049h\x1b[?1003h\x1b[?1006h\x1b[2J\x1b[H\x1b]8;;https://example.com/hermes-link\x1b\\Documentation\x1b]8;;\x1b\\\r\n',
      });
    }, termId);
    const label = page.locator('.xterm-rows').getByText('Documentation', { exact: true });
    await expect(label).toBeVisible();
    const box = await label.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await expect(page.locator('.xterm-screen')).toHaveClass(/xterm-cursor-pointer/);
    await page.mouse.down();
    // A TUI can repaint after mouse-down, invalidating xterm's current link.
    await app.evaluate(({ BrowserWindow }, id) => {
      BrowserWindow.getAllWindows()[0].webContents.send('terminal:onData', {
        source: 'local', id, generation: 999, sequence: 1000, data: '\x1b[2J\x1b[HRepainted',
      });
    }, termId);
    await expect(page.locator('.xterm-rows')).toContainText('Repainted');
    await page.mouse.up();
    await expect.poll(() => app!.evaluate(() => (globalThis as any).__openedTerminalLinks)).toEqual(['https://example.com/hermes-link']);
    await expect(page).toHaveURL(/janet:\/\/app/);
  } finally {
    await forceClose(app);
    fs.rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('copies TUI OSC 52 selections, rejects unsolicited writes, and pastes bracketed text', async () => {
  const userData = createUserData();
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({ args: ['.'], cwd: root, env: electronEnv({ NODE_ENV: 'test', JANET_E2E_USER_DATA_DIR: userData }) });
    const page = await app.firstWindow();
    await markerPosition(page);
    const container = page.locator('.terminal-container');
    const termId = await container.getAttribute('data-terminal-id');
    const sendOutput = (data: string) => app!.evaluate(({ BrowserWindow }, payload) => {
      BrowserWindow.getAllWindows()[0].webContents.send('terminal:onData', { source: 'local', generation: 999, sequence: 999, ...payload });
    }, { id: termId, data });
    const osc = `\x1b]52;c;${Buffer.from('Hermes copied ✓').toString('base64')}\x07`;
    await app.evaluate(({ clipboard }) => clipboard.writeText('unchanged'));
    await sendOutput(osc);
    await expect(container.getByRole('button', { name: 'Allow copy' })).toBeVisible();
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('unchanged');
    await container.getByRole('button', { name: 'Dismiss' }).click();
    await container.locator('textarea').focus();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+C' : 'Control+C');
    await sendOutput(osc);
    await expect.poll(() => app!.evaluate(({ clipboard }) => clipboard.readText())).toBe('Hermes copied ✓');
    await expect(container.getByRole('button', { name: 'Allow copy' })).toHaveCount(0);

    // Intercept at the main IPC boundary to inspect the exact bytes sent to PTY.
    await app.evaluate(({ ipcMain, clipboard }) => {
      (globalThis as any).__pastedTerminalData = [];
      ipcMain.removeHandler('terminal:write');
      ipcMain.handle('terminal:write', (_event, data) => { (globalThis as any).__pastedTerminalData.push(data); });
      clipboard.writeText('first\nsecond');
    });
    await sendOutput('\x1b[?2004h\x1b[?1049h\x1b[?1003h');
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+Shift+V');
    await expect.poll(() => app!.evaluate(() => (globalThis as any).__pastedTerminalData)).toEqual([
      { id: termId, data: '\x1b[200~first\rsecond\x1b[201~', userInput: true },
    ]);
  } finally {
    await forceClose(app);
    fs.rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
