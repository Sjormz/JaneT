import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

test('records startup, loaded-terminal input and pane lifecycle memory baselines', async ({}, testInfo) => {
  test.setTimeout(90_000);
  const userData = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'janet-performance-'));
  const command = `node -e "process.stdin.setRawMode(true);let n=0;setInterval(()=>process.stdout.write('LOAD_'+(++n)+'\\r\\n'.repeat(20)),20).unref();process.stdin.on('data',()=>{console.log('JANET_INPUT_OBSERVED');process.exit(0)})"`;
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ mainDirectory: userData,
    theme: 'one-dark', fontSize: 14, sidebarSide: 'right', keybindings: {}, workspaceTabs: [],
    session: { tabs: [{ id: 'performance', title: 'Performance', type: 'local', root: {
      type: 'leaf', title: 'Performance', terminalType: 'local', startupCommands: [command],
    } }], activeTabId: 'performance', sidebarOpen: false, tabsOpen: true, sidebarSection: 'files' },
  }));
  const env: Record<string, string> = Object.fromEntries(Object.entries({ ...process.env, NODE_ENV: 'test', JANET_E2E_USER_DATA_DIR: userData })
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  let app: ElectronApplication | undefined;
  try {
    const started = performance.now();
    app = await electron.launch({ args: ['.'], cwd: path.resolve(__dirname, '../..'), env });
    const page = await app.firstWindow();
    await expect(page.locator('.xterm-rows')).toContainText('LOAD_', { timeout: 20_000 });
    const startupMs = performance.now() - started;
    await expect.poll(async () => Math.max(0, ...Array.from((await page.locator('.xterm-rows').innerText()).matchAll(/LOAD_(\d+)/g), (match) => Number(match[1])))).toBeGreaterThan(100);
    await expect.poll(() => page.locator('.xterm-scrollable-element .xterm-scrollbar.xterm-vertical .xterm-slider').evaluate((el) => el.clientHeight)).toBeGreaterThan(0);
    await page.locator('.xterm-helper-textarea').focus();
    const inputStarted = performance.now();
    await page.keyboard.type('x');
    await expect(page.locator('.xterm-rows')).toContainText('JANET_INPUT_OBSERVED');
    const loadedInputMs = performance.now() - inputStarted;
    const memory = () => app!.evaluate(({ app: application }) => application.getAppMetrics()
      .map(({ type, memory: sample }) => ({ type, workingSetKB: sample.workingSetSize })));
    const before = await memory();
    for (let cycle = 0; cycle < 5; cycle++) {
      await page.getByRole('button', { name: 'Split pane right', exact: true }).first().click();
      await expect(page.locator('.terminal-container')).toHaveCount(2);
      await page.locator('.terminal-leaf').last().getByRole('button', { name: /^Close pane/ }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Close pane', exact: true }).click();
      await expect(page.locator('.terminal-container')).toHaveCount(1);
    }
    const after = await memory();
    const baselinePath = testInfo.outputPath('performance-baseline.json');
    fs.writeFileSync(baselinePath, JSON.stringify({ platform: process.platform, startupMs, loadedInputMs, cycles: 5, before, after }, null, 2));
    await testInfo.attach('performance-baseline', {
      path: baselinePath,
      contentType: 'application/json',
    });
  } finally {
    if (app) await app.evaluate(({ app: application }) => application.exit(0)).catch(() => {});
    if (app) await app.waitForEvent('close', { timeout: 5000 }).catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
