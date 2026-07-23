import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import * as fs from 'fs';
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

async function panelBoxes(page: Page) {
  const tabs = await page.locator('.vtab-bar').boundingBox();
  const terminal = await page.locator('.terminal-area').boundingBox();
  const tools = await page.locator('.workspace-tools').boundingBox();
  expect(tabs).not.toBeNull();
  expect(terminal).not.toBeNull();
  expect(tools).not.toBeNull();
  return { tabs: tabs!, terminal: terminal!, tools: tools! };
}

async function workspaceToolBoxes(page: Page) {
  const tools = await page.locator('.workspace-tools').boundingBox();
  const rail = await page.locator('.workspace-tools-rail').boundingBox();
  const panel = await page.locator('.workspace-tools-panel').boundingBox();
  expect(tools).not.toBeNull();
  expect(rail).not.toBeNull();
  expect(panel).not.toBeNull();
  return { tools: tools!, rail: rail!, panel: panel! };
}

test('keeps workspace views in their dedicated regions at desktop and minimum size', async ({}, testInfo) => {
  test.setTimeout(60_000);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'janet-workspace-layout-e2e-'));
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
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1200, 760));

    const appBody = page.locator('.app-body');
    const tabsPanel = page.locator('.vtab-bar');
    const workspaceTools = page.locator('.workspace-tools');
    await expect(page.locator('.terminal-container').first()).toBeVisible();
    await expect(appBody).toHaveClass(/sidebar-right/);
    await expect(workspaceTools).toHaveClass(/is-expanded/);
    await expect(workspaceTools.getByRole('tablist', { name: 'Workspace tool views' }))
      .toHaveAttribute('aria-orientation', 'vertical');
    await expect(workspaceTools.getByRole('tab', { name: 'Explorer' })).toHaveAttribute('aria-selected', 'true');
    await expect(workspaceTools.getByRole('tab', { name: 'Source Control' })).toHaveAttribute('aria-selected', 'false');

    const right = await panelBoxes(page);
    expect(right.tabs.x + right.tabs.width).toBeLessThanOrEqual(right.terminal.x + 1);
    expect(right.terminal.x + right.terminal.width).toBeLessThanOrEqual(right.tools.x + 1);
    const rightTools = await workspaceToolBoxes(page);
    expect(rightTools.panel.x + rightTools.panel.width).toBeLessThanOrEqual(rightTools.rail.x + 1);
    expect(Math.abs(
      rightTools.rail.x + rightTools.rail.width - (rightTools.tools.x + rightTools.tools.width),
    )).toBeLessThanOrEqual(1);

    await workspaceTools.getByRole('tab', { name: 'Source Control' }).click();
    await expect(workspaceTools.getByRole('tab', { name: 'Source Control' })).toHaveAttribute('aria-selected', 'true');

    const rightToolsScreenshot = testInfo.outputPath('workspace-right-tools.png');
    await page.screenshot({ path: rightToolsScreenshot });
    await testInfo.attach('workspace-right-tools', { path: rightToolsScreenshot, contentType: 'image/png' });

    const settingsButton = page.getByRole('button', { name: 'Open settings' });
    const settingsBounds = await settingsButton.boundingBox();
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    expect(settingsBounds).not.toBeNull();
    expect(settingsBounds!.x).toBeGreaterThan(viewport.width / 2);
    expect(viewport.width - (settingsBounds!.x + settingsBounds!.width)).toBeGreaterThanOrEqual(10);
    await settingsButton.click();
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();

    const desktopScreenshot = testInfo.outputPath('workspace-right-settings.png');
    await page.screenshot({ path: desktopScreenshot });
    await testInfo.attach('workspace-right-settings', { path: desktopScreenshot, contentType: 'image/png' });

    await page.getByRole('button', { name: 'Hide settings' }).click();
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden();

    await page.getByRole('button', { name: 'Open settings' }).click();
    await page.getByRole('button', { name: 'Left' }).click();
    await expect(appBody).toHaveClass(/sidebar-left/);
    const left = await panelBoxes(page);
    expect(left.tools.x + left.tools.width).toBeLessThanOrEqual(left.tabs.x + 1);
    expect(left.tabs.x + left.tabs.width).toBeLessThanOrEqual(left.terminal.x + 1);
    const leftTools = await workspaceToolBoxes(page);
    expect(leftTools.rail.x + leftTools.rail.width).toBeLessThanOrEqual(leftTools.panel.x + 1);
    expect(Math.abs(leftTools.rail.x - leftTools.tools.x)).toBeLessThanOrEqual(1);
    await expect(workspaceTools.getByRole('tab', { name: 'Source Control' })).toHaveAttribute('aria-selected', 'true');

    await page.getByRole('button', { name: 'Hide settings' }).click();
    await tabsPanel.getByRole('button', { name: 'SSH connections' }).click();
    await expect(page.locator('#vtab-ssh-connections')).toBeVisible();

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(800, 600));
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThanOrEqual(800);
    const compactTabs = page.getByRole('button', { name: 'Show terminal tabs' });
    await expect(compactTabs).toBeVisible();
    await expect.poll(async () => Math.round(
      await workspaceTools.evaluate((element) => element.getBoundingClientRect().width),
    )).toBe(250);

    const compactTools = await workspaceTools.boundingBox();
    const compactTabsBox = await compactTabs.boundingBox();
    const compactTerminal = await page.locator('.terminal-area').boundingBox();
    expect(compactTools).not.toBeNull();
    expect(compactTabsBox).not.toBeNull();
    expect(compactTerminal).not.toBeNull();
    expect(compactTools!.x + compactTools!.width).toBeLessThanOrEqual(compactTabsBox!.x + 1);
    expect(compactTabsBox!.x + compactTabsBox!.width).toBeLessThanOrEqual(compactTerminal!.x + 1);
    expect(compactTerminal!.x + compactTerminal!.width).toBeLessThanOrEqual(
      (await page.evaluate(() => innerWidth)) + 1,
    );
    const compactToolRegions = await workspaceToolBoxes(page);
    expect(compactToolRegions.rail.x + compactToolRegions.rail.width)
      .toBeLessThanOrEqual(compactToolRegions.panel.x + 1);
    expect(Math.abs(compactToolRegions.rail.x - compactToolRegions.tools.x)).toBeLessThanOrEqual(1);

    await compactTabs.click();
    await expect(tabsPanel).toBeVisible();
    await expect(page.locator('#vtab-ssh-connections')).toBeVisible();
    const narrow = await panelBoxes(page);
    const narrowViewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    expect(narrow.tools.x + narrow.tools.width).toBeLessThanOrEqual(narrow.tabs.x + 1);
    expect(narrow.tabs.x + narrow.tabs.width).toBeLessThanOrEqual(narrow.terminal.x + 1);
    expect(narrow.terminal.x + narrow.terminal.width).toBeLessThanOrEqual(narrowViewport.width + 1);
    expect(narrow.terminal.width).toBeGreaterThanOrEqual(300);

    const sshConnections = await page.locator('#vtab-ssh-connections').boundingBox();
    expect(sshConnections).not.toBeNull();
    expect(sshConnections!.y + sshConnections!.height).toBeLessThanOrEqual(narrow.tabs.y + narrow.tabs.height + 1);

    const narrowScreenshot = testInfo.outputPath('workspace-left-narrow-ssh.png');
    await page.screenshot({ path: narrowScreenshot });
    await testInfo.attach('workspace-left-narrow-ssh', { path: narrowScreenshot, contentType: 'image/png' });
  } finally {
    await forceClose(app);
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
