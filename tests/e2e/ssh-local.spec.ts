import { test, expect, chromium, Browser, Page } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';
import { createHash, generateKeyPairSync } from 'crypto';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { Server, utils, type SFTPWrapper } from 'ssh2';

const root = path.resolve(__dirname, '../..');
const devServerUrl = process.env.JANET_DEV_SERVER_URL || 'http://127.0.0.1:5173';
const electronExecutable = require('electron') as string;
const testUsername = 'janet';
const testPassword = 'janet-test';
const remoteHome = '/home/janet';

interface VirtualRemoteEntry {
  name: string;
  type: 'directory' | 'file';
  size?: number;
}

const virtualRemoteTree = new Map<string, VirtualRemoteEntry[]>([
  [remoteHome, [
    { name: 'projects', type: 'directory' },
    { name: 'REMOTE_README.md', type: 'file', size: 42 },
    { name: '.remote-hidden', type: 'file', size: 7 },
  ]],
  [`${remoteHome}/projects`, [
    { name: 'nested-remote.txt', type: 'file', size: 21 },
  ]],
]);

const virtualRemoteTimestamp = Math.floor(Date.UTC(2026, 0, 1) / 1000);

function virtualAttributes(entry: Pick<VirtualRemoteEntry, 'type' | 'size'>) {
  const directory = entry.type === 'directory';
  return {
    mode: (directory ? fs.constants.S_IFDIR | 0o755 : fs.constants.S_IFREG | 0o644),
    uid: 1000,
    gid: 1000,
    size: entry.size ?? 0,
    atime: virtualRemoteTimestamp,
    mtime: virtualRemoteTimestamp,
  };
}

function resolveVirtualRemotePath(requestedPath: string): string | null {
  const resolvedPath = requestedPath === '.'
    ? remoteHome
    : path.posix.resolve(remoteHome, requestedPath);
  return virtualRemoteTree.has(resolvedPath) ? resolvedPath : null;
}

function serveVirtualRemoteTree(sftp: SFTPWrapper) {
  const { STATUS_CODE } = utils.sftp;
  const openDirectories = new Map<string, { path: string; read: boolean }>();
  let nextHandle = 0;

  sftp.on('error', ignoreBenignSshFixtureError);
  sftp.on('REALPATH', (requestId, requestedPath) => {
    const resolvedPath = resolveVirtualRemotePath(requestedPath);
    if (!resolvedPath) {
      sftp.status(requestId, STATUS_CODE.NO_SUCH_FILE);
      return;
    }
    sftp.name(requestId, [{
      filename: resolvedPath,
      longname: resolvedPath,
      attrs: virtualAttributes({ type: 'directory' }),
    }]);
  });
  sftp.on('OPENDIR', (requestId, requestedPath) => {
    const resolvedPath = resolveVirtualRemotePath(requestedPath);
    if (!resolvedPath) {
      sftp.status(requestId, STATUS_CODE.NO_SUCH_FILE);
      return;
    }
    const handle = Buffer.alloc(4);
    handle.writeUInt32BE(++nextHandle);
    openDirectories.set(handle.toString('hex'), { path: resolvedPath, read: false });
    sftp.handle(requestId, handle);
  });
  sftp.on('READDIR', (requestId, handle) => {
    const directory = openDirectories.get(handle.toString('hex'));
    if (!directory) {
      sftp.status(requestId, STATUS_CODE.FAILURE);
      return;
    }
    if (directory.read) {
      sftp.status(requestId, STATUS_CODE.EOF);
      return;
    }
    directory.read = true;
    const entries = virtualRemoteTree.get(directory.path) ?? [];
    sftp.name(requestId, entries.map((entry) => ({
      filename: entry.name,
      longname: `${entry.type === 'directory' ? 'd' : '-'}rw-r--r-- 1 janet janet ${entry.size ?? 0} ${entry.name}`,
      attrs: virtualAttributes(entry),
    })));
  });
  sftp.on('CLOSE', (requestId, handle) => {
    const removed = openDirectories.delete(handle.toString('hex'));
    sftp.status(requestId, removed ? STATUS_CODE.OK : STATUS_CODE.FAILURE);
  });
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Could not allocate local port')));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

function isAppUrl(url: string): boolean {
  return url.includes('127.0.0.1:5173') || url.includes('localhost:5173') || url.endsWith('index.html');
}

function killProcessTree(child: ChildProcess | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }

    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.once('exit', () => resolve());
      killer.once('error', () => {
        try { child.kill('SIGTERM'); } catch {}
        resolve();
      });
      return;
    }

    try { child.kill('SIGTERM'); } catch {}
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        try { child.kill('SIGKILL'); } catch {}
      }
      resolve();
    }, 1000).unref();
  });
}

function electronEnv(extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...process.env, ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  return env;
}

function readEvents(eventsPath: string): Array<Record<string, any>> {
  if (!fs.existsSync(eventsPath)) return [];
  return fs.readFileSync(eventsPath, 'utf-8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function readSettings(settingsPath: string): Record<string, any> {
  return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
}

async function connectCdp(port: number): Promise<Browser> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`Could not connect to Electron CDP on port ${port}`);
}

async function waitForShellCreateCount(eventsPath: string, count: number) {
  await expect.poll(
    () => readEvents(eventsPath).filter((event) => event.type === 'ssh:createShell:start').length,
    { timeout: 20_000 },
  ).toBeGreaterThanOrEqual(count);
}

function ignoreBenignSshFixtureError(error: unknown) {
  if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'EPIPE') return;
  throw error;
}

function respondToShellCommand(stream: NodeJS.WritableStream & { exit?: (code: number) => void }, command: string) {
  const normalized = command.replace(/\r/g, '\n');
  const markerMatches: RegExpExecArray[] = [];
  const markerPattern = /__JANET_([A-Z_]+?)_(START|DONE)__/g;
  let markerMatch: RegExpExecArray | null;
  while ((markerMatch = markerPattern.exec(normalized)) !== null) {
    markerMatches.push(markerMatch);
  }
  if (markerMatches.length > 0) {
    for (const match of markerMatches) {
      stream.write(`${match[0]}\r\n`);
      if (match[2] === 'START') {
        stream.write('README.md\r\nsrc\r\npackage.json\r\n');
      }
    }
  } else if (/\bls\b/.test(normalized)) {
    stream.write('README.md\r\nsrc\r\npackage.json\r\n');
  } else {
    stream.write(normalized);
  }
  stream.write('$ ');
}

async function startLocalSshServer(): Promise<{
  port: number;
  fingerprint: string;
  receivedCommands: string[];
  disconnectClients: () => void;
  close: () => Promise<void>;
}> {
  const port = await getFreePort();
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });
  const parsedHostKey = utils.parseKey(privateKey);
  if (parsedHostKey instanceof Error) throw parsedHostKey;
  const fingerprint = `SHA256:${createHash('sha256')
    .update(parsedHostKey.getPublicSSH())
    .digest('base64')
    .replace(/=+$/, '')}`;

  const clients = new Set<{ end: () => void }>();
  const receivedCommands: string[] = [];
  const server = new Server({ hostKeys: [privateKey] }, (client) => {
    clients.add(client);
    client.on('close', () => clients.delete(client));
    client.on('error', ignoreBenignSshFixtureError);
    client.on('authentication', (ctx) => {
      if (ctx.method === 'password' && ctx.username === testUsername && ctx.password === testPassword) {
        ctx.accept();
      } else {
        ctx.reject();
      }
    });

    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept();
        session.on('error', ignoreBenignSshFixtureError);
        session.on('pty', (acceptPty) => acceptPty?.());
        session.on('sftp', (acceptSftp) => {
          serveVirtualRemoteTree(acceptSftp());
        });
        session.on('shell', (acceptShell) => {
          const stream = acceptShell();
          stream.on('error', ignoreBenignSshFixtureError);
          stream.write('Welcome to JaneT local SSH fixture\r\n$ ');
          let buffer = '';
          stream.on('data', (chunk: Buffer) => {
            buffer += chunk.toString('utf-8');
            if (!/[\r\n]$/.test(buffer)) return;
            const command = buffer.trim();
            buffer = '';
            receivedCommands.push(command);
            if (command === 'exit') {
              stream.exit(0);
              stream.end();
              return;
            }
            respondToShellCommand(stream, command);
          });
        });
      });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });

  return {
    port,
    fingerprint,
    receivedCommands,
    disconnectClients: () => {
      for (const client of clients) client.end();
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function launchAppWithLocalSsh(
  port: number,
  fingerprint: string,
  options: { seedSession?: boolean; seedStartupPreset?: boolean } = {},
): Promise<{
  browser: Browser;
  electronProcess: ChildProcess;
  page: Page;
  eventsPath: string;
  settingsPath: string;
  userData: string;
}> {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'janet-e2e-local-ssh-'));
  const eventsPath = path.join(userData, 'events.ndjson');
  const settingsPath = path.join(userData, 'settings.json');
  const remoteDebuggingPort = await getFreePort();
  const seedSession = options.seedSession !== false;
  const profile = {
    id: `janet@127.0.0.1:${port}:password`,
    host: '127.0.0.1',
    port,
    username: testUsername,
    auth: 'password' as const,
    password: testPassword,
  };

  fs.writeFileSync(settingsPath, JSON.stringify({
    theme: 'tokyo-night',
    fontSize: 14,
    sidebarSide: 'left',
    keybindings: {},
    workspaceTabs: options.seedStartupPreset ? [{
      id: 'remote-startup-preset',
      name: 'Remote startup',
      type: 'local',
      terminalCount: 1,
      splitDirection: 'vertical',
      root: {
        type: 'leaf',
        title: 'remote automation',
        terminalType: 'ssh',
        sshProfileId: profile.id,
        startupCommands: ['printf __JANET_REMOTE_ONE__', 'printf __JANET_REMOTE_TWO__'],
        startupShellDialect: 'posix',
      },
    }] : [],
    sshProfiles: [profile],
    sshHostKeys: { [`127.0.0.1:${port}`]: fingerprint },
    session: seedSession ? {
      tabs: [{
        id: 'local-ssh-tab',
        title: 'local ssh',
        type: 'ssh',
        sshProfileId: profile.id,
        root: { type: 'leaf', title: 'ssh' },
      }],
      activeTabId: 'local-ssh-tab',
      sidebarOpen: true,
      tabsOpen: true,
      sidebarSection: 'files',
    } : undefined,
  }, null, 2), 'utf-8');

  const electronProcess = spawn(electronExecutable, ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], {
    cwd: root,
    env: electronEnv({
      NODE_ENV: 'test',
      JANET_DEV_SERVER_URL: devServerUrl,
      JANET_E2E_EVENTS_PATH: eventsPath,
      JANET_E2E_USER_DATA_DIR: userData,
      JANET_E2E_REMOTE_DEBUGGING_PORT: String(remoteDebuggingPort),
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  electronProcess.stdout?.on('data', (chunk) => console.log(`[electron] ${chunk}`));
  electronProcess.stderr?.on('data', (chunk) => console.error(`[electron] ${chunk}`));

  let browser: Browser | undefined;
  try {
    browser = await connectCdp(remoteDebuggingPort);
    const context = browser.contexts()[0] ?? await browser.newContext();
    let page = context.pages().find((candidate) => isAppUrl(candidate.url()));
    if (!page) page = await context.waitForEvent('page', { timeout: 10_000 });
    if (!isAppUrl(page.url())) {
      await page.waitForURL((url) => isAppUrl(url.href), { timeout: 10_000 }).catch(() => {});
    }
    page.on('console', (message) => console.log(`[renderer:${message.type()}] ${message.text()}`));
    await page.waitForLoadState('domcontentloaded');
    return { browser, electronProcess, page, eventsPath, settingsPath, userData };
  } catch (error) {
    await browser?.close().catch(() => {});
    await killProcessTree(electronProcess);
    fs.rmSync(userData, { recursive: true, force: true });
    throw error;
  }
}

async function closeApp(browser: Browser, electronProcess: ChildProcess, userData?: string) {
  try {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        await page.evaluate(() => window.close()).catch(() => {});
      }
    }
    await browser.close().catch(() => {});
  } finally {
    await killProcessTree(electronProcess);
    if (userData) fs.rmSync(userData, { recursive: true, force: true });
  }
}

async function runMarkedLs(page: Page, marker: string) {
  const terminal = page.locator('.terminal-container').first();
  await expect(terminal).toBeVisible();
  await terminal.click();
  await page.keyboard.press('Control+L');
  await page.keyboard.type(`printf "__JANET_${marker}_START__\\n"; ls; printf "__JANET_${marker}_DONE__\\n"`);
  await page.keyboard.press('Enter');

  await expect.poll(async () => page.locator('.xterm-rows').innerText(), { timeout: 20_000 }).toContain(`__JANET_${marker}_START__`);
  await expect.poll(async () => page.locator('.xterm-rows').innerText(), { timeout: 20_000 }).toContain('package.json');
  await expect.poll(async () => page.locator('.xterm-rows').innerText(), { timeout: 20_000 }).toContain(`__JANET_${marker}_DONE__`);
}

test('restores the local SSH fixture, browses remote files, and runs ls', async () => {
  const ssh = await startLocalSshServer();
  const { browser, electronProcess, page, eventsPath, userData } = await launchAppWithLocalSsh(ssh.port, ssh.fingerprint);
  try {
    await waitForShellCreateCount(eventsPath, 1);

    const explorer = page.locator('.file-explorer');
    await expect(explorer.getByText('REMOTE_README.md', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(explorer.getByRole('button', { name: 'Open folder projects' })).toBeVisible();
    await expect(page.getByText(/remote browsing is not available yet/i)).toHaveCount(0);

    await explorer.getByRole('button', { name: 'Open folder projects' }).click();
    await expect(explorer.getByText('nested-remote.txt', { exact: true })).toBeVisible();

    await runMarkedLs(page, 'LS');

    ssh.disconnectClients();
    await expect(explorer.getByText(/Reconnect .* to browse its files\./i)).toBeVisible({ timeout: 20_000 });
    await expect(explorer.getByText('nested-remote.txt', { exact: true })).toHaveCount(0);
  } finally {
    await closeApp(browser, electronProcess, userData);
    await ssh.close();
  }
});

test('restores local SSH terminal after refresh and runs ls again', async () => {
  const ssh = await startLocalSshServer();
  const { browser, electronProcess, page, eventsPath, userData } = await launchAppWithLocalSsh(ssh.port, ssh.fingerprint);
  try {
    await waitForShellCreateCount(eventsPath, 1);
    await runMarkedLs(page, 'BEFORE_REFRESH');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('.terminal-container').first()).toBeVisible();
    await waitForShellCreateCount(eventsPath, 2);
    await runMarkedLs(page, 'AFTER_REFRESH');
  } finally {
    await closeApp(browser, electronProcess, userData);
    await ssh.close();
  }
});

test('reruns startup commands when restoring a saved SSH preset terminal', async () => {
  const ssh = await startLocalSshServer();
  const { browser, electronProcess, page, eventsPath, settingsPath, userData } = await launchAppWithLocalSsh(
    ssh.port,
    ssh.fingerprint,
    { seedSession: false, seedStartupPreset: true },
  );
  try {
    const presetsButton = page.getByRole('button', { name: 'Presets' });
    if (await presetsButton.getAttribute('aria-expanded') !== 'true') await presetsButton.click();
    await page.getByRole('button', { name: 'Open preset Remote startup' }).click();

    const expectedExpression = "eval 'printf __JANET_REMOTE_ONE__' && eval 'printf __JANET_REMOTE_TWO__'";
    await expect.poll(() => ssh.receivedCommands, { timeout: 20_000 }).toEqual([expectedExpression]);

    // A durable renderer reload reconnects the saved SSH pane with a fresh
    // transport, so its startup automation must be persisted and rerun.
    await expect.poll(() => {
      const session = readSettings(settingsPath).session;
      const savedTab = session?.tabs?.find((tab: Record<string, any>) => tab.title === 'Remote startup');
      if (!savedTab) return null;
      return {
        terminalType: savedTab.root?.terminalType,
        startupCommands: savedTab.root?.startupCommands,
        startupShellDialect: savedTab.root?.startupShellDialect,
      };
    }, { timeout: 10_000 }).toEqual({
      terminalType: 'ssh',
      startupCommands: ['printf __JANET_REMOTE_ONE__', 'printf __JANET_REMOTE_TWO__'],
      startupShellDialect: 'posix',
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForShellCreateCount(eventsPath, 2);
    await expect.poll(() => ssh.receivedCommands, { timeout: 20_000 })
      .toEqual([expectedExpression, expectedExpression]);

    // An explicit second preset launch creates a new pane and runs it again.
    const reloadedPresetsButton = page.getByRole('button', { name: 'Presets' });
    if (await reloadedPresetsButton.getAttribute('aria-expanded') !== 'true') {
      await reloadedPresetsButton.click();
    }
    await page.getByRole('button', { name: 'Open preset Remote startup' }).click();
    await expect.poll(() => ssh.receivedCommands, { timeout: 20_000 })
      .toEqual([expectedExpression, expectedExpression, expectedExpression]);
  } finally {
    await closeApp(browser, electronProcess, userData);
    await ssh.close();
  }
});

test('opens saved local SSH profile, persists profile id, refreshes, and runs ls again', async () => {
  const ssh = await startLocalSshServer();
  const { browser, electronProcess, page, eventsPath, settingsPath, userData } = await launchAppWithLocalSsh(
    ssh.port,
    ssh.fingerprint,
    { seedSession: false },
  );
  try {
    await page.getByRole('button', { name: 'SSH' }).click();
    await page.getByRole('button', { name: new RegExp(`connect to janet@127\\.0\\.0\\.1:${ssh.port}`, 'i') }).click();

    await waitForShellCreateCount(eventsPath, 1);
    await runMarkedLs(page, 'OPENED_PROFILE');

    await expect.poll(() => {
      const session = readSettings(settingsPath).session;
      return session?.tabs?.find((tab: any) => tab.type === 'ssh')?.sshProfileId;
    }, { timeout: 5_000 }).toBe(`janet@127.0.0.1:${ssh.port}:password`);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('.terminal-container').first()).toBeVisible();
    await waitForShellCreateCount(eventsPath, 2);
    await runMarkedLs(page, 'OPENED_PROFILE_AFTER_REFRESH');
  } finally {
    await closeApp(browser, electronProcess, userData);
    await ssh.close();
  }
});
