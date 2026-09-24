import { test, expect, _electron as electron } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { forceClose } from './electronLifecycle';

test('skips setup across restarts and enables workspace creation after choosing a folder', async ({}, testInfo) => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'janet-optional-setup-'));
  const workspaceRoot = path.join(userData, 'workspaces');
  fs.mkdirSync(workspaceRoot);
  const env = Object.fromEntries(Object.entries({ ...process.env, NODE_ENV: 'test', JANET_E2E_USER_DATA_DIR: userData })
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[0] !== 'ELECTRON_RUN_AS_NODE'));
  const launch = () => electron.launch({ args: ['.'], cwd: path.resolve(__dirname, '../..'), env });
  let app = await launch();
  try {
    let page = await app.firstWindow({ timeout: 10_000 });
    await page.locator('.directory-onboarding').screenshot({ path: testInfo.outputPath('optional-setup.png') });
    await page.getByRole('button', { name: 'Skip for now' }).click();
    await expect(page.getByRole('region', { name: 'Choose where to work' })).toBeVisible();
    await page.locator('.workspace-tabs-rail').screenshot({ path: testInfo.outputPath('setup-skipped.png') });
    await expect.poll(() => JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')).mainDirectorySetupSkipped).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')).mainDirectory).toBeNull();
    await forceClose(app);
    app = await launch();
    page = await app.firstWindow({ timeout: 10_000 });
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
    await forceClose(app);
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test('chooses an existing workspace and restores only its immediate folders as projects', async () => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'janet-import-e2e-'));
  const userData = path.join(root, 'profile');
  const workspace = path.join(root, 'Existing workspace');
  fs.mkdirSync(userData);
  fs.mkdirSync(path.join(workspace, 'Alpha', 'Nested'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'Beta'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'notes.txt'), 'keep');
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'test', JANET_E2E_USER_DATA_DIR: userData };
  delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_NO_ATTACH_CONSOLE;
  const launch = () => electron.launch({ args: ['.'], cwd: path.resolve(__dirname, '../..'), env: Object.fromEntries(Object.entries(env)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')) });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await page.getByRole('button', { name: 'Skip for now' }).click();
    await app.evaluate(({ dialog }, selected) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] });
    }, workspace);
    await page.getByRole('button', { name: 'Choose existing workspace' }).last().click();
    const group = page.getByRole('region', { name: 'Existing workspace' });
    await expect(group.locator('.project-entry')).toHaveCount(2);
    await expect(group.getByText('Alpha', { exact: true })).toBeVisible();
    await expect(group.getByText('Beta', { exact: true })).toBeVisible();
    await expect(group.getByText('Nested', { exact: true })).toHaveCount(0);
    const settingsPath = path.join(userData, 'settings.json');
    await expect.poll(() => JSON.parse(fs.readFileSync(settingsPath, 'utf8')).session.tabs.length).toBe(2);
    const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    expect(saved.mainDirectory).toBeNull();
    expect(saved.session.tabs.map((tab: { cwd: string; isProject: boolean; root: { children: unknown[] } }) => [tab.cwd, tab.isProject, tab.root.children.length])).toEqual([
      [path.join(workspace, 'Alpha'), true, 0], [path.join(workspace, 'Beta'), true, 0],
    ]);
    expect(fs.readFileSync(path.join(workspace, 'notes.txt'), 'utf8')).toBe('keep');
    expect(fs.statSync(path.join(workspace, 'Alpha', 'Nested')).isDirectory()).toBe(true);
    await forceClose(app);
    app = await launch(); page = await app.firstWindow();
    await expect(page.getByRole('region', { name: 'Existing workspace' }).locator('.project-entry')).toHaveCount(2);
  } finally {
    await forceClose(app);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
