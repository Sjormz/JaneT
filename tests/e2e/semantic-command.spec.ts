import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const root = path.resolve(__dirname, '../..');
const OUTPUT = 'JANET_SEMANTIC_OUTPUT';

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

test('navigates, copies, and safely inserts a real semantic command', async () => {
  test.setTimeout(60_000);
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'janet-semantic-e2e-'));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'janet-semantic-profile-'));
  const markerPath = path.join(cwd, 'semantic-rerun.txt');
  const command = process.platform === 'win32'
    ? `Add-Content -NoNewline -Path 'semantic-rerun.txt' -Value 'X'; Write-Output '${OUTPUT}'`
    : `printf X >> semantic-rerun.txt; printf '${OUTPUT}\\n'`;
  let app: ElectronApplication | undefined;

  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({
    theme: 'tokyo-night',
    fontSize: 14,
    sidebarSide: 'left',
    keybindings: {},
    workspaceTabs: [],
    session: {
      tabs: [{
        id: 'semantic-tab',
        title: 'semantic command',
        type: 'local',
        cwd,
        root: { type: 'leaf', title: 'semantic', terminalType: 'local', cwd },
      }],
      activeTabId: 'semantic-tab',
      sidebarOpen: false,
      tabsOpen: true,
      sidebarSection: 'files',
    },
  }, null, 2), 'utf-8');

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
    const terminal = page.locator('.terminal-container');
    await expect(terminal).toBeVisible({ timeout: 15_000 });
    await terminal.click();
    await page.keyboard.type(command);
    await page.keyboard.press('Enter');

    await expect.poll(
      () => fs.existsSync(markerPath) ? fs.readFileSync(markerPath, 'utf-8') : '',
      { timeout: 15_000 },
    ).toBe('X');
    await expect.poll(() => page.locator('.xterm-rows').innerText(), { timeout: 15_000 }).toContain(OUTPUT);

    await app.evaluate(({ clipboard }) => clipboard.clear());
    await page.keyboard.press('Control+Shift+ArrowUp');
    await page.keyboard.press('Control+Alt+C');
    await expect.poll(() => app!.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 10_000 }).toBe(command);

    await app.evaluate(({ clipboard }) => clipboard.clear());
    await page.keyboard.press('Control+Alt+O');
    await expect.poll(() => app!.evaluate(({ clipboard }) => clipboard.readText())).toBe(OUTPUT);

    await page.keyboard.press('Control+Alt+R');
    await page.waitForTimeout(500);
    expect(fs.readFileSync(markerPath, 'utf-8')).toBe('X');

    await page.keyboard.press('Enter');
    await expect.poll(() => fs.readFileSync(markerPath, 'utf-8'), { timeout: 15_000 }).toBe('XX');
  } finally {
    await forceClose(app);
    fs.rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
