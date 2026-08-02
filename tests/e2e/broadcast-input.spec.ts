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

test('broadcasts to selected real terminals until Escape cancels it', async () => {
  test.setTimeout(60_000);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'janet-broadcast-e2e-'));
  const outputPath = path.join(userData, 'broadcast-lines.txt').replace(/\\/g, '/');
  const first = `broadcast_${Date.now()}_first`;
  const second = `broadcast_${Date.now()}_second`;
  const appendCommand = (line: string) => (
    `node -e "require('fs').appendFileSync('${outputPath}','${line}\\n')"`
  );
  let app: ElectronApplication | undefined;

  try {
    app = await electron.launch({
      args: ['.'],
      cwd: root,
      env: electronEnv({ NODE_ENV: 'test', JANET_E2E_USER_DATA_DIR: userData }),
    });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    const terminals = page.locator('.terminal-container');
    await expect(terminals).toHaveCount(1);
    await page.getByRole('button', { name: 'Split pane right' }).click();
    await expect(terminals).toHaveCount(2);
    await expect.poll(async () => terminals.evaluateAll((elements) => (
      elements.every((element) => (element.querySelector('.xterm-rows')?.textContent ?? '').length > 0)
    )), { timeout: 15_000 }).toBe(true);

    const recipients = page.locator('.broadcast-recipient');
    await expect(recipients).toHaveCount(2);
    await recipients.nth(0).check();
    await recipients.nth(1).check();
    const dialog = page.getByRole('alertdialog', { name: 'Start broadcast input?' });
    await expect(dialog).toContainText('2 selected panes');
    await dialog.getByRole('button', { name: 'Start broadcast input' }).click();

    const status = page.getByRole('status', { name: /broadcast input active/i });
    await expect(status).toContainText('Broadcast input active · 2 panes');
    await expect(page.locator('.terminal-leaf.broadcast-selected')).toHaveCount(2);
    const terminalAreaBox = await page.locator('.terminal-area').boundingBox();
    const statusBox = await status.boundingBox();
    expect(terminalAreaBox).not.toBeNull();
    expect(statusBox).not.toBeNull();
    expect(Math.abs(statusBox!.width - terminalAreaBox!.width)).toBeLessThanOrEqual(1);
    expect(statusBox!.height).toBeLessThan(50);

    await terminals.nth(0).locator('.xterm-helper-textarea').focus();
    await page.keyboard.type(appendCommand(first));
    await page.keyboard.press('Enter');
    await expect.poll(() => fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '', {
      timeout: 15_000,
    }).toBe(`${first}\n${first}\n`);

    await page.keyboard.press('Escape');
    await expect(status).toBeHidden();
    await page.keyboard.type(appendCommand(second));
    await page.keyboard.press('Enter');
    await expect.poll(() => fs.readFileSync(outputPath, 'utf8'), { timeout: 15_000 })
      .toBe(`${first}\n${first}\n${second}\n`);
  } finally {
    await forceClose(app);
    fs.rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
