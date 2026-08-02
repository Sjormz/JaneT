import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const root = path.resolve(__dirname, '../..');
const command = 'node -e "setTimeout(()=>{},1200)"';

function electronEnv(extra: NodeJS.ProcessEnv): Record<string, string> {
  const env = { ...process.env, ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

function readDecisions(eventsPath: string): Array<Record<string, unknown>> {
  if (!fs.existsSync(eventsPath)) return [];
  return fs.readFileSync(eventsPath, 'utf8').split(/\r?\n/).filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((event) => event.type === 'notification:decision');
}

async function forceClose(app: ElectronApplication | undefined): Promise<void> {
  if (!app) return;
  try { await app.evaluate(({ app: electronApp }) => electronApp.exit(0)); } catch {}
  await app.waitForEvent('close', { timeout: 5_000 }).catch(() => {});
}

test('records focused and unfocused notification decisions without command or output', async () => {
  test.setTimeout(60_000);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'janet-focus-notifications-e2e-'));
  const eventsPath = path.join(userData, 'events.jsonl');
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({
    notificationsEnabled: true,
    notificationThresholdSeconds: 1,
    workspaceTabs: [],
  }));
  let app: ElectronApplication | undefined;

  try {
    app = await electron.launch({
      args: ['.'], cwd: root,
      env: electronEnv({ NODE_ENV: 'test', JANET_E2E_USER_DATA_DIR: userData, JANET_E2E_EVENTS_PATH: eventsPath }),
    });
    await app.evaluate(({ Notification }) => {
      Object.defineProperty(Notification, 'isSupported', { value: () => true });
    });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    const terminal = page.locator('[data-terminal-id]').first();
    await expect(terminal).toBeVisible();
    const termId = await terminal.getAttribute('data-terminal-id');
    expect(termId).toBeTruthy();

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.focus());
    await page.evaluate(({ id, text }) => window.janet.terminalWrite({ id, data: `${text}\r`, userInput: true }), { id: termId!, text: command });
    await expect.poll(() => readDecisions(eventsPath).map((event) => event.decision), { timeout: 15_000 }).toContain('focused');

    await app.evaluate(({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows()[0];
      const away = new BrowserWindow({ width: 200, height: 100, show: true });
      away.loadURL('about:blank');
      away.focus();
      main?.blur();
    });
    await page.evaluate(({ id, text }) => window.janet.terminalWrite({ id, data: `${text}\r`, userInput: true }), { id: termId!, text: command });
    await expect.poll(() => readDecisions(eventsPath).map((event) => event.decision), { timeout: 15_000 }).toContain('would-show');

    for (const decision of readDecisions(eventsPath)) {
      expect(Object.keys(decision).sort()).toEqual(['contextKind', 'decision', 'durationMs', 'outcome', 'type']);
      expect(decision).not.toHaveProperty('command');
      expect(decision).not.toHaveProperty('output');
    }
  } finally {
    await forceClose(app);
    fs.rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
