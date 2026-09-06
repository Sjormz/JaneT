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
}

test('creates grouped live workspaces and restores them after closing without a save action', async ({}, testInfo) => {
  test.setTimeout(90_000);
  const userData = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'janet-groups-e2e-'));
  const settingsPath = path.join(userData, 'settings.json');
  const legacy = [{ id: 'legacy', name: 'Old setup', type: 'local', terminalCount: 1, splitDirection: 'vertical' }];
  const legacyFile = path.join(userData, 'legacy-files-stay.txt');
  fs.writeFileSync(legacyFile, 'keep');
  fs.writeFileSync(settingsPath, JSON.stringify({ mainDirectory: userData, theme: 'one-dark', workspaceTabs: legacy,
    session: { groups: [{ id: 'default', name: 'Old workspace' }], tabs: [] } }));
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'test', JANET_E2E_USER_DATA_DIR: userData };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  const launch = () => electron.launch({ args: ['.'], cwd: path.resolve(__dirname, '../..'), env: Object.fromEntries(Object.entries(env).filter((item): item is [string, string] => typeof item[1] === 'string')) });
  let app: ElectronApplication | undefined;
  try {
    app = await launch();
    let page = await app.firstWindow();
    await page.locator('.workspace-group-name').getByText('Old workspace', { exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Remove workspace…' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove workspace', exact: true }).click();
    await expect(page.locator('.workspace-group-name').getByText('Old workspace', { exact: true })).toHaveCount(0);
    await expect.poll(() => JSON.parse(fs.readFileSync(settingsPath, 'utf8')).session?.groups).toEqual([]);
    expect(fs.readFileSync(legacyFile, 'utf8')).toBe('keep');
    await expect(page.getByRole('heading', { name: 'Create your first workspace' })).toBeVisible();
    await expect(page.locator('.terminal-container')).toHaveCount(0);
    const workspaces = new Workspaces(page);
    await workspaces.create('Experiments', 3, 'Research');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.terminal-container')).toHaveCount(3);
    await expect(page.getByRole('button', { name: /^Research/, expanded: true })).toBeVisible();
    await page.getByRole('button', { name: /^Research/, expanded: true }).click();
    await workspaces.create('Review', 2, 'Archive');
    await expect(page.locator('.terminal-container')).toHaveCount(2);
    await expect.poll(() => JSON.parse(fs.readFileSync(settingsPath, 'utf8')).session?.tabs.length).toBe(2);
    expect(fs.existsSync(path.join(userData, 'Research', 'Experiments'))).toBe(true);
    expect(fs.existsSync(path.join(userData, 'Archive', 'Review'))).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('grouped-workspaces.png') });
    await page.getByRole('button', { name: 'New project in Archive', exact: true }).click();
    await page.getByRole('spinbutton', { name: 'Initial terminals' }).fill('4');
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
    expect(saved.session.tabs.filter((tab: { groupId: string }) => tab.groupId === archive.id)).toHaveLength(1);
    app = await launch();
    page = await app.firstWindow();
    await expect(page.getByRole('button', { name: /^Research/, expanded: false })).toBeVisible();
    await expect(page.locator('.vtab-item').filter({ hasText: 'Review' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.terminal-container')).toHaveCount(2);
    await page.getByRole('button', { name: /^Research/, expanded: false }).click();
    await page.locator('.vtab-item').filter({ hasText: 'Experiments' }).click();
    await expect(page.locator('.terminal-container')).toHaveCount(3);
    await expect(page.getByText('Presets', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Save workspace|Save current workspace/ })).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
  } finally {
    if (app) await app.close();
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
