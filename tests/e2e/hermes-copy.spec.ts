import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

test('copies an ordinary drag selection from the installed Hermes TUI', async ({}, testInfo) => {
  test.skip(!process.env.JANET_TEST_HERMES, 'Requires an installed Hermes executable');
  test.setTimeout(90_000);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'janet-hermes-copy-'));
  const hermesHome = path.join(profile, 'hermes');
  fs.mkdirSync(hermesHome);
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ mainDirectory: profile,
    theme: 'one-dark', fontSize: 14, sidebarSide: 'right', keybindings: {}, workspaceTabs: [],
    session: { tabs: [{ id: 'hermes-copy', title: 'Hermes copy', type: 'local', root: {
      type: 'leaf', title: 'Hermes copy', terminalType: 'local', startupCommands: ['hermes --tui'],
    } }], activeTabId: 'hermes-copy', sidebarOpen: false, tabsOpen: false, sidebarSection: 'files' },
  }));
  const env = Object.fromEntries(Object.entries({ ...process.env, NODE_ENV: 'test',
    JANET_E2E_USER_DATA_DIR: profile, JANET_TERMINAL_DIAGNOSTICS: '1', HERMES_HOME: hermesHome,
  }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({ args: ['.'], cwd: path.resolve(__dirname, '../..'), env });
    const page = await app.firstWindow();
    await expect(page.locator('.xterm-rows')).toContainText('Hermes', { timeout: 60_000 });
    const marker = 'Messenger of the Digital Gods';
    await expect(page.locator('.xterm-rows')).toContainText(marker);
    const rect = await page.locator('.xterm-rows').evaluate((rows, marker) => {
      const row = Array.from(rows.children).find((row) => row.textContent?.includes(marker));
      if (!row) throw new Error('Marker row not found');
      const start = row.textContent!.indexOf(marker);
      const end = start + marker.length;
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      let offset = 0;
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const length = node.textContent!.length;
        if (start >= offset && start < offset + length) range.setStart(node, start - offset);
        if (end > offset && end <= offset + length) {
          range.setEnd(node, end - offset);
          const box = range.getBoundingClientRect();
          return { x: box.x, y: box.y, width: box.width, height: box.height };
        }
        offset += length;
      }
      throw new Error('Marker text range not found');
    }, marker);
    await app.evaluate(({ clipboard }) => clipboard.writeText('UNCHANGED'));
    await page.mouse.move(rect.x + 1, rect.y + rect.height / 2);
    await page.mouse.down();
    await page.mouse.move(rect.x + rect.width - 1, rect.y + rect.height / 2, { steps: 20 });
    await page.mouse.up();
    await page.keyboard.press('Control+Shift+C');
    const screenshot = testInfo.outputPath('hermes-copy.png');
    await page.screenshot({ path: screenshot });
    await testInfo.attach('hermes-copy', { path: screenshot, contentType: 'image/png' });
    await expect.poll(() => app!.evaluate(({ clipboard }) => clipboard.readText())).toBe(marker);
    const width = await page.locator('.xterm-screen').evaluate((screen) => screen.clientWidth);
    await app.evaluate(({ BrowserWindow, clipboard }) => {
      clipboard.writeText('UNCHANGED_AFTER_REDRAW');
      BrowserWindow.getAllWindows()[0].setSize(1100, 780);
    });
    await expect.poll(() => page.locator('.xterm-screen').evaluate((screen) => screen.clientWidth)).not.toBe(width);
    await expect(page.locator('.xterm-rows')).toContainText(marker);
    await page.keyboard.press('Control+Shift+C');
    await expect.poll(() => app!.evaluate(({ clipboard }) => clipboard.readText())).toBe(marker);
  } finally {
    if (app) await app.evaluate(({ app: application }) => application.exit(0)).catch(() => {});
    if (app) await app.waitForEvent('close', { timeout: 5000 }).catch(() => {});
    await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
