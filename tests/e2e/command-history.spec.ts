import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const root = path.resolve(__dirname, '../..');
const OUTPUT = 'JANET_HISTORY_OUTPUT_9F2A';

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
  try { await app.evaluate(({ app: electronApp }) => electronApp.exit(0)); } catch {}
  await app.waitForEvent('close', { timeout: 5_000 }).catch(() => {});
}

function containsKeyOrText(value: unknown, text: string): boolean {
  if (typeof value === 'string') return value.includes(text);
  if (Array.isArray(value)) return value.some((item) => containsKeyOrText(item, text));
  return Boolean(value && typeof value === 'object' && Object.entries(value).some(
    ([key, item]) => key === 'output' || containsKeyOrText(item, text),
  ));
}

test('persists real command metadata and history selection pastes without execution', async () => {
  test.setTimeout(60_000);
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'janet-history-e2e-'));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'janet-history-profile-'));
  const settingsPath = path.join(userData, 'settings.json');
  const markerPath = path.join(cwd, 'history-rerun.txt');
  const command = process.platform === 'win32'
    ? "Add-Content -NoNewline -Path 'history-rerun.txt' -Value 'X'; Write-Output ('JANET_HISTORY_' + 'OUTPUT_9F2A')"
    : "printf X >> history-rerun.txt; printf 'JANET_HISTORY_%s\\n' 'OUTPUT_9F2A'";
  let app: ElectronApplication | undefined;

  fs.writeFileSync(settingsPath, JSON.stringify({
    theme: 'tokyo-night', fontSize: 14, sidebarSide: 'left', keybindings: {}, workspaceTabs: [],
    session: {
      tabs: [{
        id: 'history-tab', title: 'command history', type: 'local', cwd,
        root: { type: 'leaf', title: 'history', terminalType: 'local', cwd },
      }],
      activeTabId: 'history-tab', sidebarOpen: false, tabsOpen: true, sidebarSection: 'files',
    },
  }, null, 2), 'utf-8');

  try {
    app = await electron.launch({
      args: ['.'], cwd: root,
      env: electronEnv({ NODE_ENV: 'test', JANET_E2E_USER_DATA_DIR: userData }),
    });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    const terminal = page.locator('.terminal-container');
    await expect(terminal).toBeVisible({ timeout: 15_000 });
    await expect(terminal.locator('.xterm-helper-textarea')).toHaveAttribute('data-shell-ready', 'true', { timeout: 15_000 });
    await terminal.click();
    await page.keyboard.type(command, { delay: 5 });
    await page.keyboard.press('Enter');

    await expect.poll(
      () => fs.existsSync(markerPath) ? fs.readFileSync(markerPath, 'utf-8') : '',
      { timeout: 15_000 },
    ).toBe('X');
    await expect.poll(() => {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      return settings.commandHistory?.[0]?.command;
    }, { timeout: 15_000 }).toBe(command);
    const persisted = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(persisted.commandHistory).toHaveLength(1);
    expect(persisted.commandHistory.length).toBeLessThanOrEqual(256);
    expect(persisted.commandHistory[0]).toEqual({
      id: expect.any(String),
      command,
      startedAt: expect.any(Number),
      durationMs: expect.any(Number),
      exitCode: 0,
      context: { kind: 'local', cwd: cwd.replace(/\\/g, '/') },
    });
    expect(persisted.commandHistory[0].startedAt).toBeGreaterThan(0);
    expect(persisted.commandHistory[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(containsKeyOrText(persisted.commandHistory, OUTPUT)).toBe(false);

    await page.getByRole('button', { name: /Open command palette/ }).click();
    await page.getByRole('option', { name: /Open command history/ }).click();
    const picker = page.getByRole('dialog', { name: 'Command history' });
    await expect(picker).toBeVisible();
    await picker.getByRole('combobox', { name: 'Search command history' }).fill('history-rerun.txt');
    await picker.getByLabel('Context').selectOption('local');
    const capturedCommand = picker.getByRole('option').filter({ hasText: command });
    await expect(capturedCommand).toHaveCount(1);
    await capturedCommand.click();
    expect(fs.readFileSync(markerPath, 'utf-8')).toBe('X');

    await page.keyboard.press('Enter');
    await expect.poll(() => fs.readFileSync(markerPath, 'utf-8'), { timeout: 15_000 }).toBe('XX');
  } finally {
    await forceClose(app);
    fs.rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
