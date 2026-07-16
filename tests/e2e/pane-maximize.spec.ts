import { test, expect, chromium, Browser, Page } from '@playwright/test';
import { execFileSync, spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';

const root = path.resolve(__dirname, '../..');
const devServerUrl = process.env.JANET_DEV_SERVER_URL || 'http://127.0.0.1:5173';
const electronExecutable = require('electron') as string;

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
      server.close(() => resolve(address.port));
    });
  });
}

function isAppUrl(url: string): boolean {
  return url.includes('127.0.0.1:5173') || url.includes('localhost:5173') || url.endsWith('index.html');
}

function electronEnv(extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...process.env, ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  return env;
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

async function connectCdp(port: number): Promise<Browser> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  return chromium.connectOverCDP(`http://127.0.0.1:${port}`);
}

async function launchApp(settings: unknown, prefix: string): Promise<{ browser: Browser; electronProcess: ChildProcess; page: Page; userData: string }> {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const settingsPath = path.join(userData, 'settings.json');
  const remoteDebuggingPort = await getFreePort();

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

  // Spawn Electron directly so the tracked child is the app process itself.
  // A shell-wrapped `npx electron` can exit or be killed while leaving its
  // Electron grandchild alive with closed stdout/stderr pipes (EPIPE).
  const electronProcess = spawn(electronExecutable, ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], {
    cwd: root,
    env: electronEnv({
      NODE_ENV: 'test',
      JANET_DEV_SERVER_URL: devServerUrl,
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
    return { browser, electronProcess, page, userData };
  } catch (error) {
    await browser?.close().catch(() => {});
    await killProcessTree(electronProcess);
    fs.rmSync(userData, { recursive: true, force: true });
    throw error;
  }
}

async function launchTwoPaneApp(): Promise<{ browser: Browser; electronProcess: ChildProcess; page: Page; userData: string }> {
  return launchApp({
    theme: 'tokyo-night',
    fontSize: 14,
    sidebarSide: 'left',
    keybindings: {},
    workspaceTabs: [],
    session: {
      tabs: [{
        id: 'two-pane-tab',
        title: 'two panes',
        type: 'local',
        root: {
          type: 'split',
          direction: 'vertical',
          sizes: [1, 1],
          children: [{ type: 'leaf', title: 'left' }, { type: 'leaf', title: 'right' }],
        },
      }],
      activeTabId: 'two-pane-tab',
      sidebarOpen: true,
      tabsOpen: true,
      sidebarSection: 'files',
    },
  }, 'janet-e2e-pane-max-');
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

test('maximizes and restores a terminal pane in Electron', async () => {
  const { browser, electronProcess, page, userData } = await launchTwoPaneApp();
  try {
    await expect(page.locator('.terminal-leaf')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Maximize pane' })).toHaveCount(2);

    await page.getByRole('button', { name: 'Maximize pane' }).nth(1).click();

    await expect(page.locator('.terminal-leaf')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Restore pane layout' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Maximize pane' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Restore pane layout' }).click();

    await expect(page.locator('.terminal-leaf')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Maximize pane' })).toHaveCount(2);

    // Maximizing a pane also makes it the action target. After restoring the
    // layout, pane shortcuts must still act on the pane the user just chose.
    await page.keyboard.press('Control+Shift+W');
    const closePaneDialog = page.getByRole('alertdialog', { name: 'Close right?' });
    await expect(closePaneDialog).toBeVisible();
    await closePaneDialog.getByRole('button', { name: 'Close pane' }).click();
    await expect(page.locator('.terminal-leaf')).toHaveCount(1);
    await expect(page.getByLabel('left — Local terminal pane')).toBeVisible();
  } finally {
    await closeApp(browser, electronProcess, userData);
  }
});

test('runs ordered preset startup commands once per fresh terminal', async () => {
  const markerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'janet-e2e-startup-'));
  const markerPath = path.join(markerDir, 'ordered.txt');
  const failurePath = path.join(markerDir, 'failure.txt');
  const encodedMarkerPath = Buffer.from(markerPath, 'utf-8').toString('base64');
  const appendAfterDelay = `node -e "const fs=require('fs'),p=Buffer.from('${encodedMarkerPath}','base64').toString();setTimeout(()=>fs.appendFileSync(p,'A'),250)"`;
  const appendAfterPrevious = `node -e "const fs=require('fs'),p=Buffer.from('${encodedMarkerPath}','base64').toString(),value=fs.readFileSync(p,'utf8');if(value.slice(-1)==='A')fs.appendFileSync(p,'B');else process.exit(23)"`;
  const failAfterRelativeMarker = `node -e "require('fs').appendFileSync('failure.txt','X');process.exit(23)"`;
  const mustNotRunAfterFailure = `node -e "require('fs').appendFileSync('failure.txt','Y')"`;
  let app: Awaited<ReturnType<typeof launchApp>> | undefined;

  try {
    app = await launchApp({
      theme: 'tokyo-night',
      fontSize: 14,
      sidebarSide: 'left',
      keybindings: {},
      workspaceTabs: [
        {
          id: 'ordered-startup-preset',
          name: 'Ordered startup',
          type: 'local',
          root: {
            type: 'leaf',
            title: 'automation',
            terminalType: 'local',
            cwd: markerDir,
            startupCommands: [appendAfterDelay, appendAfterPrevious],
          },
          terminalCount: 1,
          splitDirection: 'vertical',
        },
        {
          id: 'failure-gate-preset',
          name: 'Failure gate',
          type: 'local',
          root: {
            type: 'leaf',
            title: 'failure gate',
            terminalType: 'local',
            cwd: markerDir,
            startupCommands: [failAfterRelativeMarker, mustNotRunAfterFailure],
          },
          terminalCount: 1,
          splitDirection: 'vertical',
        },
      ],
      session: {
        tabs: [{
          id: 'starter-tab',
          title: 'Starter',
          type: 'local',
          root: { type: 'leaf', title: 'starter', terminalType: 'local', cwd: markerDir },
        }],
        activeTabId: 'starter-tab',
        sidebarOpen: true,
        tabsOpen: true,
        sidebarSection: 'files',
      },
    }, 'janet-e2e-startup-app-');

    const presetsButton = app.page.getByRole('button', { name: 'Presets' });
    if (await presetsButton.getAttribute('aria-expanded') !== 'true') await presetsButton.click();
    await app.page.getByRole('button', { name: 'Open preset Ordered startup' }).click();

    await expect.poll(
      () => fs.existsSync(markerPath) ? fs.readFileSync(markerPath, 'utf-8') : '',
      { timeout: 10_000 },
    ).toBe('AB');

    // Switching tabs remounts the pane UI but reuses the same terminal id. It
    // must not replay commands that may update dependencies or start services.
    await app.page.locator('.vtab-item').filter({ hasText: 'Starter' }).click();
    await app.page.locator('.vtab-item').filter({ hasText: 'Ordered startup' }).click();
    // Observe beyond the former fallback window plus the delayed command so a
    // hidden remount/replay path cannot pass by merely running late.
    await app.page.waitForTimeout(1_750);
    expect(fs.readFileSync(markerPath, 'utf-8')).toBe('AB');

    // Opening the preset explicitly creates a new pane instance, so its startup
    // sequence should run again from the beginning.
    await app.page.getByRole('button', { name: 'Open preset Ordered startup' }).click();
    await expect.poll(
      () => fs.readFileSync(markerPath, 'utf-8'),
      { timeout: 10_000 },
    ).toBe('ABAB');

    // The first row writes a relative marker and exits non-zero. Finding the
    // marker in the saved cwd proves directory selection; never seeing `Y`
    // proves the compound sequence stops before the second row.
    await app.page.getByRole('button', { name: 'Open preset Failure gate' }).click();
    await expect.poll(
      () => fs.existsSync(failurePath) ? fs.readFileSync(failurePath, 'utf-8') : '',
      { timeout: 10_000 },
    ).toBe('X');
    await app.page.waitForTimeout(750);
    expect(fs.readFileSync(failurePath, 'utf-8')).toBe('X');
  } finally {
    if (app) await closeApp(app.browser, app.electronProcess, app.userData);
    fs.rmSync(markerDir, { recursive: true, force: true });
  }
});

test('refreshes external branch and file changes without a manual reload', async () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'janet-e2e-heartbeat-repo-'));
  let app: Awaited<ReturnType<typeof launchApp>> | undefined;
  try {
    execFileSync('git', ['init', '-b', 'main'], { cwd: repoPath });
    execFileSync('git', ['config', 'user.email', 'janet-e2e@example.com'], { cwd: repoPath });
    execFileSync('git', ['config', 'user.name', 'JaneT E2E'], { cwd: repoPath });
    fs.writeFileSync(path.join(repoPath, 'base.txt'), 'base\n', 'utf-8');
    execFileSync('git', ['add', 'base.txt'], { cwd: repoPath });
    execFileSync('git', ['commit', '-m', 'base'], { cwd: repoPath });
    execFileSync('git', ['branch', 'feature/heartbeat'], { cwd: repoPath });

    app = await launchApp({
      theme: 'tokyo-night',
      fontSize: 14,
      sidebarSide: 'left',
      keybindings: {},
      workspaceTabs: [],
      session: {
        tabs: [{
          id: 'heartbeat-tab',
          title: 'heartbeat repo',
          type: 'local',
          cwd: repoPath,
          root: { type: 'leaf', title: 'repo', terminalType: 'local', cwd: repoPath },
        }],
        activeTabId: 'heartbeat-tab',
        sidebarOpen: true,
        tabsOpen: true,
        sidebarSection: 'files',
      },
    }, 'janet-e2e-heartbeat-app-');

    await app.page.bringToFront();
    await expect(app.page.locator('.status-git')).toContainText('main', { timeout: 10_000 });
    await expect(app.page.locator('.explorer-tree')).toContainText('base.txt', { timeout: 10_000 });

    fs.writeFileSync(path.join(repoPath, 'external.txt'), 'created outside JaneT\n', 'utf-8');
    execFileSync('git', ['switch', 'feature/heartbeat'], { cwd: repoPath });

    await expect(app.page.locator('.status-git')).toContainText('feature/heartbeat', { timeout: 8_000 });
    await expect(app.page.locator('.explorer-tree')).toContainText('external.txt', { timeout: 8_000 });

    await app.page.getByRole('tab', { name: 'Source Control' }).click();
    await expect(app.page.locator('.git-repo-path')).toContainText('feature/heartbeat', { timeout: 8_000 });
    await expect(app.page.getByRole('button', { name: 'Current branch feature/heartbeat' })).toBeVisible({ timeout: 8_000 });
  } finally {
    if (app) await closeApp(app.browser, app.electronProcess, app.userData);
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});
