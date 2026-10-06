import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createWorkspace, ensureProjectTerminalsOpen, restoreWorkspaceFixture } from './workspaces';
import { forceClose } from './electronLifecycle';

class FolderSessions {
  constructor(private page: Page, private app: ElectronApplication) {}
  async choose(directory: string, button: string) {
    await this.app.evaluate(({ dialog }, selected) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] });
    }, directory);
    await this.page.getByRole('button', { name: button, exact: true }).click();
  }
  async start(folder: string, name: string, count: number) {
    await this.page.getByRole('button', { exact: true, name: `${folder}` }).click({ button: 'right' });
    await this.page.getByRole('menuitem', { name: 'Add project', exact: true }).click();
    await this.page.getByRole('textbox', { name: 'Project name' }).fill(name);
    await ensureProjectTerminalsOpen(this.page);
    await this.page.getByRole('spinbutton', { name: 'Initial terminals' }).fill(String(count));
    await this.page.getByRole('radio', { name: 'Custom', exact: true }).check();
    await this.page.getByRole('textbox', { name: 'Custom command' }).fill('echo JANET_STARTUP_READY');
    await this.page.getByRole('button', { name: 'Create project', exact: true }).click();
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
  let failure = false;
  try {
    app = await launch();
    let page = await app.firstWindow();
    let folders = new FolderSessions(page, app);
    await expect(page.getByRole('heading', { name: 'A home for your work' })).toBeVisible();
    await expect(page.locator('.terminal-container')).toHaveCount(0);
    const onboardingClosed = app.waitForEvent('close');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await onboardingClosed; app = undefined;
    app = await launch(); page = await app.firstWindow(); folders = new FolderSessions(page, app);
    await expect(page.getByRole('heading', { name: 'A home for your work' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('main-directory-onboarding.png') });
    await folders.choose(main, 'Choose main directory');
    await expect(page.getByRole('heading', { name: 'Create your first workspace' })).toBeVisible();
    await expect(page.locator('.terminal-container')).toHaveCount(0);
    expect(fs.readdirSync(main)).toEqual([]);
    await createWorkspace(page, 'Temporary', [{}], 'First group');
    const firstTerminal = page.locator('.terminal-container').first();
    await expect(firstTerminal.locator('.xterm-helper-textarea')).toBeFocused();
    await expect(firstTerminal.locator('.xterm-helper-textarea')).toHaveAttribute('data-shell-ready', 'true', { timeout: 15_000 });
    await page.keyboard.type('echo JANET_FOCUS_CREATED');
    await page.keyboard.press('Enter');
    await expect(firstTerminal.locator('.xterm-rows')).toContainText(/JANET_FOCUS_CREATED.*JANET_FOCUS_CREATED/s);
    await page.getByRole('button', { name: 'Add terminals', exact: true }).click();
    await page.getByRole('dialog', { name: 'Add terminals' }).getByRole('button', { name: 'Add terminals', exact: true }).click();
    await expect(page.locator('.terminal-container')).toHaveCount(2);
    const addedTerminal = page.locator('.terminal-container').nth(1);
    await expect(addedTerminal.locator('.xterm-helper-textarea')).toBeFocused();
    await expect(addedTerminal.locator('.xterm-helper-textarea')).toHaveAttribute('data-shell-ready', 'true', { timeout: 15_000 });
    await page.keyboard.type('echo JANET_FOCUS_ADDED');
    await page.keyboard.press('Enter');
    await expect(addedTerminal.locator('.xterm-rows')).toContainText(/JANET_FOCUS_ADDED.*JANET_FOCUS_ADDED/s);
    await page.locator('.terminal-leaf-header').first().click({ position: { x: 20, y: 10 } });
    await expect(firstTerminal.locator('.xterm-helper-textarea')).toBeFocused();
    await page.getByRole('button', { name: 'Collapse project tools' }).click();
    await expect(page.getByRole('button', { name: 'Expand project tools' })).toBeFocused();
    await page.getByRole('button', { name: 'Expand project tools' }).click();
    fs.writeFileSync(path.join(main, 'First group', 'Temporary', 'keep.txt'), 'keep');
    await page.locator('[data-terminal-id]').evaluateAll(async (nodes) => {
      for (const node of nodes) await (window as any).janet.terminalDestroy({ id: node.getAttribute('data-terminal-id') });
    });
    await page.locator('.vtab-name').getByText('Temporary', { exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Rename project', exact: true }).click();
    await page.getByRole('textbox', { name: 'Project name', exact: true }).fill('Renamed project');
    await page.getByRole('textbox', { name: 'Project name', exact: true }).press('Enter');
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
    await page.locator('.vtab-name').getByText('Renamed project', { exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Start terminals', exact: true })).toBeVisible();
    await expect(page.locator('.terminal-container')).toHaveCount(0);
    const emptyClosed = app.waitForEvent('close');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await emptyClosed; app = undefined;
    app = await launch(); page = await app.firstWindow(); folders = new FolderSessions(page, app);
    await expect(page.getByRole('heading', { name: 'Start terminals', exact: true })).toBeVisible();
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
    await folders.choose(project, 'Add Library entry');
    await folders.start('Project X', 'Development', 3);
    await expect(page.locator('.terminal-container')).toHaveCount(3);
    await folders.start('Project X', 'Testing', 2);
    await expect(page.locator('.terminal-container')).toHaveCount(2);
    await expect.poll(() => settings().session.tabs.length).toBe(3);
    const projectGroup = settings().session.groups.find((item: any) => item.directory === project);
    const sessions = settings().session.tabs.filter((item: any) => item.groupId === projectGroup.id);
    expect(sessions.map((item: any) => item.cwd)).toEqual([project, project]);
    expect(sessions.every((item: any) => item.isProject)).toBe(true);
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
    await page.locator('.vtab-name').getByText('Development', { exact: true }).click();
    await folders.closeProjectTerminals('Development');
    await page.locator('.vtab-name').getByText('Testing', { exact: true }).click();
    await folders.closeProjectTerminals('Testing');
    await folders.projectAction('Development', 'Remove project…');
    await page.getByRole('button', { name: 'Remove project', exact: true }).click();
    await expect(page.locator('.vtab-name').getByText('Development', { exact: true })).toHaveCount(0);
    await expect(page.locator('.vtab-name').getByText('Testing', { exact: true })).toBeVisible();
    expect(fs.readdirSync(project)).toEqual(['keep.txt']);
    await page.locator('.workspace-group-name').getByText('Project X', { exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Remove from Library…', exact: true }).click();
    await page.getByRole('button', { name: 'Remove from Library', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    expect(fs.readFileSync(path.join(project, 'keep.txt'), 'utf8')).toBe('Project data');
    await expect(page.getByRole('button', { name: 'Add project to Project X' })).toHaveCount(0);
    const missing = path.join(root, 'Missing');
    fs.mkdirSync(missing);
    await folders.choose(missing, 'Add Library entry');
    fs.rmdirSync(missing);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByText('Folder unavailable', { exact: true })).toBeVisible();
    await folders.choose(project, 'Locate folder for Missing');
    await folders.start('Missing', 'Recovered', 1);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await restoreWorkspaceFixture(page, 'Missing directory recovery', [{ cwd: missing }]);
    await expect(page.getByTestId('local-terminal-notice')).toContainText('Couldn’t start local terminal');
    await folders.choose(project, 'Locate folder');
    await expect(page.getByTestId('local-terminal-notice')).toHaveCount(0);
    const repo = path.join(root, 'Repo');
    const worktree = path.join(root, 'Feature');
    execFileSync('git', ['init', repo]);
    execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'Initial']);
    execFileSync('git', ['-C', repo, 'worktree', 'add', '-b', 'feature', worktree]);
    await folders.choose(worktree, 'Add Library entry');
    await page.getByRole('button', { name: 'Feature', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Add project', exact: true }).click();
    await page.getByRole('textbox', { name: 'Project name' }).fill('Worktree review');
    await page.getByRole('button', { name: 'Create project', exact: true }).click();
    await expect(page.getByRole('img', { name: 'Worktree project' })).toBeVisible();
    expect(fs.readdirSync(worktree)).toEqual(['.git']);
    await page.screenshot({ path: testInfo.outputPath('library-worktree-project.png') });
  } catch (error) {
    failure = true;
    throw error;
  } finally {
    try {
      await forceClose(app);
      await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (error) {
      if (!failure) throw error;
      console.error('Workspace directory fixture cleanup failed:', error);
    }
  }
});

test('opens Git worktrees from Source Control as Library projects without touching their folders', async () => {
  test.setTimeout(90_000);
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'janet-worktree-e2e-'));
  const profile = path.join(root, 'profile');
  const workspace = path.join(root, 'Work');
  const app = path.join(workspace, 'App');
  const appFeature = path.join(workspace, 'App-feature');
  const repo = path.join(root, 'Repo');
  const repoFeature = path.join(root, 'Repo-feature');
  fs.mkdirSync(profile);
  fs.mkdirSync(workspace);
  for (const [directory, feature, branch] of [[app, appFeature, 'app-feature'], [repo, repoFeature, 'repo-feature']]) {
    execFileSync('git', ['init', directory]);
    execFileSync('git', ['-C', directory, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'Initial']);
    execFileSync('git', ['-C', directory, 'worktree', 'add', '-b', branch, feature]);
  }
  const leaf = (cwd: string) => ({ type: 'leaf', cwd });
  const settingsPath = path.join(profile, 'settings.json');
  fs.writeFileSync(settingsPath, JSON.stringify({ mainDirectory: root, session: {
    groups: [{ id: 'work', name: 'Work', directory: workspace }, { id: 'repo', name: 'Repo', kind: 'folder', directory: repo }],
    tabs: [
      { id: 'app', title: 'App', type: 'local', groupId: 'work', isProject: true, cwd: app, root: leaf(app) },
      { id: 'repo-project', title: 'Repo', type: 'local', groupId: 'repo', isProject: true, cwd: repo, root: leaf(repo) },
    ],
    activeTabId: 'repo-project', sidebarOpen: true, tabsOpen: true, sidebarSection: 'git',
  } }));
  const settings = () => JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'test', JANET_E2E_USER_DATA_DIR: profile };
  delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_NO_ATTACH_CONSOLE;
  let electronApp: ElectronApplication | undefined;
  let failure = false;
  try {
    electronApp = await electron.launch({ args: ['.'], cwd: path.resolve(__dirname, '../..'), env: Object.fromEntries(Object.entries(env)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')) });
    const page = await electronApp.firstWindow();
    const project = (name: string) => page.locator('.vtab-item').filter({ has: page.locator('.vtab-name', { hasText: name }) });
    await expect(project('Repo')).toHaveClass(/active/);

    // A Library repository's worktree becomes another project of that Library entry.
    await page.getByRole('button', { name: 'Open worktree Repo-feature as a Library project' }).click({ timeout: 20_000 });
    await expect(project('Repo-feature')).toHaveClass(/active/);
    await expect(page.getByRole('region', { name: 'Repo', exact: true }).locator('.project-entry')).toHaveCount(2);
    await expect(project('Repo-feature').getByRole('img', { name: 'Worktree project' })).toBeVisible();
    await expect(page.locator('.terminal-container')).toHaveCount(1);
    await expect.poll(() => settings().session.tabs.find((tab: any) => tab.title === 'Repo-feature'))
      .toMatchObject({ groupId: 'repo', cwd: repoFeature, isProject: true });

    // Renaming a worktree project changes only its label.
    await project('Repo-feature').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Rename project', exact: true }).click();
    await page.getByRole('textbox', { name: 'Project name', exact: true }).fill('Feature review');
    await page.getByRole('textbox', { name: 'Project name', exact: true }).press('Enter');
    await expect(project('Feature review')).toBeVisible();
    await expect.poll(() => settings().session.tabs.find((tab: any) => tab.title === 'Feature review')?.cwd).toBe(repoFeature);
    expect(fs.existsSync(path.join(repoFeature, '.git'))).toBe(true);

    // A Workspace project's worktree gets its own Library entry.
    await project('App').click();
    await page.getByRole('button', { name: 'Open worktree App-feature as a Library project' }).click({ timeout: 20_000 });
    const entry = page.getByRole('region', { name: 'App-feature', exact: true });
    await expect(entry.locator('.project-entry')).toHaveCount(1);
    await expect(entry.getByRole('img', { name: 'Worktree project' })).toBeVisible();
    await expect.poll(() => settings().session.groups.find((group: any) => group.directory === appFeature))
      .toMatchObject({ kind: 'folder', name: 'App-feature' });

    // Removing it, or its Library entry, never touches the worktree.
    await project('App-feature').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Remove project…', exact: true }).click();
    await page.getByRole('button', { name: 'Remove project', exact: true }).click();
    await expect(project('App-feature')).toHaveCount(0);
    await entry.locator('.workspace-group-name').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Remove from Library…', exact: true }).click();
    await page.getByRole('button', { name: 'Remove from Library', exact: true }).click();
    await expect(entry).toHaveCount(0);
    for (const folder of [appFeature, repoFeature]) expect(fs.readFileSync(path.join(folder, '.git'), 'utf8')).toMatch(/^gitdir:/);
    expect(execFileSync('git', ['-C', app, 'worktree', 'list'], { encoding: 'utf8' })).toContain('App-feature');
  } catch (error) {
    failure = true;
    throw error;
  } finally {
    try {
      await forceClose(electronApp);
      await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (error) {
      if (!failure) throw error;
      console.error('Workspace directory fixture cleanup failed:', error);
    }
  }
});

test('imports linked worktree folders as Library projects with label-only rename and removal', async () => {
  test.setTimeout(90_000);
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'janet-import-worktree-e2e-'));
  const profile = path.join(root, 'profile');
  const workspace = path.join(root, 'Imported');
  const repo = path.join(workspace, 'Repo');
  const feature = path.join(workspace, 'Feature');
  fs.mkdirSync(profile); fs.mkdirSync(workspace);
  execFileSync('git', ['init', repo]);
  execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'Initial']);
  execFileSync('git', ['-C', repo, 'worktree', 'add', '-b', 'feature', feature]);
  const marker = fs.readFileSync(path.join(feature, '.git'), 'utf8');
  fs.writeFileSync(path.join(feature, 'keep.txt'), 'keep');
  const settingsPath = path.join(profile, 'settings.json');
  fs.writeFileSync(settingsPath, JSON.stringify({ mainDirectory: root, session: {
    groups: [], tabs: [], activeTabId: null, sidebarOpen: true, tabsOpen: true, sidebarSection: 'files',
  } }));
  const settings = () => JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'test', JANET_E2E_USER_DATA_DIR: profile };
  delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_NO_ATTACH_CONSOLE;
  let app: ElectronApplication | undefined;
  let failed = false;
  try {
    app = await electron.launch({ args: ['.'], cwd: path.resolve(__dirname, '../..'), env: Object.fromEntries(Object.entries(env)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')) });
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, selected) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] });
    }, workspace);
    await page.getByRole('button', { name: 'Choose existing workspace', exact: true }).last().click();
    const entry = page.getByRole('region', { name: 'Feature', exact: true });
    await expect(entry.locator('.project-entry')).toHaveCount(1);
    await expect(page.getByRole('region', { name: 'Imported', exact: true }).locator('.project-entry')).toHaveCount(1);
    await expect(entry.getByRole('img', { name: 'Worktree project' })).toBeVisible();
    await expect.poll(() => settings().session.groups.find((group: any) => group.directory === feature)?.kind).toBe('folder');
    const folders = new FolderSessions(page, app);
    await folders.projectAction('Feature', 'Rename project');
    await page.getByRole('textbox', { name: 'Project name', exact: true }).fill('Review');
    await page.getByRole('textbox', { name: 'Project name', exact: true }).press('Enter');
    await expect.poll(() => settings().session.tabs.find((tab: any) => tab.title === 'Review')?.cwd).toBe(feature);
    await folders.projectAction('Review', 'Remove project…');
    await page.getByRole('button', { name: 'Remove project', exact: true }).click();
    await expect(entry.locator('.project-entry')).toHaveCount(0);
    expect(fs.readFileSync(path.join(feature, '.git'), 'utf8')).toBe(marker);
    expect(fs.readFileSync(path.join(feature, 'keep.txt'), 'utf8')).toBe('keep');
    expect(execFileSync('git', ['-C', repo, 'worktree', 'list'], { encoding: 'utf8' })).toContain('Feature');
  } catch (error) { failed = true; throw error; }
  finally {
    try {
      await forceClose(app);
      await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (error) { if (!failed) throw error; console.error('Import worktree cleanup failed:', error); }
  }
});
