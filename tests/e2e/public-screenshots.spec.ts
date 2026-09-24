import { forceClose } from './electronLifecycle';
import { test, expect, _electron as electron, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';

const root = path.resolve(__dirname, '../..');
const screenshots = path.join(root, 'assets', 'screenshots');
const docsScreenshots = path.join(root, 'docs', 'site', 'public', 'screenshots');
const fixturePath = path.join(process.env.PUBLIC ?? 'C:\\Users\\Public', 'JaneT-Demo');
const fixtureMarker = `${fixturePath}.janet-public-screenshot-fixture`;
const fixtureOwnership = 'Owned by tests/e2e/public-screenshots.spec.ts\n';
const screenshotNames = [
  'broadcast-input.png',
  'built-in-editor.png',
  'command-history.png',
  'command-palette.png',
  'existing-workspace-projects.png',
  'notification-settings.png',
  'optional-workspace-setup.png',
  'project-creation.png',
  'settings-overview.png',
  'semantic-commands.png',
  'snippets.png',
  'source-control.png',
  'workspace-creation.png',
  'workspace-overview.png',
  'workspace-setup-sidebar.png',
] as const;

test.skip(process.platform !== 'win32', 'Public screenshots are captured from the Windows desktop app.');
test.skip(process.env.JANET_UPDATE_PUBLIC_SCREENSHOTS !== '1', 'Set JANET_UPDATE_PUBLIC_SCREENSHOTS=1 to replace the shipped PNGs.');

function electronEnv(extra: NodeJS.ProcessEnv): Record<string, string> {
  const env = { ...process.env, ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function runGit(args: string[]): void {
  execFileSync('git', args, { cwd: fixturePath, stdio: 'ignore' });
}

function removeOwnedFixture(): void {
  if (!fs.existsSync(fixturePath)) {
    if (fs.existsSync(fixtureMarker) && fs.readFileSync(fixtureMarker, 'utf8') === fixtureOwnership) {
      fs.rmSync(fixtureMarker, { force: true });
    }
    return;
  }
  if (!fs.existsSync(fixtureMarker) || fs.readFileSync(fixtureMarker, 'utf8') !== fixtureOwnership) {
    throw new Error(`Refusing to remove unowned fixture path: ${fixturePath}`);
  }
  fs.rmSync(fixturePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  fs.rmSync(fixtureMarker, { force: true });
}

function createProjectFixture(): void {
  removeOwnedFixture();
  if (fs.existsSync(fixtureMarker)) throw new Error(`Refusing to overwrite unowned fixture marker: ${fixtureMarker}`);
  fs.writeFileSync(fixtureMarker, fixtureOwnership, 'utf8');
  fs.mkdirSync(path.join(fixturePath, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(fixturePath, 'src'), { recursive: true });
  fs.writeFileSync(path.join(fixturePath, 'README.md'), '# JaneT demo workspace\n', 'utf8');
  fs.writeFileSync(path.join(fixturePath, 'package.json'), '{\n  "name": "janet-demo",\n  "private": true\n}\n', 'utf8');
  fs.writeFileSync(path.join(fixturePath, 'src', 'app.ts'), [
    'export const workspace = {',
    '  localShells: true,',
    '  splitPanes: 2,',
    "  status: 'draft',",
    '};',
    '',
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(fixturePath, 'src', 'theme.css'), ':root { color-scheme: dark; }\n', 'utf8');
  runGit(['init', '-b', 'feature/workspace-presets']);
  runGit(['config', 'user.email', 'janet-demo@example.com']);
  runGit(['config', 'user.name', 'JaneT Demo']);
  runGit(['add', '--', 'README.md', 'package.json', 'src/app.ts', 'src/theme.css']);
  runGit(['commit', '-m', 'Create neutral demo workspace']);

  fs.writeFileSync(path.join(fixturePath, 'src', 'app.ts'), [
    'export const workspace = {',
    '  localShells: true,',
    '  splitPanes: 2,',
    "  status: 'ready',",
    '};',
    '',
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(fixturePath, 'docs', 'workspaces.md'), '# Saved workspaces\n', 'utf8');
  fs.writeFileSync(path.join(fixturePath, 'CHANGELOG.md'), '# Next\n\n- Refresh public screenshots.\n', 'utf8');
  runGit(['add', '--', 'docs/workspaces.md']);
}

function tab(page: Page, title: string): Locator {
  return page.locator('.vtab-item').filter({ has: page.locator('.vtab-name', { hasText: title }) });
}

async function typeCommand(page: Page, terminal: Locator, command: string): Promise<void> {
  const textarea = terminal.locator('.xterm-helper-textarea');
  await expect(textarea).toHaveCount(1);
  await expect(textarea).toHaveAttribute('data-shell-ready', 'true', { timeout: 20_000 });
  const promptCount = async () => (await terminal.locator('.xterm-rows > div').allTextContents())
    .reduce((count, row) => count + (row.match(/PS [^>]*>/g)?.length ?? 0), 0);
  const previousPrompts = await promptCount();
  await textarea.focus();
  await page.keyboard.type(command, { delay: 5 });
  await page.keyboard.press('Enter');
  await expect.poll(promptCount, { timeout: 20_000 }).toBeGreaterThan(previousPrompts);
}

async function warmTerminal(page: Page, terminal: Locator): Promise<void> {
  const textarea = terminal.locator('.xterm-helper-textarea');
  await expect(textarea).toHaveAttribute('data-shell-ready', 'true', { timeout: 20_000 });
  const promptCount = async () => (await terminal.locator('.xterm-rows > div').allTextContents())
    .reduce((count, row) => count + (row.match(/PS [^>]*>/g)?.length ?? 0), 0);
  const previousPrompts = await promptCount();
  await textarea.focus();
  await page.keyboard.press('Enter');
  await expect.poll(promptCount, { timeout: 20_000 }).toBeGreaterThan(previousPrompts);
  await page.keyboard.press('Control+L');
}

async function capture(name: typeof screenshotNames[number], target: Page | Locator): Promise<void> {
  const options = {
    animations: 'disabled',
    caret: 'hide',
  } as const;
  let previous: Buffer | undefined;
  let bytes: Buffer | undefined;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await sharp(await target.screenshot(options)).png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer();
    if (previous?.equals(current)) {
      bytes = current;
      break;
    }
    previous = current;
  }
  if (!bytes) throw new Error(`${name} did not produce two consecutive byte-identical frames`);
  fs.mkdirSync(docsScreenshots, { recursive: true });
  for (const directory of [screenshots, docsScreenshots]) {
    fs.writeFileSync(path.join(directory, name), bytes);
  }
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(bytes.length).toBeGreaterThan(4_000);
}

function writeSettings(userData: string): void {
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ mainDirectory: userData,
    theme: 'one-dark',
    fontSize: 14,
    sidebarSide: 'right',
    keybindings: {},
    snippets: [{ id: 'demo-checks', name: 'Check demo workspace', content: 'git status -sb' }],
    notificationsEnabled: true,
    notificationThresholdSeconds: 10,
    workspaceTabs: [
      {
        id: 'web-project', name: 'Web project', type: 'local', cwd: fixturePath,
        terminalCount: 2, splitDirection: 'vertical',
        root: {
          type: 'split', direction: 'vertical', sizes: [1, 1],
          children: [
            { type: 'leaf', title: 'App shell', terminalType: 'local', cwd: fixturePath },
            { type: 'leaf', title: 'Test runner', terminalType: 'local', cwd: fixturePath },
          ],
        },
      },
    ],
    session: {
      tabs: [
        {
          id: 'demo-workspace', title: 'Demo workspace', type: 'local', cwd: fixturePath,
          root: {
            type: 'split', direction: 'vertical', sizes: [1, 1],
            children: [
              { type: 'leaf', title: 'Workspace', terminalType: 'local', cwd: fixturePath },
              { type: 'leaf', title: 'Checks', terminalType: 'local', cwd: fixturePath },
            ],
          },
          selectedPanePath: [0],
        },
        {
          id: 'command-demo', title: 'Command demo', type: 'local', cwd: fixturePath,
          root: { type: 'leaf', title: 'Commands', terminalType: 'local', cwd: fixturePath },
        },
      ],
      activeTabId: 'demo-workspace',
      sidebarOpen: true,
      tabsOpen: true,
      sidebarSection: 'files',
    },
  }, null, 2), 'utf8');
}

test('recaptures the shipped public screenshot set from the real app', async () => {
  test.setTimeout(180_000);
  let userData: string | undefined;
  let app: ElectronApplication | undefined;
  const pageErrors: string[] = [];

  try {
    createProjectFixture();
    userData = fs.mkdtempSync(path.join(path.dirname(fixturePath), 'JaneT-Public-Screenshot-Profile-'));
    app = await electron.launch({
      args: ['.'],
      cwd: root,
      env: electronEnv({ NODE_ENV: 'test', JANET_E2E_USER_DATA_DIR: userData }),
    });
    let page = await app.firstWindow();
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim()))
      .toBe('#0b0b0c');
    const onboarding = page.locator('.directory-onboarding');
    await expect(onboarding).toBeVisible();
    await capture('optional-workspace-setup.png', onboarding);
    await page.getByRole('button', { name: 'Skip for now' }).click();
    await expect(page.getByRole('region', { name: 'Choose where to work' })).toBeVisible();
    await capture('workspace-setup-sidebar.png', page.locator('.workspace-tabs-rail'));
    const existingWorkspace = path.join(userData, 'Existing workspace');
    fs.mkdirSync(path.join(existingWorkspace, 'Alpha', 'Nested'), { recursive: true });
    fs.mkdirSync(path.join(existingWorkspace, 'Beta'), { recursive: true });
    fs.writeFileSync(path.join(existingWorkspace, 'notes.txt'), 'Synthetic example\n');
    await app.evaluate(({ dialog }, selected) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] });
    }, existingWorkspace);
    await page.getByRole('button', { name: 'Choose existing workspace' }).last().click();
    await expect(page.getByRole('region', { name: 'Existing workspace' }).locator('.project-entry')).toHaveCount(2);
    await capture('existing-workspace-projects.png', page.locator('.workspace-tabs-rail'));
    await forceClose(app);
    app = undefined;

    writeSettings(userData);
    app = await electron.launch({
      args: ['.'],
      cwd: root,
      env: electronEnv({ NODE_ENV: 'test', JANET_E2E_USER_DATA_DIR: userData }),
    });
    page = await app.firstWindow();
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim()))
      .toBe('#0b0b0c');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
    await expect.poll(() => page.evaluate(() => window.janet.isWindowFocused())).toBe(true);
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.waitForLoadState('domcontentloaded');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 800));
    await expect.poll(() => page.evaluate(() => ({ width: innerWidth, height: innerHeight })))
      .toEqual({ width: 1440, height: 800 });
    await expect.poll(() => page.evaluate(() => ['Inter Variable', 'JetBrains Mono Variable'].map((family) => (
      Array.from(document.fonts).some((face) => face.family === family && face.status === 'loaded')
    ))), { timeout: 20_000 }).toEqual([true, true]);
    await page.addStyleTag({ content: '.xterm-cursor, .status-version { visibility: hidden !important; }' });
    await expect(page.locator('.status-version')).toHaveCSS('visibility', 'hidden');
    await expect(page.getByRole('button', { name: 'Open command palette (Ctrl+Shift+P)' })).toBeVisible();
    await expect(page.getByText('Ctrl+K', { exact: true })).toHaveCount(0);
    await expect(tab(page, 'Demo workspace')).toHaveClass(/active/);
    await expect(page.locator('.terminal-container')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Open folder src' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: /^My workspaces/, expanded: true })).toBeVisible();

    const terminals = page.locator('.terminal-container');
    const workspaceCommand = 'git status -sb';
    const checksCommand = 'Get-ChildItem -Name';
    const completeCommand = "Write-Output 'Command complete'";
    const listCommand = `Get-ChildItem -Name '${fixturePath}'`;
    const failedCommand = 'test';
    await warmTerminal(page, terminals.nth(0));
    await warmTerminal(page, terminals.nth(1));
    await typeCommand(page, terminals.nth(0), workspaceCommand);
    await typeCommand(page, terminals.nth(1), checksCommand);
    await expect(terminals.nth(0).locator('.xterm-rows')).toContainText('feature/workspace-presets');
    await expect(terminals.nth(1).locator('.xterm-rows')).toContainText('README.md');
    await capture('workspace-overview.png', page);

    await tab(page, 'Command demo').click();
    const commandTerminal = page.locator('.terminal-container');
    await expect(commandTerminal).toHaveCount(1);
    await commandTerminal.locator('.xterm-helper-textarea').focus();
    await page.keyboard.press('Control+L');
    await typeCommand(page, commandTerminal, completeCommand);
    await typeCommand(page, commandTerminal, listCommand);
    await typeCommand(page, commandTerminal, failedCommand);
    await expect(commandTerminal.locator('.terminal-command-failed')).toBeVisible({ timeout: 20_000 });
    await expect(commandTerminal.locator('.xterm-rows')).toContainText('Command complete');
    await capture('semantic-commands.png', page);

    await page.getByRole('button', { name: 'Open command palette (Ctrl+Shift+P)' }).click();
    await page.getByRole('option', { name: /Open command history/ }).click();
    const history = page.getByRole('dialog', { name: 'Command history' });
    await expect(history).toBeVisible();
    await history.getByRole('combobox', { name: 'Search command history' }).fill(failedCommand);
    expect(await history.locator('.command-history-item > span').allTextContents()).toEqual([failedCommand]);
    await expect(history.getByRole('button', { name: `Remove ${failedCommand} from command history`, exact: true })).toHaveCount(1);
    await expect(history).not.toContainText('CONTEXT');
    await expect(history).not.toContainText('OUTCOME');
    await history.getByRole('combobox', { name: 'Search command history' }).fill('');
    for (const command of [workspaceCommand, checksCommand]) {
      const remove = history.getByRole('button', { name: `Remove ${command} from command history`, exact: true });
      if (await remove.count()) {
        await remove.click();
        await expect(remove).toHaveCount(0);
      }
    }
    for (const command of [failedCommand, listCommand, completeCommand]) {
      await expect(history.getByRole('option').getByText(command, { exact: true })).toHaveCount(1);
      await expect(history.getByRole('button', { name: `Remove ${command} from command history`, exact: true })).toHaveCount(1);
    }
    await expect(history.getByRole('option')).toHaveCount(3);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await capture('command-history.png', history);
    await history.getByRole('button', { name: 'Close command history' }).click();

    await tab(page, 'Demo workspace').click();
    await expect(terminals).toHaveCount(2);
    for (const terminal of await terminals.all()) {
      await typeCommand(page, terminal, `Set-Location '${fixturePath}'`);
      await terminal.locator('.xterm-helper-textarea').focus();
      await page.keyboard.press('Control+L');
    }
    const recipients = page.locator('.broadcast-recipient');
    await recipients.nth(0).check();
    await recipients.nth(1).check();
    await page.getByRole('alertdialog', { name: 'Start broadcast input?' })
      .getByRole('button', { name: 'Start broadcast input' }).click();
    await typeCommand(page, terminals.nth(0), "Write-Output 'synced'");
    for (const terminal of await terminals.all()) {
      await expect.poll(async () => (await terminal.locator('.xterm-rows > div').allTextContents())
        .join('').includes("Write-Output 'synced'")).toBe(true);
      await expect.poll(async () => (await terminal.locator('.xterm-rows > div').allTextContents())
        .some((row) => row.trim() === 'synced')).toBe(true);
    }
    await expect(page.locator('.terminal-leaf.broadcast-selected')).toHaveCount(2);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await capture('broadcast-input.png', page);
    await page.keyboard.press('Escape');

    for (const terminal of await terminals.all()) {
      await typeCommand(page, terminal, `Set-Location '${fixturePath}'`);
      await terminal.locator('.xterm-helper-textarea').focus();
      await page.keyboard.press('Control+L');
    }

    await page.getByRole('button', { name: 'Open settings' }).click();
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await expect(settings).toBeVisible();
    await capture('settings-overview.png', settings);
    const notificationSettings = page.locator('.notification-settings');
    await expect(notificationSettings.getByRole('checkbox')).toBeChecked();
    await expect(notificationSettings).toContainText('Codex alerts are immediate; other commands must run at least 10 seconds.');
    await capture('notification-settings.png', notificationSettings);
    await page.getByRole('button', { name: 'Hide settings' }).click();

    await page.getByRole('button', { name: 'New workspace' }).click();
    const workspaceCreation = page.getByRole('dialog', { name: 'Create workspace' });
    await expect(workspaceCreation).toBeVisible();
    await capture('workspace-creation.png', workspaceCreation);
    await workspaceCreation.getByRole('button', { name: 'Close creation dialog' }).click();

    await page.locator('.workspace-group-heading').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Add project' }).click();
    const projectCreation = page.locator('.project-creation-content');
    await expect(projectCreation).toBeVisible();
    await expect(projectCreation.getByLabel('Project name')).toBeVisible();
    await projectCreation.getByRole('button', { name: /Add terminals/ }).click();
    await expect(projectCreation.getByRole('spinbutton', { name: 'Initial terminals' })).toHaveValue('1');
    await expect(projectCreation.getByText('Start terminals with')).toBeVisible();
    await capture('project-creation.png', projectCreation);
    await page.getByRole('button', { name: 'Cancel' }).click();

    await page.getByRole('button', { name: 'Open command palette (Ctrl+Shift+P)' }).click();
    const commandPalette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(commandPalette).toBeVisible();
    await capture('command-palette.png', commandPalette);
    await commandPalette.getByRole('option', { name: /Open snippets/ }).click();
    const snippets = page.getByRole('dialog', { name: 'Snippets' });
    await expect(snippets.getByText('Check demo workspace', { exact: true })).toBeVisible();
    await capture('snippets.png', snippets);
    await page.keyboard.press('Escape');

    await page.getByRole('tab', { name: 'Explorer' }).click();
    await page.getByRole('button', { name: 'Open folder src' }).click();
    await page.getByRole('button', { name: 'Open file app.ts' }).click();
    await expect(page.getByRole('tab', { name: 'app.ts', exact: true })).toBeVisible();
    await expect(page.locator('.monaco-editor-host')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.monaco-editor-host')).toContainText("status: 'ready'");
    await capture('built-in-editor.png', page);

    await page.getByRole('tab', { name: 'Terminal', exact: true }).click();
    await page.getByRole('tab', { name: 'Source Control' }).click();
    const sourceControl = page.locator('.git-tree');
    await expect(sourceControl.getByText('Staged Changes')).toBeVisible({ timeout: 20_000 });
    await expect(sourceControl.locator('.git-worktree-item.current[aria-current="location"]')).toBeVisible();
    await expect(sourceControl.getByRole('button', { name: 'Current branch feature/workspace-presets' })).toBeVisible();
    await expect(sourceControl.getByText('workspaces.md', { exact: true })).toBeVisible();
    await expect(sourceControl.getByText('app.ts', { exact: true })).toBeVisible();
    await expect(sourceControl.getByText('CHANGELOG.md', { exact: true })).toBeVisible();
    for (const terminal of await terminals.all()) {
      await warmTerminal(page, terminal);
      await expect.poll(async () => (await terminal.locator('.xterm-rows > div').allTextContents()).join(''))
        .toContain(`PS ${fixturePath}>`);
    }
    await capture('source-control.png', page);

    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toMatch(/pckpr|JaneT-polish|projects\\JaneT/i);
    expect(bodyText).not.toMatch(/\$Recycle\.Bin|System Volume Information|Windows\.old|Program Files/i);
    expect([...pageErrors, ...(await page.pageErrors({ filter: 'all' })).map((error) => error.message)]).toEqual([]);
    for (const name of screenshotNames) {
      const bytes = fs.readFileSync(path.join(screenshots, name));
      expect(fs.readFileSync(path.join(docsScreenshots, name))).toEqual(bytes);
      expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      expect(bytes.length).toBeGreaterThan(4_000);
    }
  } finally {
    await forceClose(app);
    if (userData && fs.existsSync(userData)) fs.rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    removeOwnedFixture();
  }
});
