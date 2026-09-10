import { forceClose } from './electronLifecycle';
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

test('navigates, copies, and safely inserts a real semantic command', async () => {
  test.setTimeout(60_000);
  const cwd = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'janet-semantic-e2e-'));
  const userData = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'janet-semantic-profile-'));
  const markerPath = path.join(cwd, 'semantic-rerun.txt');
  const command = process.platform === 'win32'
    ? `Add-Content -NoNewline -Path 'semantic-rerun.txt' -Value 'X'; Write-Output '${OUTPUT}'`
    : `printf X >> semantic-rerun.txt; printf '${OUTPUT}\\n'`;
  let app: ElectronApplication | undefined;

  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ mainDirectory: userData,
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
    await expect(terminal.locator('.xterm-helper-textarea')).toHaveAttribute('data-shell-ready', 'true', { timeout: 15_000 });
    await terminal.click();
    await page.keyboard.type(command, { delay: 5 });
    await page.keyboard.press('Enter');

    await expect.poll(
      () => fs.existsSync(markerPath) ? fs.readFileSync(markerPath, 'utf-8') : '',
      { timeout: 15_000 },
    ).toBe('X');
    await expect.poll(() => page.locator('.xterm-rows').innerText(), { timeout: 15_000 }).toContain(OUTPUT);
    await page.getByRole('button', { name: /Open command palette/ }).click();
    await page.getByRole('option', { name: /Open command history/ }).click();
    const history = page.getByRole('dialog', { name: 'Command history' });
    await expect(history.getByRole('option', { name: command, exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await terminal.locator('.xterm-helper-textarea').focus();

    await app.evaluate(({ clipboard }) => clipboard.clear());
    await page.keyboard.press('Control+Shift+ArrowUp');
    await expect(terminal.locator('.terminal-command-selected')).toBeVisible();
    await expect.poll(() => terminal.locator('.terminal-command-selected').evaluate((element) => {
      const selected = element.getBoundingClientRect();
      const viewport = element.closest('.xterm')!.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        coversRow: selected.width >= viewport.width * 0.9,
        backgroundColor: style.backgroundColor,
        boxShadow: style.boxShadow,
      };
    })).toMatchObject({
      coversRow: true,
      backgroundColor: expect.not.stringMatching(/^rgba?\(0, 0, 0(?:, 0)?\)$/),
      boxShadow: expect.not.stringMatching(/^none$/),
    });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(900, 700));
    await expect.poll(() => terminal.locator('.terminal-command-selected').evaluate((element) => (
      element.getBoundingClientRect().width >= element.closest('.xterm')!.getBoundingClientRect().width * 0.9
    ))).toBe(true);
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

    const failingCommand = process.platform === 'win32' ? 'test' : 'false';
    await page.keyboard.type(failingCommand, { delay: 5 });
    await page.keyboard.press('Enter');
    const failureMarker = terminal.locator('.terminal-command-failed').last();
    await expect(failureMarker).toBeVisible({ timeout: 15_000 });
    const markerStyle = await failureMarker.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor,
        borderLeftWidth: style.borderLeftWidth,
        markerLeft: element.getBoundingClientRect().left,
        textLeft: element.closest('.xterm-screen')!.querySelector('.xterm-rows')!.getBoundingClientRect().left,
      };
    });
    expect(markerStyle).toMatchObject({
      backgroundColor: 'rgba(0, 0, 0, 0)',
      borderLeftWidth: '2px',
    });
    expect(markerStyle.markerLeft).toBeLessThan(markerStyle.textLeft);
  } finally {
    await forceClose(app);
    fs.rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
