import { forceClose } from './electronLifecycle';
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

test('removes legacy remote panes while retaining local terminals and empty projects', async () => {
  const userData = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'janet-local-migration-e2e-'));
  const settingsPath = path.join(userData, 'settings.json');
  const remoteLeaf = { type: 'leaf', terminalType: 'ssh', sshProfileId: 'old', startupCommands: ['echo remote-only'] };
  fs.writeFileSync(settingsPath, JSON.stringify({
    mainDirectory: userData,
    sshProfiles: [{ id: 'old', name: 'Old connection', host: 'unused.invalid', port: 22, auth: 'password' }],
    session: {
      tabs: [
        { id: 'remote', title: 'Remote only', type: 'ssh', root: remoteLeaf },
        { id: 'mixed', title: 'Mixed project', type: 'local', isProject: true, cwd: userData,
          root: { type: 'split', direction: 'vertical', sizes: [1, 1], children: [
            { type: 'leaf', terminalType: 'local', title: 'Local survivor', cwd: userData }, remoteLeaf,
          ] }, selectedPanePath: [1] },
        { id: 'empty', title: 'Retained project', type: 'local', isProject: true, cwd: userData, root: remoteLeaf },
      ],
      activeTabId: 'mixed', sidebarSection: 'ssh', sidebarOpen: true, tabsOpen: true,
    },
  }));
  let app: ElectronApplication | undefined;
  try {
    app = await launch(userData);
    const page = await app.firstWindow();
    await expect(page.locator('.terminal-container')).toHaveCount(1);
    await expect(page.locator('.xterm-helper-textarea')).toHaveAttribute('data-shell-ready', 'true');
    await expect(page.getByText('Retained project', { exact: true })).toBeVisible();
    await expect(page.getByText('Remote only', { exact: true })).toHaveCount(0);
    const settings = await page.evaluate(async () => {
      const current = await window.janet.getSettings();
      await window.janet.setSettings({ fontSize: 15 });
      return { current, remoteApi: Object.keys(window.janet).filter((key) => /ssh/i.test(key)) };
    });
    expect(settings.remoteApi).toEqual([]);
    expect(settings.current).not.toHaveProperty('sshProfiles');
    const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    expect(saved).not.toHaveProperty('sshProfiles');
    expect(saved.session.tabs).toHaveLength(2);
    expect(JSON.stringify(saved)).not.toContain('remote-only');
  } finally {
    await forceClose(app);
    fs.rmSync(userData, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
});

test('restores a validated previous generation without overwriting corrupt settings on launch', async () => {
  const userData = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'janet-settings-recovery-e2e-'));
  const settingsPath = path.join(userData, 'settings.json');
  const corruptBytes = '{"theme":';
  fs.writeFileSync(settingsPath, corruptBytes, 'utf8');
  fs.writeFileSync(`${settingsPath}.previous`, JSON.stringify({ mainDirectory: userData, theme: 'dracula', fontSize: 16 }), 'utf8');
  let app: ElectronApplication | undefined;

  try {
    app = await launch(userData);
    const page = await app.firstWindow();
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('could not load your workspace settings');
    expect(fs.readFileSync(settingsPath, 'utf8')).toBe(corruptBytes);

    await alert.getByRole('button', { name: 'Restore previous' }).click();
    await expect(page.getByRole('heading', { name: 'Create your first workspace' })).toBeVisible();
    await expect(page.locator('.terminal-container')).toHaveCount(0);
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
  const userData = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'janet-settings-reset-e2e-'));
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
    await expect(page.getByRole('heading', { name: 'A home for your work' })).toBeVisible();
    expect(JSON.parse(fs.readFileSync(settingsPath, 'utf8'))).toMatchObject({
      theme: 'one-dark',
      fontSize: 14,
    });
  } finally {
    await forceClose(app);
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
