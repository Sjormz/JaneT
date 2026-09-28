import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { forceClose } from './electronLifecycle';

function electronEnv(extra: NodeJS.ProcessEnv): Record<string, string> {
  const env = { ...process.env, ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

// The real default shell encodes its cwd with this machine's hostname, and the
// renderer accepts it only through the hostname supplied by the preload.
test('Explorer follows the shell into directories with URL-special names', async () => {
  test.setTimeout(90_000);
  const userData = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'janet-cwd-tracking-e2e-')));
  const start = path.join(userData, 'start');
  const target = path.join(start, 'Space & 100% #dir ünï');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(start, 'start-marker.txt'), 'start');
  fs.writeFileSync(path.join(target, 'target-marker.txt'), 'target');
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({
    mainDirectory: start, theme: 'tokyo-night',
    session: { groups: [{ id: 'cwd', name: 'Cwd', directory: start }], tabs: [
      { id: 'cwd-tab', groupId: 'cwd', title: 'Cwd', type: 'local', cwd: start, root: { type: 'leaf', cwd: start } },
    ], activeTabId: 'cwd-tab', sidebarOpen: true, sidebarSection: 'files' },
  }));
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({
      args: ['.'], cwd: path.resolve(__dirname, '../..'),
      env: electronEnv({ NODE_ENV: 'test', JANET_E2E_USER_DATA_DIR: userData }),
    });
    const page = await app.firstWindow();
    const terminal = page.locator('[data-terminal-id]').first();
    await expect(terminal).toBeVisible();
    await expect(terminal.locator('textarea[data-shell-ready="true"]')).toBeAttached();
    const termId = await terminal.getAttribute('data-terminal-id');
    expect(termId).toBeTruthy();
    await expect(page.getByRole('button', { name: 'Open file start-marker.txt' })).toBeVisible();

    // `cd '<path>'` is valid in PowerShell, Bash, Zsh and Fish.
    await page.evaluate(({ id, text }) => window.janet.terminalWrite({ id, data: `${text}\r`, userInput: true }), {
      id: termId!, text: `cd '${target}'`,
    });
    await expect(page.getByRole('button', { name: 'Open file target-marker.txt' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Open file start-marker.txt' })).toHaveCount(0);
  } finally {
    await forceClose(app);
    fs.rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
