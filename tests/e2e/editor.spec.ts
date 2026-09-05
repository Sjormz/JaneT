import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page,
} from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const root = path.resolve(__dirname, '../..');
const FIXTURE_PREFIX = 'janet-editor-fixture-';
const USER_DATA_PREFIX = 'janet-editor-user-data-';

function electronEnv(extra: NodeJS.ProcessEnv): Record<string, string> {
  const env = { ...process.env, ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function createFixture(): { directory: string; fileName: string; filePath: string } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX));
  const fileName = 'editor-fixture.ts';
  const filePath = path.join(directory, fileName);
  fs.writeFileSync(filePath, 'export const answer = 41;\n', 'utf8');
  return { directory, fileName, filePath };
}

function createUserData(cwd: string): string {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), USER_DATA_PREFIX));
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ mainDirectory: userData,
    theme: 'tokyo-night',
    fontSize: 14,
    sidebarSide: 'right',
    keybindings: {},
    workspaceTabs: [],
    session: {
      tabs: [{
        id: 'editor-e2e-tab',
        title: 'Editor fixture',
        type: 'local',
        cwd,
        root: {
          type: 'leaf',
          title: 'editor fixture',
          terminalType: 'local',
          cwd,
        },
      }],
      activeTabId: 'editor-e2e-tab',
      sidebarOpen: true,
      tabsOpen: true,
      sidebarSection: 'files',
    },
  }, null, 2), 'utf8');
  return userData;
}

async function forceClose(app: ElectronApplication | undefined): Promise<void> {
  if (!app) return;
  try {
    await app.evaluate(({ app: electronApp }) => electronApp.exit(0));
  } catch {}
  await app.waitForEvent('close', { timeout: 5_000 }).catch(() => {});
}

function removeFixture(directory: string | undefined, prefix: string): void {
  if (!directory) return;
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith(prefix)) {
    throw new Error(`Refusing to remove non-fixture path: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

async function renderedEditorLines(editor: Locator): Promise<string[]> {
  const lines = await editor.locator('.view-line').allTextContents();
  return lines.map((line) => line.replace(/\u00a0/g, ' '));
}

async function replaceEditorContent(page: Page, editor: Locator, content: string): Promise<void> {
  const selectAll = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';
  await expect.poll(async () => (await renderedEditorLines(editor)).length).toBeGreaterThan(0);
  await editor.locator('.view-lines').click({ position: { x: 80, y: 10 } });
  await page.keyboard.press(selectAll);
  await page.keyboard.press('Backspace');
  await expect.poll(() => renderedEditorLines(editor)).toEqual(['']);

  await page.keyboard.insertText(content);
  await expect.poll(() => renderedEditorLines(editor)).toEqual(content.split('\n'));
}

test('project remains discoverable with zero terminals after close and restart', async () => {
  test.setTimeout(60000);
  const fixture = createFixture();
  const userData = createUserData(fixture.directory);
  const settingsPath = path.join(userData, 'settings.json');
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  settings.session.groups = [{ id: 'work', name: 'Work', directory: fixture.directory }];
  settings.session.tabs[0].groupId = 'work';
  fs.writeFileSync(settingsPath, JSON.stringify(settings));
  let app: ElectronApplication | undefined;
  const launch = () => electron.launch({ args: ['.'], cwd: root,
    env: electronEnv({ NODE_ENV: 'test', JANET_E2E_USER_DATA_DIR: userData }) });
  try {
    app = await launch();
    let page = await app.firstWindow();
    await page.getByRole('button', { name: /^Close terminal —/ }).click();
    await page.getByRole('button', { name: 'Close pane', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Project has no terminals' })).toBeVisible();
    await expect(page.locator('.vtab-item').filter({ hasText: 'Editor fixture' })).toBeVisible();
    await expect(page.locator('[data-terminal-id]')).toHaveCount(0);
    await expect.poll(() => JSON.parse(fs.readFileSync(settingsPath, 'utf8')).session.tabs[0].root.children).toEqual([]);
    expect(fs.readFileSync(fixture.filePath, 'utf8')).toContain('answer = 41');
    await forceClose(app);
    app = await launch();
    page = await app.firstWindow();
    await expect(page.getByRole('region', { name: 'Project has no terminals' })).toBeVisible();
    await expect(page.locator('.vtab-item').filter({ hasText: 'Editor fixture' })).toBeVisible();
    await expect(page.locator('[data-terminal-id]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Open terminal', exact: true }).click();
    await expect(page.locator('[data-terminal-id]')).toHaveCount(1);
    await expect(page.locator('textarea[data-shell-ready="true"]')).toBeAttached();
  } finally {
    await forceClose(app);
    removeFixture(userData, USER_DATA_PREFIX);
    removeFixture(fixture.directory, FIXTURE_PREFIX);
  }
});

test('text-size slider resizes an open editor without reopening the file', async () => {
  const fixture = createFixture();
  const userData = createUserData(fixture.directory);
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({ args: ['.'], cwd: root,
      env: electronEnv({ NODE_ENV: 'test', JANET_E2E_USER_DATA_DIR: userData }) });
    const page = await app.firstWindow();
    await page.getByRole('button', { name: `Open file ${fixture.fileName}` }).click();
    const lines = page.locator('.monaco-editor-host .view-lines').first();
    await expect(lines).toHaveCSS('font-size', '14px');
    await page.getByRole('button', { name: 'Open settings', exact: true }).click();
    const slider = page.getByRole('slider', { name: 'Terminal and editor text size' });
    await slider.focus();
    await slider.press('Home');
    await expect(lines).toHaveCSS('font-size', '10px');
    await slider.press('End');
    await expect(lines).toHaveCSS('font-size', '24px');
    await expect.poll(async () => JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')).fontSize).toBe(24);
  } finally {
    await forceClose(app);
    removeFixture(userData, USER_DATA_PREFIX);
    removeFixture(fixture.directory, FIXTURE_PREFIX);
  }
});

test('edits a local file with Monaco under the packaged JaneT origin', async ({}, testInfo) => {
  test.setTimeout(90_000);
  let app: ElectronApplication | undefined;
  let fixtureDirectory: string | undefined;
  let userData: string | undefined;

  try {
    const fixture = createFixture();
    fixtureDirectory = fixture.directory;
    userData = createUserData(fixture.directory);
    const started = performance.now();
    app = await electron.launch({
      args: ['.'],
      cwd: root,
      env: electronEnv({
        NODE_ENV: 'test',
        JANET_E2E_USER_DATA_DIR: userData,
      }),
    });
    const page = await app.firstWindow();
    const runtimeErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') runtimeErrors.push(message.text());
    });
    page.on('pageerror', (error) => runtimeErrors.push(error.message));
    await page.waitForLoadState('domcontentloaded');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1280, 760));

    expect(page.url()).toBe('janet://app/index.html');
    const editorStarted = performance.now();
    await page.getByRole('button', { name: `Open file ${fixture.fileName}` }).click();
    const editor = page.locator('.monaco-editor-host');
    const input = page.getByRole('textbox', { name: `Editing ${fixture.fileName}` });
    await expect(editor).toBeVisible({ timeout: 20_000 });
    await expect(input).toBeAttached({ timeout: 20_000 });
    await expect.poll(
      () => page.workers().some((worker) => /(?:editor|ts)\.worker-.*\.js/.test(worker.url())),
      { timeout: 20_000 },
    ).toBe(true);
    const baselinePath = testInfo.outputPath('editor-performance-baseline.json');
    fs.writeFileSync(baselinePath, JSON.stringify({ platform: process.platform, launchToEditorMs: performance.now() - started, firstEditorOpenMs: performance.now() - editorStarted }));
    await testInfo.attach('editor-performance-baseline', {
      path: baselinePath,
      contentType: 'application/json',
    });

    const primaryContent = 'export const answer: number = 42;\n';
    const save = process.platform === 'darwin' ? 'Meta+S' : 'Control+S';
    await replaceEditorContent(page, editor, primaryContent);
    await expect(page.getByRole('tab', { name: `${fixture.fileName}, unsaved changes` })).toBeVisible();
    await page.keyboard.press(save);
    await expect.poll(() => fs.readFileSync(fixture.filePath, 'utf8')).toBe(primaryContent);
    await expect(page.getByRole('tab', { name: fixture.fileName, exact: true })).toBeVisible();

    const editorContent = 'export const answer: number = 43;\n';
    await replaceEditorContent(page, editor, editorContent);
    fs.writeFileSync(fixture.filePath, 'export const external = true;\n', 'utf8');
    await page.keyboard.press(save);
    let dialog = await page.getByRole('alertdialog', { name: `Overwrite newer changes to ${fixture.fileName}?` });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    expect(fs.readFileSync(fixture.filePath, 'utf8')).toBe('export const external = true;\n');

    await editor.locator('.view-lines').click({ position: { x: 80, y: 10 } });
    await page.keyboard.press(save);
    dialog = page.getByRole('alertdialog', { name: `Overwrite newer changes to ${fixture.fileName}?` });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Overwrite file' }).click();
    await expect.poll(() => fs.readFileSync(fixture.filePath, 'utf8')).toBe(editorContent);

    const screenshot = testInfo.outputPath('monaco-editor-local-file.png');
    await page.screenshot({ path: screenshot });
    await testInfo.attach('monaco-editor-local-file', { path: screenshot, contentType: 'image/png' });

    await replaceEditorContent(page, editor, 'export const unsaved = true;\n');
    await page.evaluate(() => window.janet.windowClose());
    dialog = page.getByRole('alertdialog', { name: /Save 1 changed file before closing JaneT\?/ });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(editor).toBeVisible();

    await page.getByRole('button', { name: `Close ${fixture.fileName}` }).click();
    dialog = page.getByRole('alertdialog', { name: `Save changes to ${fixture.fileName}?` });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: `Close ${fixture.fileName}` }).click();
    dialog = page.getByRole('alertdialog', { name: `Save changes to ${fixture.fileName}?` });
    await dialog.getByRole('button', { name: "Don't Save" }).click();
    await expect(page.locator('.terminal-container').first()).toBeVisible();

    expect(runtimeErrors.filter((message) => (
      /content security policy|worker.*(?:failed|error)|failed to load monaco|react-refresh/i.test(message)
    ))).toEqual([]);
  } finally {
    await forceClose(app);
    removeFixture(userData, USER_DATA_PREFIX);
    removeFixture(fixtureDirectory, FIXTURE_PREFIX);
  }
});
