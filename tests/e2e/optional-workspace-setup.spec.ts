import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

test('skips setup across restarts and enables workspace creation after choosing a folder', async ({}, testInfo) => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'janet-optional-setup-'));
  const workspaceRoot = path.join(userData, 'workspaces');
  fs.mkdirSync(workspaceRoot);
  const env = Object.fromEntries(Object.entries({ ...process.env, NODE_ENV: 'test', JANET_E2E_USER_DATA_DIR: userData })
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[0] !== 'ELECTRON_RUN_AS_NODE'));
  const launch = () => electron.launch({ args: ['.'], cwd: path.resolve(__dirname, '../..'), env });
  const close = async (app: ElectronApplication) => {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await app.waitForEvent('close', { timeout: 5_000 }).catch(() => {});
  };
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await page.locator('.directory-onboarding').screenshot({ path: testInfo.outputPath('optional-setup.png') });
    await page.getByRole('button', { name: 'Skip for now' }).click();
    await expect(page.getByRole('region', { name: 'Choose where to work' })).toBeVisible();
    await page.locator('.workspace-tabs-rail').screenshot({ path: testInfo.outputPath('setup-skipped.png') });
    await expect.poll(() => JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')).mainDirectorySetupSkipped).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')).mainDirectory).toBeNull();
    await close(app);
    app = await launch();
    page = await app.firstWindow();
    await expect(page.getByRole('region', { name: 'Choose where to work' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Skip for now' })).toHaveCount(0);
    await page.getByRole('button', { name: 'New workspace' }).click();
    const dialog = page.getByRole('dialog', { name: 'Main directory settings' });
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create workspace', exact: true })).toHaveCount(0);
    await app.evaluate(({ dialog }, selected) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] });
    }, workspaceRoot);
    await dialog.getByRole('button', { name: 'Choose main directory' }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole('button', { name: 'New workspace' }).click();
    await page.getByRole('textbox', { name: 'Workspace name' }).fill('First workspace');
    await page.getByRole('dialog', { name: 'Create workspace', exact: true }).getByRole('button', { name: 'Create workspace', exact: true }).click();
    await expect(page.getByRole('button', { name: /^First workspace/, expanded: true })).toBeVisible();
    expect(fs.statSync(path.join(workspaceRoot, 'First workspace')).isDirectory()).toBe(true);
  } finally {
    await close(app);
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
