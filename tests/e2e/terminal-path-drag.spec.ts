import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type JSHandle,
  type Locator,
  type Page,
} from '@playwright/test';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const root = path.resolve(__dirname, '../..');
const REPO_PREFIX = 'janet-path-drag-repo-';
const USER_DATA_PREFIX = 'janet-path-drag-user-data-';

function electronEnv(extra: NodeJS.ProcessEnv): Record<string, string> {
  const env = { ...process.env, ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function createRepositoryFixture(): { repoPath: string; fileName: string; filePath: string } {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), REPO_PREFIX));
  const fileName = "drag target's file.txt";
  const filePath = path.join(repoPath, fileName);

  try {
    execFileSync('git', ['init', '--quiet'], { cwd: repoPath });
    execFileSync('git', ['config', 'user.name', 'JaneT E2E'], { cwd: repoPath });
    execFileSync('git', ['config', 'user.email', 'janet-e2e@example.invalid'], { cwd: repoPath });
    execFileSync('git', ['config', 'commit.gpgSign', 'false'], { cwd: repoPath });
    fs.writeFileSync(filePath, 'committed\n', 'utf-8');
    execFileSync('git', ['add', '--', fileName], { cwd: repoPath });
    execFileSync('git', ['commit', '--quiet', '-m', 'seed drag fixture'], { cwd: repoPath });
    fs.appendFileSync(filePath, 'modified\n', 'utf-8');
    return { repoPath, fileName, filePath };
  } catch (error) {
    removeFixture(repoPath, REPO_PREFIX);
    throw error;
  }
}

function createUserData(repoPath: string): string {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), USER_DATA_PREFIX));
  try {
    fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({
      theme: 'tokyo-night',
      fontSize: 14,
      sidebarSide: 'left',
      keybindings: {},
      workspaceTabs: [],
      session: {
        tabs: [{
          id: 'terminal-path-drag-tab',
          title: 'path drag fixture',
          type: 'local',
          cwd: repoPath,
          root: {
            type: 'leaf',
            title: 'path drag',
            terminalType: 'local',
            cwd: repoPath,
          },
        }],
        activeTabId: 'terminal-path-drag-tab',
        sidebarOpen: true,
        tabsOpen: true,
        sidebarSection: 'files',
      },
    }, null, 2), 'utf-8');
    return userData;
  } catch (error) {
    removeFixture(userData, USER_DATA_PREFIX);
    throw error;
  }
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
  const tempRoot = path.resolve(os.tmpdir());
  if (path.dirname(resolved) !== tempRoot || !path.basename(resolved).startsWith(prefix)) {
    throw new Error(`Refusing to remove non-fixture path: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

async function beginPathDrag(
  page: Page,
  source: Locator,
  terminal: Locator,
): Promise<JSHandle<DataTransfer>> {
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await source.dispatchEvent('dragstart', { dataTransfer });
  await terminal.dispatchEvent('dragenter', { dataTransfer });
  await terminal.dispatchEvent('dragover', { dataTransfer });
  return dataTransfer;
}

async function completePathDrop(
  source: Locator,
  terminal: Locator,
  dataTransfer: JSHandle<DataTransfer>,
): Promise<void> {
  await terminal.dispatchEvent('drop', { dataTransfer });
  await source.dispatchEvent('dragend', { dataTransfer });
  await dataTransfer.dispose();
}

async function typeIntoTerminal(page: Page, text: string): Promise<void> {
  const textarea = page.locator('.terminal-container .xterm-helper-textarea').first();
  await textarea.focus();
  await page.keyboard.type(text);
}

async function expectTerminalOutputLine(output: Locator, marker: string): Promise<void> {
  await expect.poll(async () => (
    (await output.innerText()).split(/\r?\n/).some((line) => line.trim() === marker)
  ), { timeout: 15_000 }).toBe(true);
}

function posixPathToken(filePath: string): string {
  return `'${filePath.split("'").join("'\\''")}' `;
}

test.skip(process.platform === 'win32', 'The shell proof uses POSIX test and printf commands.');

test('pastes Explorer and Source Control paths into a real terminal', async ({}, testInfo) => {
  test.setTimeout(90_000);
  let app: ElectronApplication | undefined;
  let repoPath: string | undefined;
  let userData: string | undefined;

  try {
    const fixture = createRepositoryFixture();
    repoPath = fixture.repoPath;
    userData = createUserData(repoPath);

    app = await electron.launch({
      args: ['.'],
      cwd: root,
      env: electronEnv({
        NODE_ENV: 'test',
        JANET_E2E_USER_DATA_DIR: userData,
        JANET_E2E_CLOSE_DECISION: 'cancel',
      }),
    });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1200, 760));

    const terminal = page.locator('.terminal-container').first();
    const terminalOutput = page.locator('.xterm-rows').first();
    const dropIndicator = page.locator('.terminal-path-drop-indicator');
    await expect(terminal).toBeVisible();
    await expect.poll(() => terminalOutput.innerText(), { timeout: 15_000 }).not.toBe('');

    const explorerRow = page.locator('.explorer-item-row').filter({ hasText: fixture.fileName });
    const explorerItem = explorerRow.locator('.explorer-item');
    await expect(explorerItem).toBeVisible({ timeout: 15_000 });

    const explorerCopyButton = explorerRow.getByRole('button', {
      name: `Copy path for ${fixture.fileName}`,
    });
    await explorerCopyButton.focus();
    await expect(explorerCopyButton).toBeFocused();
    const copyButtonScreenshot = testInfo.outputPath('explorer-copy-path-focus.png');
    await page.screenshot({ path: copyButtonScreenshot });
    await testInfo.attach('explorer-copy-path-focus', {
      path: copyButtonScreenshot,
      contentType: 'image/png',
    });
    await page.keyboard.press('Enter');

    const expectedClipboardToken = posixPathToken(fixture.filePath);
    await expect.poll(
      () => app!.evaluate(({ clipboard }) => clipboard.readText()),
      { timeout: 5_000 },
    ).toBe(expectedClipboardToken);
    const copiedPathToken = await app.evaluate(({ clipboard }) => clipboard.readText());
    expect(copiedPathToken).toBe(expectedClipboardToken);
    expect(copiedPathToken).not.toMatch(/[\r\n]/);

    await typeIntoTerminal(page, 'test -f ');

    const explorerTransfer = await beginPathDrag(page, explorerItem, terminal);
    await expect(dropIndicator).toHaveText('Drop to paste path');
    await expect(terminal).toHaveClass(/is-path-drop-target/);

    const explorerScreenshot = testInfo.outputPath('explorer-terminal-path-drop.png');
    await page.screenshot({ path: explorerScreenshot });
    await testInfo.attach('explorer-terminal-path-drop', {
      path: explorerScreenshot,
      contentType: 'image/png',
    });

    await completePathDrop(explorerItem, terminal, explorerTransfer);
    await page.keyboard.type("&& printf 'EXPLORER_DROP_OK\\n'");
    await page.keyboard.press('Enter');
    await expectTerminalOutputLine(terminalOutput, 'EXPLORER_DROP_OK');

    await page.getByRole('tab', { name: 'Source Control' }).click();
    const sourceControlItem = page.locator('.git-file-item').filter({ hasText: fixture.fileName });
    await expect(sourceControlItem).toBeVisible({ timeout: 15_000 });
    await typeIntoTerminal(page, 'test -f ');

    const sourceControlTransfer = await beginPathDrag(page, sourceControlItem, terminal);
    await expect(dropIndicator).toHaveText('Drop to paste path');
    await expect(terminal).toHaveClass(/is-path-drop-target/);

    const sourceControlScreenshot = testInfo.outputPath('source-control-terminal-path-drop.png');
    await page.screenshot({ path: sourceControlScreenshot });
    await testInfo.attach('source-control-terminal-path-drop', {
      path: sourceControlScreenshot,
      contentType: 'image/png',
    });

    await completePathDrop(sourceControlItem, terminal, sourceControlTransfer);
    await page.keyboard.type("&& printf 'SOURCE_CONTROL_DROP_OK\\n'");
    await page.keyboard.press('Enter');
    await expectTerminalOutputLine(terminalOutput, 'SOURCE_CONTROL_DROP_OK');

    expect(fs.readFileSync(fixture.filePath, 'utf-8')).toContain('modified');
  } finally {
    await forceClose(app);
    removeFixture(userData, USER_DATA_PREFIX);
    removeFixture(repoPath, REPO_PREFIX);
  }
});
