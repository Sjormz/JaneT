import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const root = path.resolve(__dirname, '../..');
const PANE_MARKER = '__JANET_PANE_RENAME_FOCUS__';
const TAB_MARKER = '__JANET_TAB_RENAME_FOCUS__';

function electronEnv(extra: NodeJS.ProcessEnv): Record<string, string> {
  const env = { ...process.env, ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function createUserData(): string {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'janet-rename-e2e-'));
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({
    theme: 'tokyo-night',
    fontSize: 14,
    sidebarSide: 'right',
    keybindings: {},
    workspaceTabs: [],
    session: {
      tabs: [{
        id: 'rename-tab',
        title: 'Two panes',
        type: 'local',
        root: {
          type: 'split',
          direction: 'vertical',
          sizes: [1, 1],
          children: [
            { type: 'leaf', terminalType: 'local', title: 'Left' },
            { type: 'leaf', terminalType: 'local', title: 'Right' },
          ],
        },
      }],
      activeTabId: 'rename-tab',
      sidebarOpen: false,
      tabsOpen: false,
      sidebarSection: 'files',
    },
  }, null, 2), 'utf8');
  return userData;
}

async function launch(userData: string): Promise<ElectronApplication> {
  return electron.launch({
    args: ['.'],
    cwd: root,
    env: electronEnv({ NODE_ENV: 'test', JANET_E2E_USER_DATA_DIR: userData }),
  });
}

async function forceClose(app: ElectronApplication | undefined): Promise<void> {
  if (!app) return;
  const closed = app.waitForEvent('close', { timeout: 5_000 }).catch(() => {});
  try {
    await app.evaluate(({ app: electronApp }) => electronApp.exit(0));
  } catch {}
  await closed;
}

async function activeElementIs(page: Page, selector: string, index: number): Promise<boolean> {
  return page.evaluate(({ selector: targetSelector, index: targetIndex }) => (
    document.activeElement === document.querySelectorAll(targetSelector)[targetIndex]
  ), { selector, index });
}

function paneTitles(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  const node = value as { type?: unknown; title?: unknown; children?: unknown };
  if (node.type === 'leaf') return typeof node.title === 'string' ? [node.title] : [];
  return Array.isArray(node.children) ? node.children.flatMap(paneTitles) : [];
}

test('renames the focused pane and active tab without interrupting xterm input', async () => {
  test.setTimeout(60_000);
  const userData = createUserData();
  const settingsPath = path.join(userData, 'settings.json');
  let app: ElectronApplication | undefined;

  try {
    app = await launch(userData);
    let page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    const terminals = page.locator('.terminal-container');
    await expect(terminals).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Show terminal tabs' })).toBeVisible();
    await expect.poll(async () => terminals.nth(1).locator('.xterm-rows').innerText(), { timeout: 15_000 }).not.toBe('');
    const terminalInputs = page.locator('.xterm-helper-textarea');
    await expect(terminalInputs).toHaveCount(2);
    await expect(terminalInputs.nth(0)).toHaveAttribute('aria-label', 'Left — Local terminal pane');
    await expect(terminalInputs.nth(1)).toHaveAttribute('aria-label', 'Right — Local terminal pane');

    const secondInput = terminals.nth(1).locator('.xterm-helper-textarea');
    await secondInput.focus();
    await page.keyboard.press('F2');
    const paneDialog = page.getByRole('dialog', { name: 'Rename terminal' });
    await expect(paneDialog).toBeVisible();
    const paneName = paneDialog.getByRole('textbox', { name: 'Terminal name' });
    await expect(paneName).toHaveValue('Right');
    await expect(paneName).toBeFocused();
    await expect.poll(() => paneName.evaluate((input: HTMLInputElement) => ({
      start: input.selectionStart,
      end: input.selectionEnd,
    }))).toEqual({ start: 0, end: 'Right'.length });
    await page.keyboard.type('Tests');
    await paneName.press('Enter');

    await expect(page.locator('.terminal-leaf').nth(1).locator('.leaf-title-text')).toHaveText('Tests');
    await expect(secondInput).toHaveAttribute('aria-label', 'Tests — Local terminal pane');
    await expect.poll(() => activeElementIs(page, '.xterm-helper-textarea', 1)).toBe(true);
    await page.keyboard.type(`echo ${PANE_MARKER}`);
    await page.keyboard.press('Enter');
    await expect.poll(async () => terminals.nth(1).locator('.xterm-rows').innerText(), { timeout: 15_000 })
      .toContain(PANE_MARKER);

    await page.keyboard.press('Control+F2');
    const tabName = page.getByRole('dialog', { name: 'Rename tab' }).getByRole('textbox', { name: 'Tab name' });
    await expect(tabName).toHaveValue('Two panes');
    await expect(tabName).toBeFocused();
    await expect.poll(() => tabName.evaluate((input: HTMLInputElement) => ({
      start: input.selectionStart,
      end: input.selectionEnd,
    }))).toEqual({ start: 0, end: 'Two panes'.length });
    await page.keyboard.type('JaneT - fixes');
    await tabName.press('Enter');
    await expect.poll(() => activeElementIs(page, '.xterm-helper-textarea', 1)).toBe(true);
    await page.keyboard.type(`echo ${TAB_MARKER}`);
    await page.keyboard.press('Enter');
    await expect.poll(async () => terminals.nth(1).locator('.xterm-rows').innerText(), { timeout: 15_000 })
      .toContain(TAB_MARKER);

    await page.keyboard.press('F2');
    const cancelledName = page.getByRole('dialog', { name: 'Rename terminal' }).getByRole('textbox', { name: 'Terminal name' });
    await cancelledName.fill('Cancelled');
    await cancelledName.press('Escape');
    await expect(page.locator('.terminal-leaf').nth(1).locator('.leaf-title-text')).toHaveText('Tests');
    await expect.poll(() => activeElementIs(page, '.xterm-helper-textarea', 1)).toBe(true);

    await expect.poll(() => {
      const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      return {
        tabTitle: saved.session?.tabs?.[0]?.title,
        paneTitles: paneTitles(saved.session?.tabs?.[0]?.root),
      };
    }).toEqual({ tabTitle: 'JaneT - fixes', paneTitles: ['Left', 'Tests'] });

    await forceClose(app);
    app = undefined;
    app = await launch(userData);
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.terminal-leaf .leaf-title-text')).toHaveText(['Left', 'Tests']);
    await expect(page.locator('.xterm-helper-textarea').nth(0))
      .toHaveAttribute('aria-label', 'Left — Local terminal pane');
    await expect(page.locator('.xterm-helper-textarea').nth(1))
      .toHaveAttribute('aria-label', 'Tests — Local terminal pane');
    await page.getByRole('button', { name: 'Show terminal tabs' }).click();
    await expect(page.locator('.vtab-item').filter({ hasText: 'JaneT - fixes' })).toBeVisible();
  } finally {
    await forceClose(app);
    fs.rmSync(userData, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
});
