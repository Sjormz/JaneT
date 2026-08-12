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
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), USER_DATA_PREFIX));
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({
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

async function shiftDragMarker(page: Page): Promise<void> {
  const rows = page.locator('.xterm-rows > div');
  const texts = await rows.allInnerTexts();
  const index = texts.findIndex((line) => line.trim() === MARKER);
  expect(index).toBeGreaterThanOrEqual(0);
  const box = await rows.nth(index).boundingBox();
  expect(box).not.toBeNull();
  const y = box!.y + box!.height / 2;
  await page.keyboard.down('Shift');
  await page.mouse.move(box!.x + 1, y);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width - 2, y, { steps: 12 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
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
    await shiftDragMarker(page);
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
