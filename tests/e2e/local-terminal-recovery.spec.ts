import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const root = path.resolve(__dirname, '../..');

function electronEnv(userData: string): Record<string, string> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
        && entry[0].toUpperCase() !== 'PATH'
        && entry[0] !== 'ELECTRON_RUN_AS_NODE'
        && entry[0] !== 'ELECTRON_NO_ATTACH_CONSOLE',
    ),
  );
  return {
    ...env,
    NODE_ENV: 'test',
    JANET_E2E_USER_DATA_DIR: userData,
    JANET_E2E_RESTORE_PATH: process.env.PATH ?? '',
    PATH: '',
  };
}

async function forceClose(app: ElectronApplication | undefined): Promise<void> {
  if (!app) return;
  await app.close().catch(() => {});
}

test('recovers a failed local terminal in the same pane only after explicit retry', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'janet-local-recovery-e2e-'));
  let app: ElectronApplication | undefined;

  try {
    app = await electron.launch({
      args: ['.'],
      cwd: root,
      env: electronEnv(userData),
    });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    const terminal = page.locator('.terminal-container').first();
    await expect(terminal).toBeVisible();
    const terminalId = await terminal.getAttribute('data-terminal-id');
    expect(terminalId).toBeTruthy();

    const alert = page.getByRole('alert');
    await expect(alert).toContainText('Couldn’t start local terminal');
    await expect(alert).toContainText('File not found');
    const retry = page.getByRole('button', { name: 'Retry' });
    await expect(retry).toHaveCount(1);
    await expect(retry).toBeVisible();

    await page.waitForTimeout(300);
    await expect(alert).toBeVisible();
    await expect(terminal.locator('.xterm-helper-textarea')).not.toHaveAttribute('data-shell-ready', 'true');

    await app.evaluate(() => {
      process.env.PATH = process.env.JANET_E2E_RESTORE_PATH ?? '';
    });
    await retry.focus();
    await expect(retry).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(alert).toHaveCount(0);
    await expect(terminal).toHaveAttribute('data-terminal-id', terminalId!);
    await expect(terminal.locator('.xterm-helper-textarea')).toHaveAttribute('data-shell-ready', 'true');
  } finally {
    await forceClose(app);
    fs.rmSync(userData, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
});
