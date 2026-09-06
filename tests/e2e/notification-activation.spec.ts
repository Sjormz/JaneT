import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

test('Windows protocol activation launches JaneT and restores its existing window', async () => {
  test.skip(process.platform !== 'win32', 'Windows notification activation');
  const profile = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'janet-notification-e2e-'));
  const root = path.resolve(__dirname, '../..');
  const scheme = `janet-test-${randomUUID()}`;
  const args = [root, `--user-data-dir=${profile}`];
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ mainDirectory: profile, session: { tabs: [], groups: [] } }));
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'test', JANET_E2E_USER_DATA_DIR: profile };
  delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_NO_ATTACH_CONSOLE;
  let instance: ElectronApplication | undefined;
  try {
    instance = await electron.launch({ args, cwd: root, env: Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) });
    const page = await instance.firstWindow();
    await expect(page.getByRole('heading', { name: 'Create your first workspace' })).toBeVisible();
    expect(await instance.evaluate(({ app }) => app.getPath('userData'))).toBe(profile);
    const registered = await instance.evaluate(({ app, BrowserWindow }, { scheme, args }) => {
      (globalThis as any).notificationLaunchArgs = [];
      app.on('second-instance', (_event, argv) => { (globalThis as any).notificationLaunchArgs = argv; });
      BrowserWindow.getAllWindows()[0].minimize();
      return app.setAsDefaultProtocolClient(scheme, process.execPath, args);
    }, { scheme, args });
    expect(registered).toBe(true);
    const url = `${scheme}://notification/123-abc`;
    await instance.evaluate(({ shell }, url) => shell.openExternal(url), url);
    await expect.poll(() => instance!.evaluate(() => (globalThis as any).notificationLaunchArgs)).toContain(url);
    await expect.poll(() => instance!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized())).toBe(false);
    expect(await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    await expect(page.getByRole('heading', { name: 'Create your first workspace' })).toBeVisible();
  } finally {
    if (instance) {
      await instance.evaluate(({ app }, { scheme, args }) => app.removeAsDefaultProtocolClient(scheme, process.execPath, args), { scheme, args });
      await instance.close();
    }
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
