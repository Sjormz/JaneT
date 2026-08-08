import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import packageMetadata from '../../package.json';

const root = path.resolve(__dirname, '../..');

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
  await app.close().catch(() => {});
}

test('shows the current JaneT version and checks for updates when clicked', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'janet-version-e2e-'));
  let app: ElectronApplication | undefined;

  try {
    app = await electron.launch({
      args: ['.'],
      cwd: root,
      env: electronEnv({
        NODE_ENV: 'test',
        JANET_E2E_USER_DATA_DIR: userData,
      }),
    });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.terminal-container').first()).toBeVisible();

    await app.evaluate(({ ipcMain }) => {
      const state = globalThis as typeof globalThis & { janetUpdateChecks?: number };
      state.janetUpdateChecks = 0;
      ipcMain.handle('update:check', () => {
        state.janetUpdateChecks = (state.janetUpdateChecks ?? 0) + 1;
        return { success: true };
      });
    });

    const version = page.getByRole('button', {
      name: `JaneT version ${packageMetadata.version}. Check for updates`,
    });
    await expect(version).toHaveText(`v${packageMetadata.version}`);

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(800, 600));
    await expect(version).toBeVisible();
    const statusBounds = await page.locator('.status-bar').boundingBox();
    const versionBounds = await version.boundingBox();
    expect(statusBounds).not.toBeNull();
    expect(versionBounds).not.toBeNull();
    expect(statusBounds!.x + statusBounds!.width - versionBounds!.x - versionBounds!.width)
      .toBeLessThanOrEqual(14);

    await version.click();
    await expect.poll(() => app!.evaluate(() => (
      globalThis as typeof globalThis & { janetUpdateChecks?: number }
    ).janetUpdateChecks)).toBe(1);
  } finally {
    await forceClose(app);
    fs.rmSync(userData, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
});

test('copies exact privacy-safe diagnostics from the packaged runtime', async () => {
  const executablePath = process.env.JANET_PACKAGED_EXECUTABLE;
  test.skip(!executablePath, 'Set JANET_PACKAGED_EXECUTABLE to a freshly built unpacked application');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'janet-diagnostics-e2e-'));
  let app: ElectronApplication | undefined;

  try {
    app = await electron.launch({
      executablePath,
      cwd: path.dirname(executablePath!),
      env: electronEnv({
        NODE_ENV: 'test',
        JANET_E2E_USER_DATA_DIR: userData,
      }),
    });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.terminal-container').first()).toBeVisible();

    const runtime = await app.evaluate(({ app, Notification }) => ({
      isPackaged: app.isPackaged,
      version: app.getVersion(),
      platform: process.platform,
      architecture: process.arch,
      electronVersion: process.versions.electron,
      notifications: Notification.isSupported() ? 'supported' : 'unsupported',
    }));
    expect(runtime.isPackaged).toBe(true);

    await page.getByRole('button', { name: 'Open settings' }).click();
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await settings.getByRole('button', { name: 'Copy diagnostics' }).click();
    await expect(settings.getByRole('status')).toHaveText('Diagnostics copied');

    const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
    expect(copied).toBe([
      `JaneT version: ${runtime.version}`,
      `OS: ${runtime.platform}`,
      `Architecture: ${runtime.architecture}`,
      'Mode: packaged',
      `Electron version: ${runtime.electronVersion}`,
      `Notifications: ${runtime.notifications}`,
    ].join('\n'));
    expect(copied.split('\n')).toHaveLength(6);
  } finally {
    await forceClose(app);
    fs.rmSync(userData, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
});

test('keeps a packaged updater failure actionable with the fixed releases fallback', async () => {
  const executablePath = process.env.JANET_PACKAGED_EXECUTABLE;
  test.skip(!executablePath, 'Set JANET_PACKAGED_EXECUTABLE to a freshly built unpacked application');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'janet-updater-failure-e2e-'));
  let app: ElectronApplication | undefined;

  try {
    app = await electron.launch({
      executablePath,
      cwd: path.dirname(executablePath!),
      env: electronEnv({
        NODE_ENV: 'test',
        JANET_E2E_USER_DATA_DIR: userData,
      }),
    });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.terminal-container').first()).toBeVisible();

    await app.evaluate(({ BrowserWindow, shell }) => {
      const state = globalThis as typeof globalThis & { janetOpenedExternalUrl?: string };
      state.janetOpenedExternalUrl = undefined;
      shell.openExternal = async (url) => {
        state.janetOpenedExternalUrl = url;
      };
      BrowserWindow.getAllWindows()[0]?.webContents.send('update:error', {
        message: 'Synthetic packaged updater failure',
      });
    });

    const alert = page.getByRole('alert');
    await expect(alert).toContainText('Update failed: Synthetic packaged updater failure');
    await expect(alert.getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(alert.getByRole('button', { name: 'Dismiss update notification' })).toBeVisible();
    await alert.getByRole('button', { name: 'View JaneT releases' }).click();

    await expect.poll(() => app!.evaluate(() => (
      globalThis as typeof globalThis & { janetOpenedExternalUrl?: string }
    ).janetOpenedExternalUrl)).toBe('https://github.com/Sjormz/JaneT/releases/latest');
  } finally {
    await forceClose(app);
    fs.rmSync(userData, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
});
