import { test, expect, _electron as electron, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { forceClose } from './electronLifecycle';
import { terminalSettings } from './workspaces';

class WorkspaceTools {
  constructor(private page: Page) {}
  async focusPane(index: number) {
    await this.page.locator('.terminal-container').nth(index).click();
  }
  async navigateParents() {
    await this.page.getByRole('button', { name: 'Browse parent folders' }).click();
  }
  async scrollSourceControl(delta: number) {
    const panel = this.page.getByRole('tabpanel', { name: 'Source Control' });
    await panel.hover();
    await this.page.mouse.wheel(0, delta);
    await expect.poll(() => panel.locator('.git-tree').evaluate((tree, direction) => Math.round(
      direction > 0 ? tree.scrollHeight - tree.clientHeight - tree.scrollTop : tree.scrollTop,
    ), delta)).toBe(0);
  }
}

test('keeps tools compact and follows the selected local pane', async ({}, testInfo) => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'janet-tools-e2e-'));
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

for (const side of ['left', 'right']) {
  test(`scrolls long Source Control lists on the ${side}`, async ({}, testInfo) => {
    const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'janet-git-scroll-'));
    const repo = path.join(root, 'repo');
    let app;
    try {
      fs.mkdirSync(repo);
      const git = (args: string[], input?: string) => execFileSync('git', args, { cwd: repo, input, encoding: 'utf8' });
      git(['init', '-b', 'main']);
      git(['-c', 'user.name=JaneT E2E', '-c', 'user.email=janet@example.invalid',
        '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'fixture']);
      git(['update-ref', '--stdin'], Array.from({ length: 32 }, (_, i) =>
        `create refs/remotes/origin/branch-${String(i).padStart(2, '0')} HEAD\n`).join(''));
      const settings = terminalSettings(repo);
      fs.writeFileSync(path.join(root, 'settings.json'), JSON.stringify({
        ...settings, sidebarSide: side,
        session: { ...settings.session, sidebarSection: 'git' },
      }));
      const env: Record<string, string> = { ...process.env, NODE_ENV: 'test', JANET_E2E_USER_DATA_DIR: root };
      delete env.ELECTRON_RUN_AS_NODE;
      delete env.ELECTRON_NO_ATTACH_CONSOLE;
      app = await electron.launch({ args: ['.'], cwd: path.resolve(__dirname, '../..'), env });
      const page = await app.firstWindow();
      const tools = new WorkspaceTools(page);
      const lastBranch = page.getByLabel('Remote branch origin/origin/branch-31', { exact: true });
      const collapse = page.getByRole('button', { name: 'Collapse project tools' });
      await expect(page.getByRole('button', { name: 'Branches 33', exact: true })).toBeVisible();
      await expect(page.locator('.xterm-helper-textarea')).toHaveAttribute('data-shell-ready', 'true');

      for (const [width, height] of [[1200, 760], [800, 600]]) {
        await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size), [width, height] as [number, number]);
        await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([width, height]);
        await tools.scrollSourceControl(-10_000);
        await expect(lastBranch).not.toBeInViewport();
        const footer = await collapse.boundingBox();
        await tools.scrollSourceControl(10_000);
        await expect(lastBranch).toBeInViewport({ ratio: 1 });
        await expect(collapse).toBeInViewport({ ratio: 1 });
        expect(await collapse.boundingBox()).toEqual(footer);
        await tools.scrollSourceControl(-10_000);
        await expect(lastBranch).not.toBeInViewport();
        await page.getByRole('button', { name: 'Current branch main', exact: true }).focus();
        for (let i = 0; i < 32; i++) await page.keyboard.press('Tab');
        await expect(lastBranch).toBeFocused();
        await expect(lastBranch).toBeInViewport({ ratio: 1 });
        await page.screenshot({ path: testInfo.outputPath(`git-scroll-${side}-${width}.png`) });
      }
    } finally {
      await forceClose(app);
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
}
