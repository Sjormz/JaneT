import { test, expect, _electron as electron, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

class WorkspaceTools {
  constructor(private page: Page) {}
  async focusPane(index: number) {
    await this.page.locator('.terminal-container').nth(index).click();
  }
  async navigateParents() {
    await this.page.getByRole('button', { name: 'Browse parent folders' }).click();
  }
}

test('keeps tools compact and follows the selected local pane', async ({}, testInfo) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'janet-tools-e2e-'));
  const first = path.join(root, 'first');
  const second = path.join(root, 'second');
  fs.mkdirSync(first); fs.mkdirSync(second);
  fs.writeFileSync(path.join(first, 'first.txt'), 'first');
  fs.writeFileSync(path.join(second, 'second.txt'), 'second');
  fs.writeFileSync(path.join(root, 'settings.json'), JSON.stringify({
    mainDirectory: root, theme: 'tokyo-night',
    session: { groups: [{ id: 'tools', name: 'Audit', directory: root }], tabs: [{
      id: 'audit', groupId: 'tools', title: 'Audit', type: 'local', cwd: first,
      root: { type: 'split', direction: 'vertical', sizes: [1, 1], children: [
        { type: 'leaf', cwd: first }, { type: 'leaf', cwd: second },
      ] },
    }], activeTabId: 'audit', sidebarOpen: true, sidebarSection: 'files' },
  }));
  const env: Record<string, string> = { ...process.env, NODE_ENV: 'test', JANET_E2E_USER_DATA_DIR: root };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await electron.launch({ args: ['.'], cwd: path.resolve(__dirname, '../..'), env });
    const page = await app.firstWindow();
    const tools = new WorkspaceTools(page);
    await expect(page.locator('.terminal-container')).toHaveCount(2);
    await tools.focusPane(0);
    await expect(page.getByRole('button', { name: 'Open file first.txt' })).toBeVisible();
    await expect(page.locator('.status-cwd')).toContainText('first');
    await expect(page.locator('.workspace-tools-following')).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Folder location' })).toHaveCount(0);
    await tools.focusPane(1);
    await expect(page.getByRole('button', { name: 'Open file second.txt' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open file first.txt' })).toHaveCount(0);
    await expect(page.locator('.status-cwd')).toContainText('second');
    await page.screenshot({ path: testInfo.outputPath('workspace-tools-compact.png') });
    await tools.navigateParents();
    await expect(page.getByRole('navigation', { name: 'Folder location' })).toBeVisible();
    const location = page.getByRole('navigation', { name: 'Folder location' });
    await expect(location).toHaveCSS('flex-wrap', 'wrap');
    expect(await location.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    const crumb = location.getByRole('button', { name: 'second', exact: true });
    await crumb.hover();
    await expect(crumb).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await page.screenshot({ path: testInfo.outputPath('workspace-tools-breadcrumb.png') });
    await crumb.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(crumb).toBeFocused();
    await expect(crumb).not.toHaveCSS('outline-style', 'none');
    await tools.navigateParents();
    await expect(page.getByRole('navigation', { name: 'Folder location' })).toHaveCount(0);
  } finally {
    if (app) await app.close();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
