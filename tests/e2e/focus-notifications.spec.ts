import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { installCodexActivity } from '../../src/main/codexActivitySetup';
import { parse } from 'smol-toml';

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

test('records focus decisions and project busy/unread activity without command or output', async ({}, testInfo) => {
  test.setTimeout(60_000);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'janet-focus-notifications-e2e-'));
  const eventsPath = path.join(userData, 'events.jsonl');
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ mainDirectory: userData,
    notificationsEnabled: true,
    notificationThresholdSeconds: 1,
    workspaceTabs: [],
    session: { groups: [{ id: 'activity', name: 'Activity', directory: userData }], tabs: [
      { id: 'work', groupId: 'activity', title: 'Work', type: 'local', cwd: userData, root: { type: 'leaf', cwd: userData } },
      { id: 'other', groupId: 'activity', title: 'Other', type: 'local', cwd: userData, root: { type: 'leaf', cwd: userData } },
    ], activeTabId: 'work' },
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
    await expect(terminal.locator('textarea[data-shell-ready="true"]')).toBeAttached();

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.focus());
    await page.evaluate(({ id, text }) => window.janet.terminalWrite({ id, data: `${text}\r`, userInput: true }), { id: termId!, text: command });
    await expect(page.locator('.vtab-item').filter({ hasText: 'Work' }).locator('.activity-dot')).toHaveClass(/running/);
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
    await expect(page.locator('.vtab-item').filter({ hasText: 'Work' }).locator('.activity-count.finished')).toContainText('1 new');
    await page.screenshot({ path: testInfo.outputPath('project-activity.png') });
    await app.evaluate(({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows().find(window => window.webContents.getURL() !== 'about:blank');
      main?.focus();
    });
    await expect(page.locator('.vtab-item').filter({ hasText: 'Work' }).locator('.activity-count.finished')).toHaveCount(0);

    // Exercise the real Codex hook helper inside a live PTY, without a model request.
    const helper = path.join(userData, 'agent-activity', 'agent-cli.cjs');
    const control = path.join(userData, 'event.json');
    const harness = path.join(userData, 'harness.cjs');
    const codexHome = path.join(userData, 'codex-home'); fs.mkdirSync(codexHome);
    const forwarded = path.join(userData, 'forwarded.json');
    const notifier = path.join(userData, 'original-notifier.cjs');
    fs.writeFileSync(notifier, `require('fs').writeFileSync(${JSON.stringify(forwarded)},process.argv[2]);`);
    fs.writeFileSync(path.join(codexHome, 'config.toml'), 'notify=' + JSON.stringify(['node', notifier]));
    installCodexActivity(codexHome, helper);
    const notify = parse(fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8')).notify as string[];
    fs.writeFileSync(harness, `const fs=require('fs'),cp=require('child_process'),notify=${JSON.stringify(notify)}; let previous=''; setInterval(()=>{try{const input=fs.readFileSync(${JSON.stringify(control)},'utf8'); if(input!==previous){previous=input;const data=JSON.parse(input);cp.execFileSync(data.type?notify[0]:process.execPath,data.type?[...notify.slice(1),input]:[${JSON.stringify(helper)},...(data.setup?['--setup-codex','-c','notify=[]']:['--codex-hook'])],{input:data.type||data.setup?'':input,env:{...process.env,CODEX_HOME:${JSON.stringify(codexHome)}},timeout:3000,windowsHide:true});}}catch(error){process.stderr.write(String(error));}},100);`);
    const sendHook = (hook: string) => fs.writeFileSync(control, JSON.stringify(hook === 'agent-turn-complete'
      ? { type: hook, 'thread-id': 'codex-test', 'turn-id': 'turn' }
      : { hook_event_name: hook, session_id: 'codex-test', turn_id: 'turn' }));
    sendHook('SessionStart');
    await page.evaluate(({ id, text }) => window.janet.terminalWrite({ id, data: `${text}\r`, userInput: true }), { id: termId!, text: `node "${harness}"` });
    const work = page.locator('.vtab-item').filter({ hasText: 'Work' });
    await expect(work).toHaveAttribute('aria-label', /Codex · Ready/);
    await page.locator('.vtab-item').filter({ hasText: 'Other' }).click();
    sendHook('UserPromptSubmit');
    await expect(work.locator('.activity-dot')).toHaveClass(/running/);
    sendHook('PermissionRequest');
    await expect(work.locator('.activity-dot')).toHaveClass(/needs-input/);
    sendHook('PostToolUse');
    await expect(work.locator('.activity-dot')).toHaveClass(/running/);
    sendHook('agent-turn-complete');
    await expect(work.locator('.activity-count.finished')).toContainText('1 new');
    await expect.poll(() => fs.existsSync(forwarded) && JSON.parse(fs.readFileSync(forwarded, 'utf8')).type).toBe('agent-turn-complete');
    expect((await work.boundingBox())!.height).toBeLessThan(45);
    await page.screenshot({ path: testInfo.outputPath('codex-project-activity.png') });
    const target = { tabId: (await work.getAttribute('data-tab-id'))!, termId: termId! };
    await app.evaluate(({ BrowserWindow }, target) => {
      BrowserWindow.getAllWindows().find(window => window.webContents.getURL() !== 'about:blank')?.webContents.send('notifications:target', target);
    }, target);
    await expect(work).toHaveAttribute('aria-pressed', 'true');
    await expect(work.locator('.activity-count.finished')).toHaveCount(0);
    await expect(work).toHaveAttribute('aria-label', /Codex · Ready/);
    fs.writeFileSync(control, JSON.stringify({ setup: true }));
    await expect(work).toHaveAttribute('aria-label', /Activity tracking incomplete/);
    await expect(work.locator('.activity-count.running')).toHaveCount(0);

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
