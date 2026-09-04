import { test, expect, _electron as electron, type Page, type ElectronApplication } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createWorkspace } from './workspaces';

class Workspaces {
  constructor(private page: Page) {}
  async create(name: string, count: number, newGroup?: string) {
    await createWorkspace(this.page, name, Array.from({ length: count }, () => ({})), newGroup);
  }
  async addGroup(name: string) {
    await this.page.getByRole('button', { name: 'New workspace or group' }).click();
    await this.page.getByRole('button', { name: 'Group', exact: true }).click();
    await this.page.getByRole('textbox', { name: 'Group name', exact: true }).fill(name);
    await this.page.getByRole('button', { name: 'Create group', exact: true }).click();
  }
}

test('creates grouped live workspaces and restores them after closing without a save action', async ({}, testInfo) => {
  test.setTimeout(90_000);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'janet-groups-e2e-'));
  const settingsPath = path.join(userData, 'settings.json');
  const legacy = [{ id: 'legacy', name: 'Old setup', type: 'local', terminalCount: 1, splitDirection: 'vertical' }];
  fs.writeFileSync(settingsPath, JSON.stringify({ mainDirectory: userData, theme: 'one-dark', workspaceTabs: legacy }));
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'test', JANET_E2E_USER_DATA_DIR: userData };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  const launch = () => electron.launch({ args: ['.'], cwd: path.resolve(__dirname, '../..'), env: Object.fromEntries(Object.entries(env).filter((item): item is [string, string] => typeof item[1] === 'string')) });
  let app: ElectronApplication | undefined;
  try {
    app = await launch();
    let page = await app.firstWindow();
    await expect(page.locator('.terminal-container')).toHaveCount(1);
    await page.getByRole('button', { name: 'Dismiss get started' }).click();
    const workspaces = new Workspaces(page);
    await workspaces.create('Experiments', 3, 'Research');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.terminal-container')).toHaveCount(3);
    await expect(page.getByRole('button', { name: /^Research/, expanded: true })).toBeVisible();
    const firstIds = await page.locator('.terminal-container').evaluateAll((nodes) => nodes.map((node) => node.id));
    await workspaces.addGroup('Archive');
    await page.getByRole('button', { name: /^Experiments Local/ }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Move to Archive' }).click();
    expect(await page.locator('.terminal-container').evaluateAll((nodes) => nodes.map((node) => node.id))).toEqual(firstIds);
    await page.getByRole('button', { name: /^Research/, expanded: true }).click();
    await workspaces.create('Review', 2);
    await expect(page.locator('.terminal-container')).toHaveCount(2);
    await expect.poll(() => JSON.parse(fs.readFileSync(settingsPath, 'utf8')).session?.tabs.length).toBe(3);
    await page.screenshot({ path: testInfo.outputPath('grouped-workspaces.png') });
    await page.getByRole('button', { name: 'New workspace or group' }).click();
    await page.getByRole('combobox', { name: 'Initial terminals' }).selectOption('4');
    await page.screenshot({ path: testInfo.outputPath('workspace-creation.png') });
    await page.getByRole('button', { name: 'Close creation dialog' }).click();
    const closed = app.waitForEvent('close');
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close(); });
    await closed;
    app = undefined;
    const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    expect(saved.workspaceTabs).toEqual(legacy);
    expect(saved.session.groups).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Research', collapsed: true }),
      expect.objectContaining({ name: 'Archive' }),
    ]));
    const archive = saved.session.groups.find((group: { name: string }) => group.name === 'Archive');
    expect(saved.session.tabs.filter((tab: { groupId: string }) => tab.groupId === archive.id)).toHaveLength(2);
    app = await launch();
    page = await app.firstWindow();
    await expect(page.getByRole('button', { name: /^Research/, expanded: false })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Review Local/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.terminal-container')).toHaveCount(2);
    await page.getByRole('button', { name: /^Experiments Local/ }).click();
    await expect(page.locator('.terminal-container')).toHaveCount(3);
    await expect(page.getByText('Presets', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Save workspace|Save current workspace/ })).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
  } finally {
    if (app) await app.close();
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
