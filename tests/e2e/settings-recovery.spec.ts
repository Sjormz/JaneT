import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const root = path.resolve(__dirname, '../..');

function electronEnv(extra: NodeJS.ProcessEnv): Record<string, string> {
  const env = { ...process.env, ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

async function launch(userData: string): Promise<ElectronApplication> {
  return electron.launch({
    args: ['.'],
    cwd: root,
    env: electronEnv({ NODE_ENV: 'test', JANET_E2E_USER_DATA_DIR: userData }),
  });
}

async function forceClose(app: ElectronApplication | undefined): Promise<void> {
  if (!app) return;
  try {
    await app.evaluate(({ app: electronApp }) => electronApp.exit(0));
  } catch {}
  await app.waitForEvent('close', { timeout: 5_000 }).catch(() => {});
}

test('restores a validated previous generation without overwriting corrupt settings on launch', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'janet-settings-recovery-e2e-'));
  const settingsPath = path.join(userData, 'settings.json');
  const corruptBytes = '{"theme":';
  fs.writeFileSync(settingsPath, corruptBytes, 'utf8');
  fs.writeFileSync(`${settingsPath}.previous`, JSON.stringify({ theme: 'dracula', fontSize: 16 }), 'utf8');
  let app: ElectronApplication | undefined;

  try {
    app = await launch(userData);
    const page = await app.firstWindow();
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('could not load your workspace settings');
    expect(fs.readFileSync(settingsPath, 'utf8')).toBe(corruptBytes);

    await alert.getByRole('button', { name: 'Restore previous' }).click();
    await expect(page.locator('.terminal-container').first()).toBeVisible();
    expect(JSON.parse(fs.readFileSync(settingsPath, 'utf8'))).toMatchObject({
      theme: 'dracula',
      fontSize: 16,
    });
  } finally {
    await forceClose(app);
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test('replaces corrupt settings with defaults only after confirmation', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'janet-settings-reset-e2e-'));
  const settingsPath = path.join(userData, 'settings.json');
  const corruptBytes = '{"theme":';
  fs.writeFileSync(settingsPath, corruptBytes, 'utf8');
  let app: ElectronApplication | undefined;

  try {
    app = await launch(userData);
    const page = await app.firstWindow();
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('could not load your workspace settings');

    await alert.getByRole('button', { name: 'Use defaults' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Use default settings?' });
    await expect(dialog).toBeVisible();
    expect(fs.readFileSync(settingsPath, 'utf8')).toBe(corruptBytes);

    await dialog.getByRole('button', { name: 'Use defaults' }).click();
    await expect(page.locator('.terminal-container').first()).toBeVisible();
    expect(JSON.parse(fs.readFileSync(settingsPath, 'utf8'))).toMatchObject({
      theme: 'tokyo-night',
      fontSize: 14,
    });
  } finally {
    await forceClose(app);
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
