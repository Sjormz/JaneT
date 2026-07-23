import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const root = path.resolve(__dirname, '../..');
const USER_DATA_PREFIX = 'janet-terminal-copy-e2e-';
const MARKER = 'JANET_TERMINAL_COPY_MARKER';

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

    await app.evaluate(({ clipboard }) => clipboard.clear());
    await selectMarker(page, position);
    await page.mouse.click(position.x, position.y, { button: 'right' });
    await expect.poll(() => app!.evaluate(({ clipboard }) => clipboard.readText())).toBe(MARKER);
  } finally {
    await forceClose(app);
    fs.rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
