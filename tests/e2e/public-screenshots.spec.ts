import { test, expect, _electron as electron, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { execFileSync } from 'child_process';
import { createHash, generateKeyPairSync } from 'crypto';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import sharp from 'sharp';
import { Server, utils } from 'ssh2';

const root = path.resolve(__dirname, '../..');
const screenshots = path.join(root, 'assets', 'screenshots');
const fixturePath = path.join(process.env.PUBLIC ?? 'C:\\Users\\Public', 'JaneT-Demo');
const fixtureMarker = `${fixturePath}.janet-public-screenshot-fixture`;
const fixtureOwnership = 'Owned by tests/e2e/public-screenshots.spec.ts\n';
const shellCwd = path.parse(fixturePath).root;
const sshPort = 52_222;
const echoPort = 52_134;
const forwardPort = 52_140;
const screenshotNames = [
  'broadcast-input.png',
  'built-in-editor.png',
  'command-history.png',
  'notification-settings.png',
  'semantic-commands.png',
  'source-control.png',
  'ssh-jump-host.png',
  'ssh-local-forward.png',
  'workspace-overview.png',
] as const;

test.skip(process.platform !== 'win32', 'Public screenshots are the Windows README set.');
test.skip(process.env.JANET_UPDATE_PUBLIC_SCREENSHOTS !== '1', 'Set JANET_UPDATE_PUBLIC_SCREENSHOTS=1 to replace the shipped PNGs.');

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
  try { await app.evaluate(({ app: electronApp }) => electronApp.exit(0)); } catch {}
  await app.waitForEvent('close', { timeout: 5_000 }).catch(() => {});
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
    '  ssh: true,',
    '  splitPanes: 2,',
    "  presets: ['local', 'ssh', 'mixed'],",
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
    '  ssh: true,',
    '  splitPanes: 2,',
    "  presets: ['local', 'ssh', 'mixed'],",
    "  status: 'ready',",
    '};',
    '',
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(fixturePath, 'docs', 'workspaces.md'), '# Saved workspaces\n', 'utf8');
  fs.writeFileSync(path.join(fixturePath, 'CHANGELOG.md'), '# Next\n\n- Refresh public screenshots.\n', 'utf8');
  runGit(['add', '--', 'docs/workspaces.md']);
}

interface SshFixture {
  fingerprint: string;
  close: () => Promise<void>;
}

function benignSocketError(error: unknown): void {
  const code = error instanceof Error && (error as NodeJS.ErrnoException).code;
  if (code === 'EPIPE' || code === 'ECONNABORTED' || code === 'ECONNRESET') return;
  throw error;
}

async function startSshFixture(): Promise<SshFixture> {
  const privateKey = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
  }).privateKey;
  const parsedHostKey = utils.parseKey(privateKey);
  if (parsedHostKey instanceof Error) throw parsedHostKey;
  const fingerprint = `SHA256:${createHash('sha256')
    .update(parsedHostKey.getPublicSSH())
    .digest('base64')
    .replace(/=+$/, '')}`;
  const clients = new Set<{ end: () => void }>();
  const server = new Server({ hostKeys: [privateKey] }, (client) => {
    clients.add(client);
    client.on('close', () => clients.delete(client));
    client.on('error', benignSocketError);
    client.on('authentication', (context) => {
      if (context.method === 'none' && context.username === 'demo') context.accept();
      else context.reject();
    });
    client.on('ready', () => {
      client.on('tcpip', (accept, reject, info) => {
        if (info.destIP !== '127.0.0.1' || info.destPort !== echoPort) {
          reject();
          return;
        }
        const upstream = net.connect(echoPort, '127.0.0.1');
        upstream.once('connect', () => {
          const channel = accept();
          channel.on('error', benignSocketError);
          upstream.on('error', benignSocketError);
          channel.pipe(upstream).pipe(channel);
        });
        upstream.once('error', () => reject());
      });
      client.on('session', (accept) => {
        const session = accept();
        session.on('error', benignSocketError);
        session.on('pty', (acceptPty) => acceptPty?.());
        session.on('shell', (acceptShell) => {
          const stream = acceptShell();
          stream.on('error', benignSocketError);
          stream.write('Welcome to the JaneT loopback fixture\r\n$ ');
          stream.on('data', (chunk: Buffer) => {
            const command = chunk.toString('utf8').trim();
            if (command === 'exit') {
              stream.exit(0);
              stream.end();
            } else if (command) {
              stream.write(`${command}\r\n$ `);
            }
          });
        });
      });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(sshPort, '127.0.0.1', resolve);
  });
  return {
    fingerprint,
    close: async () => {
      for (const client of clients) client.end();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function startEchoFixture(): Promise<net.Server> {
  const server = net.createServer((socket) => socket.pipe(socket));
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(echoPort, '127.0.0.1', resolve);
  });
  return server;
}

function tcpRoundTrip(port: number, payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    const chunks: Buffer[] = [];
    socket.once('error', reject);
    socket.once('connect', () => socket.write(payload));
    socket.on('data', (chunk) => {
      chunks.push(Buffer.from(chunk));
      if (Buffer.concat(chunks).length >= Buffer.byteLength(payload)) socket.end();
    });
    socket.once('close', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
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
  const output = path.join(screenshots, name);
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
  fs.writeFileSync(output, bytes);
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(bytes.length).toBeGreaterThan(4_000);
}

function writeSettings(userData: string, fingerprint: string): void {
  const localProfileId = `demo@127.0.0.1:${sshPort}:password`;
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({
    theme: 'tokyo-night',
    fontSize: 14,
    sidebarSide: 'right',
    keybindings: {},
    notificationsEnabled: true,
    notificationThresholdSeconds: 15,
    sshProfiles: [
      { id: 'ops@bastion.example.com:22:password', host: 'bastion.example.com', port: 22, username: 'ops', auth: 'password' },
      { id: 'demo@app.example.com:22:password', host: 'app.example.com', port: 22, username: 'demo', auth: 'password', jumpHostProfileId: 'ops@bastion.example.com:22:password' },
      { id: localProfileId, host: '127.0.0.1', port: sshPort, username: 'demo', auth: 'password' },
    ],
    sshHostKeys: { [`127.0.0.1:${sshPort}`]: fingerprint },
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
      {
        id: 'local-ssh', name: 'Local + SSH', type: 'local', cwd: fixturePath,
        terminalCount: 2, splitDirection: 'vertical',
        root: {
          type: 'split', direction: 'vertical', sizes: [1, 1],
          children: [
            { type: 'leaf', title: 'Local shell', terminalType: 'local', cwd: fixturePath },
            { type: 'leaf', title: 'Remote shell', terminalType: 'ssh', sshProfileId: 'demo@app.example.com:22:password' },
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
          id: 'command-demo', title: 'Command demo', type: 'local', cwd: shellCwd,
          root: { type: 'leaf', title: 'Commands', terminalType: 'local', cwd: shellCwd },
        },
        {
          id: 'loopback-ssh', title: 'Loopback SSH', type: 'ssh', sshProfileId: localProfileId,
          root: { type: 'leaf', title: 'Loopback', terminalType: 'ssh', sshProfileId: localProfileId },
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
  let echo: net.Server | undefined;
  let ssh: SshFixture | undefined;
  let app: ElectronApplication | undefined;
  const pageErrors: string[] = [];

  try {
    createProjectFixture();
    userData = fs.mkdtempSync(path.join(path.dirname(fixturePath), 'JaneT-Public-Screenshot-Profile-'));
    echo = await startEchoFixture();
    ssh = await startSshFixture();
    writeSettings(userData, ssh.fingerprint);
    app = await electron.launch({
      args: ['.'],
      cwd: root,
      env: electronEnv({ NODE_ENV: 'test', JANET_E2E_USER_DATA_DIR: userData }),
    });
    const page = await app.firstWindow();
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
    const presets = page.getByRole('button', { name: 'Presets' });
    if (await presets.getAttribute('aria-expanded') === 'false') await presets.click();
    await expect(page.getByRole('button', { name: 'Open preset Web project' })).toBeVisible();

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
      await typeCommand(page, terminal, `Set-Location '${shellCwd}'`);
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
    const notificationSettings = page.locator('.notification-settings');
    await expect(notificationSettings.getByRole('checkbox')).toBeChecked();
    await expect(notificationSettings.getByRole('spinbutton')).toHaveValue('15');
    await capture('notification-settings.png', notificationSettings);
    await page.getByRole('button', { name: 'Hide settings' }).click();

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
    await capture('source-control.png', page);

    await page.getByRole('button', { name: 'SSH connections' }).click();
    await page.getByRole('button', { name: 'Edit demo@app.example.com:22' }).click();
    const sshEditor = page.getByRole('dialog', { name: 'Edit SSH connection' });
    await expect(sshEditor.getByRole('textbox', { name: 'Host' })).toHaveValue('app.example.com');
    await expect(sshEditor.getByRole('combobox', { name: 'Jump host' })).toHaveValue('ops@bastion.example.com:22:password');
    await expect(sshEditor.getByRole('textbox', { name: 'Password' })).toHaveValue('');
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await capture('ssh-jump-host.png', sshEditor);
    await sshEditor.getByRole('button', { name: 'Cancel editing' }).click();

    const hideTools = page.getByRole('button', { name: 'Collapse workspace tools' });
    if (await hideTools.isVisible()) await hideTools.click();
    const loopbackTab = tab(page, 'Loopback SSH');
    await loopbackTab.click();
    await expect(loopbackTab.locator('.vtab-sub')).not.toHaveText('Connecting…', { timeout: 20_000 });
    await loopbackTab.click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'Manage local forwards' })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('menuitem', { name: 'Manage local forwards' }).click();
    const forwardDialog = page.getByRole('dialog', { name: 'SSH local forwards' });
    await forwardDialog.getByRole('spinbutton', { name: 'Local port' }).fill(String(forwardPort));
    await forwardDialog.getByRole('textbox', { name: 'Destination host' }).fill('127.0.0.1');
    await forwardDialog.getByRole('spinbutton', { name: 'Destination port' }).fill(String(echoPort));
    await forwardDialog.getByRole('button', { name: 'Create forward' }).click();
    const stopForward = forwardDialog.getByRole('button', { name: `Stop forward 127.0.0.1:${forwardPort}` });
    await expect(stopForward).toBeVisible({ timeout: 20_000 });
    expect(await tcpRoundTrip(forwardPort, 'JaneT public screenshot')).toBe('JaneT public screenshot');
    await capture('ssh-local-forward.png', forwardDialog);

    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toMatch(/pckpr|JaneT-polish|projects\\JaneT/i);
    expect([...pageErrors, ...(await page.pageErrors({ filter: 'all' })).map((error) => error.message)]).toEqual([]);
    for (const name of screenshotNames) {
      const bytes = fs.readFileSync(path.join(screenshots, name));
      expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      expect(bytes.length).toBeGreaterThan(4_000);
    }
  } finally {
    await forceClose(app);
    await ssh?.close().catch(() => {});
    if (echo) await new Promise<void>((resolve) => echo?.close(() => resolve()));
    if (userData && fs.existsSync(userData)) fs.rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    removeOwnedFixture();
  }
});
