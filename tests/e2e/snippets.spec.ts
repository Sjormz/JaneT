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

async function forceClose(app: ElectronApplication | undefined): Promise<void> {
  if (!app) return;
  try {
    await app.evaluate(({ app: electronApp }) => electronApp.exit(0));
  } catch {}
  await app.waitForEvent('close', { timeout: 5_000 }).catch(() => {});
}

test('keeps the empty picker compact and deletes a snippet with a mouse click', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'janet-snippets-e2e-'));
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
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(800, 600));

    await page.getByRole('button', { name: /Open command palette/ }).click();
    await page.getByRole('option', { name: /Open snippets/ }).click();
    const picker = page.getByRole('dialog', { name: 'Snippets' });
    await expect(picker).toBeVisible();
    await expect(picker.getByRole('status')).toContainText('No snippets yet');
    const emptyBounds = await picker.boundingBox();
    expect(emptyBounds).not.toBeNull();
    expect(emptyBounds!.width).toBeLessThanOrEqual(580);
    expect(emptyBounds!.height).toBeLessThanOrEqual(380);

    await page.getByRole('button', { name: 'New snippet' }).click();
    await page.getByRole('textbox', { name: 'Snippet name' }).fill('Temporary snippet');
    await page.getByRole('textbox', { name: 'Snippet content' }).fill('echo temporary');
    await page.getByRole('button', { name: 'Save snippet' }).click();
    await expect(page.getByText('Temporary snippet', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Delete Temporary snippet' }).click();
    await expect(page.getByRole('alertdialog', { name: 'Delete Temporary snippet?' })).toBeVisible();

    await page.getByRole('button', { name: 'Delete snippet' }).click();

    await expect(page.getByRole('dialog', { name: 'Snippets' })).toBeVisible();
    await expect(page.getByText('Temporary snippet', { exact: true })).toHaveCount(0);
    await expect(page.getByText('No snippets yet')).toBeVisible();
  } finally {
    await forceClose(app);
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
