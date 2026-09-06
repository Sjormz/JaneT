import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createWorkspace } from './workspaces';

class FolderSessions {
  constructor(private page: Page, private app: ElectronApplication) {}
  async choose(directory: string, button: string) {
    await this.app.evaluate(({ dialog }, selected) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] });
    }, directory);
    await this.page.getByRole('button', { name: button, exact: true }).click();
  }
  async start(folder: string, name: string, count: number) {
    await this.page.getByRole('button', { name: `Start new session in ${folder}` }).click();
    await this.page.getByRole('textbox', { name: 'Session name (optional)' }).fill(name);
    await this.page.getByRole('combobox', { name: 'Initial terminals' }).selectOption(String(count));
    await this.page.getByRole('button', { name: 'Start session', exact: true }).click();
  }
  async close(name: string) {
    await this.page.locator('.vtab-name').getByText(name, { exact: true }).click({ button: 'right' });
    await this.page.getByRole('menuitem', { name: 'Close session', exact: true }).click();
    const confirmation = this.page.getByRole('alertdialog', { name: `Close ${name}?`, exact: true });
    if (await confirmation.waitFor({ state: 'visible', timeout: 1000 }).then(() => true, () => false)) {
      await confirmation.getByRole('button', { name: 'Close tab', exact: true }).click();
    }
    await expect(this.page.locator('.vtab-name').getByText(name, { exact: true })).toHaveCount(0);
  }
  async closeProjectTerminals(name: string) {
    await this.projectAction(name, 'Close all terminals…');
    await this.page.getByRole('alertdialog').getByRole('button', { name: 'Close all terminals', exact: true }).click();
    await expect(this.page.locator('.vtab-name').getByText(name, { exact: true })).toBeVisible();
    await expect(this.page.locator('.terminal-container')).toHaveCount(0);
  }
  async projectAction(name: string, action: string, destination?: string) {
    if (destination) await this.app.evaluate(({ dialog }, selected) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] });
    }, destination);
    await this.page.locator('.vtab-name').getByText(name, { exact: true }).click({ button: 'right' });
    await this.page.getByRole('menuitem', { name: action, exact: true }).click();
  }
  async workspaceAction(name: string, action: string) {
    await this.page.locator('.workspace-group-name').getByText(name, { exact: true }).click({ button: 'right' });
    await this.page.getByRole('menuitem', { name: action, exact: true }).click();
  }
}

test('sets up a main directory and restores independent linked-folder sessions', async ({}, testInfo) => {
  test.setTimeout(90_000);
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'janet-folder-e2e-'));
  const profile = path.join(root, 'profile');
  const main = path.join(root, 'JaneT');
  const project = path.join(root, 'Project X');
  const nextMain = path.join(root, 'New home');
  for (const directory of [profile, main, project, nextMain]) fs.mkdirSync(directory);
  fs.writeFileSync(path.join(project, 'keep.txt'), 'Project data');
  const settingsPath = path.join(profile, 'settings.json');
  const settings = () => JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'test', JANET_E2E_USER_DATA_DIR: profile };
  delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_NO_ATTACH_CONSOLE;
  const launch = () => electron.launch({ args: ['.'], cwd: path.resolve(__dirname, '../..'), env: Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) });
  let app: ElectronApplication | undefined;
  try {
    app = await launch();
    let page = await app.firstWindow();
    let folders = new FolderSessions(page, app);
    await expect(page.getByRole('heading', { name: 'A home for your work' })).toBeVisible();
    await expect(page.locator('.terminal-container')).toHaveCount(0);
    const onboardingClosed = app.waitForEvent('close');
    await page.getByRole('button', { name: 'Quit JaneT' }).click();
    await onboardingClosed; app = undefined;
    app = await launch(); page = await app.firstWindow(); folders = new FolderSessions(page, app);
    await expect(page.getByRole('heading', { name: 'A home for your work' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('main-directory-onboarding.png') });
    await folders.choose(main, 'Choose main directory');
    await expect(page.getByRole('heading', { name: 'Create your first workspace' })).toBeVisible();
    await expect(page.locator('.terminal-container')).toHaveCount(0);
    expect(fs.readdirSync(main)).toEqual([]);
    await createWorkspace(page, 'Temporary', [{}], 'First group');
    await page.getByRole('button', { name: 'Local terminal in project Temporary', exact: true }).click();
    await expect(page.locator('.terminal-container')).toHaveCount(2);
    fs.writeFileSync(path.join(main, 'First group', 'Temporary', 'keep.txt'), 'keep');
    await page.locator('[data-terminal-id]').evaluateAll(async (nodes) => {
      for (const node of nodes) await (window as any).janet.terminalDestroy({ id: node.getAttribute('data-terminal-id') });
    });
    await page.locator('.vtab-name').getByText('Temporary', { exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Rename project', exact: true }).click();
    await page.getByRole('textbox', { name: 'Tab name', exact: true }).fill('Renamed project');
    await page.getByRole('textbox', { name: 'Tab name', exact: true }).press('Enter');
    await expect.poll(() => fs.existsSync(path.join(main, 'First group', 'Renamed project', 'keep.txt'))).toBe(true);
    await expect.poll(() => settings().session.tabs[0]?.cwd).toBe(path.join(main, 'First group', 'Renamed project'));
    await folders.closeProjectTerminals('Renamed project');
    await page.locator('.workspace-group-name').getByText('First group', { exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Rename workspace', exact: true }).click();
    await page.getByRole('textbox', { name: 'Workspace name', exact: true }).fill('CON');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('folder name');
    await page.getByRole('textbox', { name: 'Workspace name', exact: true }).fill('Renamed workspace');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0).catch(async () => { throw new Error(await page.getByRole('dialog').innerText()); });
    expect(fs.readFileSync(path.join(main, 'Renamed workspace', 'Renamed project', 'keep.txt'), 'utf8')).toBe('keep');
    await page.getByRole('button', { name: 'Local terminal in Renamed workspace', exact: true }).click();
    await expect(page.locator('.terminal-container')).toHaveCount(1);
    await expect.poll(() => settings().session.tabs.find((tab: any) => tab.title === 'Local session')?.cwd).toBe(path.join(main, 'Renamed workspace'));
    await folders.closeProjectTerminals('Local session');
    await expect(page.getByText('No terminals open', { exact: true })).toBeVisible();
    await expect(page.locator('.terminal-container')).toHaveCount(0);
    const emptyClosed = app.waitForEvent('close');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await emptyClosed; app = undefined;
    app = await launch(); page = await app.firstWindow(); folders = new FolderSessions(page, app);
    await expect(page.getByText('No terminals open', { exact: true })).toBeVisible();
    await expect(page.locator('.terminal-container')).toHaveCount(0);
    await createWorkspace(page, 'Experiment A', [{}, {}], 'Research');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(fs.existsSync(path.join(main, 'Research', 'Experiment A'))).toBe(true);
    fs.writeFileSync(path.join(main, 'Research', 'Experiment A', 'keep.txt'), 'promoted data');
    await folders.projectAction('Experiment A', 'Keep in Library…', root);
    await page.getByRole('button', { name: 'Keep in Library', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(fs.readFileSync(path.join(root, 'Experiment A', 'keep.txt'), 'utf8')).toBe('promoted data');
    expect(fs.existsSync(path.join(main, 'Research', 'Experiment A'))).toBe(false);
    await expect.poll(() => settings().session.groups.some((group: any) => group.kind === 'folder' && group.directory === path.join(root, 'Experiment A'))).toBe(true);
    await folders.workspaceAction('Renamed workspace', 'Delete workspace…');
    await page.getByRole('button', { name: 'Delete to Recycle Bin', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    expect(fs.existsSync(path.join(main, 'Renamed workspace'))).toBe(false);
    await folders.choose(project, 'Add to Library');
    await folders.start('Project X', 'Development', 3);
    await expect(page.locator('.terminal-container')).toHaveCount(3);
    await folders.start('Project X', 'Testing', 2);
    await expect(page.locator('.terminal-container')).toHaveCount(2);
    await expect.poll(() => settings().session.tabs.length).toBe(3);
    const projectGroup = settings().session.groups.find((item: any) => item.directory === project);
    const sessions = settings().session.tabs.filter((item: any) => item.groupId === projectGroup.id);
    expect(sessions.map((item: any) => item.cwd)).toEqual([project, project]);
    expect(fs.readdirSync(project)).toEqual(['keep.txt']);
    await page.screenshot({ path: testInfo.outputPath('linked-folder-sessions.png') });
    await page.getByRole('button', { name: 'Main directory settings', exact: true }).click();
    await folders.choose(nextMain, 'Change main directory');
    await expect.poll(() => settings().mainDirectory).toBe(nextMain);
    await page.keyboard.press('Escape');
    await createWorkspace(page, 'Second', [{}], 'New research');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(fs.existsSync(path.join(nextMain, 'New research', 'Second'))).toBe(true);
    await folders.projectAction('Second', 'Delete project…');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(fs.existsSync(path.join(nextMain, 'New research', 'Second'))).toBe(true);
    await folders.projectAction('Second', 'Delete project…');
    await page.getByRole('button', { name: 'Delete to Recycle Bin', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    expect(fs.existsSync(path.join(nextMain, 'New research', 'Second'))).toBe(false);
    const closed = app.waitForEvent('close');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await closed; app = undefined;
    app = await launch(); page = await app.firstWindow(); folders = new FolderSessions(page, app);
    await expect(page.getByRole('heading', { name: 'A home for your work' })).toHaveCount(0);
    await page.locator('.vtab-name').getByText('Experiment A', { exact: true }).click();
    await expect(page.locator('.terminal-container')).toHaveCount(2);
    expect(fs.readFileSync(path.join(root, 'Experiment A', 'keep.txt'), 'utf8')).toBe('promoted data');
    await page.locator('.vtab-name').getByText('Development', { exact: true }).click();
    await expect(page.locator('.terminal-container')).toHaveCount(3);
    await page.locator('.vtab-name').getByText('Testing', { exact: true }).click();
    await expect(page.locator('.terminal-container')).toHaveCount(2);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await folders.close('Development');
    await folders.close('Testing');
    await page.locator('.workspace-group-name').getByText('Project X', { exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Remove from Library…', exact: true }).click();
    await page.getByRole('button', { name: 'Remove from Library', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    expect(fs.readFileSync(path.join(project, 'keep.txt'), 'utf8')).toBe('Project data');
    await expect(page.getByRole('button', { name: 'Start new session in Project X' })).toHaveCount(0);
    const missing = path.join(root, 'Missing');
    fs.mkdirSync(missing);
    await folders.choose(missing, 'Add to Library');
    fs.rmdirSync(missing);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByText('Folder unavailable', { exact: true })).toBeVisible();
    await folders.choose(project, 'Locate folder for Missing');
    await folders.start('Missing', 'Recovered', 1);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await createWorkspace(page, 'Missing directory recovery', [{ cwd: missing }]);
    await expect(page.getByTestId('local-terminal-notice')).toContainText('Couldn’t start local terminal');
    await folders.choose(project, 'Locate folder');
    await expect(page.getByTestId('local-terminal-notice')).toHaveCount(0);
  } finally {
    if (app) {
      const stopped = app.waitForEvent('close', { timeout: 5000 });
      await app.evaluate(({ app: instance }) => instance.exit(0)).catch(() => {});
      await stopped;
    }
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
