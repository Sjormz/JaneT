import { electronEnv, firstWindow, forceClose } from './electronLifecycle';
import { terminalSettings } from './workspaces';
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const root = path.resolve(__dirname, '../..');

test('broadcasts to selected real terminals until Escape cancels it', async () => {
  test.setTimeout(60_000);
  const userData = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'janet-broadcast-e2e-'));
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify(terminalSettings(userData)));
  const outputPrefix = path.join(userData, 'broadcast-result-').replace(/\\/g, '/');
  const receivedLines = () => fs.readdirSync(userData)
    .filter(name => /^broadcast-result-\d+\.txt$/.test(name))
    .map(name => fs.readFileSync(path.join(userData, name), 'utf8')).sort();
  const first = `broadcast_${Date.now()}_first`;
  const second = `broadcast_${Date.now()}_second`;
  const appendCommand = (line: string) => (
    `node -e "require('fs').appendFileSync('${outputPrefix}'+process.ppid+'.txt','${line}\\n')"`
  );
  let app: ElectronApplication | undefined;

  try {
    app = await electron.launch({
      args: ['.'],
      cwd: root,
      env: electronEnv({ NODE_ENV: 'test', JANET_E2E_USER_DATA_DIR: userData }),
    });
    const page = await firstWindow(app);
    await page.waitForLoadState('domcontentloaded');

    const terminals = page.locator('.terminal-container');
    await expect(terminals).toHaveCount(1);
    // A rendered pane does not mean the app has registered its shortcuts yet: a split pressed right after first
    // paint can be dropped (seen on warm Windows starts). Wait for the pane's shell, as other shortcut specs do.
    await expect(terminals.locator('.xterm-helper-textarea[data-shell-ready="true"]')).toHaveCount(1, { timeout: 15_000 });
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Backslash' : 'Control+Shift+Digit5');
    await expect(terminals).toHaveCount(2);
    await expect(terminals.locator('.xterm-helper-textarea[data-shell-ready="true"]'))
      .toHaveCount(2, { timeout: 15_000 });

    const recipients = page.locator('.broadcast-recipient');
    await expect(recipients).toHaveCount(2);
    await recipients.nth(0).check();
    await recipients.nth(1).check();
    const dialog = page.getByRole('alertdialog', { name: 'Start broadcast input?' });
    await expect(dialog).toContainText('2 selected panes');
    await expect.poll(() => dialog.evaluate(element => element.getAnimations({ subtree: true })
      .some(animation => animation.playState === 'running'))).toBe(false);
    await dialog.getByRole('button', { name: 'Start broadcast input' }).click();

    const status = page.getByRole('status', { name: /broadcast input active/i });
    await expect(status).toContainText('Broadcast input active · 2 panes');
    await expect(page.locator('.terminal-leaf.broadcast-selected')).toHaveCount(2);
    const terminalAreaBox = await page.locator('.terminal-area > .split-container').boundingBox();
    const statusBox = await status.boundingBox();
    expect(terminalAreaBox).not.toBeNull();
    expect(statusBox).not.toBeNull();
    expect(Math.abs(statusBox!.width - terminalAreaBox!.width)).toBeLessThanOrEqual(1);
    expect(statusBox!.height).toBeLessThan(50);

    await terminals.nth(0).locator('.xterm-helper-textarea').focus();
    await page.keyboard.type(appendCommand(first), { delay: 5 });
    await page.keyboard.press('Enter');
    await expect.poll(receivedLines, {
      timeout: 15_000,
    }).toEqual([`${first}\n`, `${first}\n`]);

    await page.keyboard.press('Escape');
    await expect(status).toBeHidden();
    await page.keyboard.type(appendCommand(second), { delay: 5 });
    await page.keyboard.press('Enter');
    await expect.poll(receivedLines, { timeout: 15_000 })
      .toEqual([`${first}\n`, `${first}\n${second}\n`].sort());
  } finally {
    await forceClose(app);
    fs.rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
