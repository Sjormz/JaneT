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
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

test('turning off agent activity removes saved entries through the bundled helper', async () => {
  test.setTimeout(60_000);
  const userData = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'janet-agent-integrations-e2e-')));
  // Every agent home points into the disposable profile; the user's real configuration is never read or changed.
  const home = path.join(userData, 'home');
  const codexHome = path.join(userData, 'codex');
  const hermesHome = path.join(userData, 'hermes');
  for (const directory of [home, codexHome, hermesHome]) fs.mkdirSync(directory);
  const helper = path.join(userData, 'agent-activity', 'agent-cli.cjs').replace(/\\/g, '/');
  fs.writeFileSync(path.join(codexHome, 'hooks.json'), JSON.stringify({ hooks: {
    SessionStart: [{ hooks: [{ type: 'command', command: 'mine' }] }, { hooks: [{ type: 'command', command: `node '${helper}' --codex-hook`, timeout: 2, statusMessage: 'JaneT activity' }] }],
  } }));
  fs.writeFileSync(path.join(codexHome, 'config.toml'), `model = "keep"\nnotify = ${JSON.stringify(['node', helper, '--codex-notify-forward', JSON.stringify(['my-notifier'])])}\n`);
  fs.writeFileSync(path.join(hermesHome, 'config.yaml'), `model: keep\nhooks:\n  pre_llm_call:\n    - command: mine\n    - command: 'node "${helper}" --hermes-hook'\n      timeout: 2\n`);
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ mainDirectory: userData, workspaceTabs: [], session: { groups: [], tabs: [], activeTabId: null } }));
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({
      args: ['.'], cwd: root,
      env: electronEnv({ NODE_ENV: 'test', JANET_E2E_USER_DATA_DIR: userData, CODEX_HOME: codexHome, HERMES_HOME: hermesHome,
        JANET_E2E_AGENT_HOME: home }),
    });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.getByRole('button', { name: 'Open settings' }).click();
    const toggle = page.getByRole('checkbox', { name: 'Show agent activity' });
    await expect(toggle).toBeChecked();
    await toggle.click();
    const feedback = page.getByRole('dialog', { name: 'Settings' }).locator('.settings-feedback');
    await expect(feedback).toContainText('Codex: removed JaneT entries from 2 file(s).', { timeout: 20_000 });
    await expect(feedback).toContainText('Hermes: removed JaneT hooks from 1 file(s).');
    await expect(toggle).not.toBeChecked();
    expect(JSON.parse(fs.readFileSync(path.join(codexHome, 'hooks.json'), 'utf8'))).toEqual({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'mine' }] }] } });
    expect(fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8')).toBe('model = "keep"\nnotify = ["my-notifier"]\n');
    expect(fs.readFileSync(path.join(hermesHome, 'config.yaml'), 'utf8')).toBe('model: keep\nhooks:\n  pre_llm_call:\n    - command: mine\n');
    expect(fs.readdirSync(codexHome).filter(name => name.includes('.janet-backup-'))).toHaveLength(2);
    await expect.poll(() => JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')).agentIntegrations).toBe(false);
    await toggle.click();
    await expect(feedback).toHaveText('Agent activity is on for new terminals.');
    await expect.poll(() => JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')).agentIntegrations).toBe(true);
  } finally {
    await forceClose(app);
    fs.rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
