import { test, expect, chromium, type Browser } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as net from 'node:net';

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

test('starts the real dev launcher and cleans up its owned processes', async ({}, testInfo) => {
  test.setTimeout(60_000);
  const userData = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'janet-dev-smoke-'));
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ mainDirectory: userData }));
  const port = await freePort();
  const debugPort = await freePort();
  const url = `http://127.0.0.1:${port}/`;
  const child = spawn(process.execPath, ['scripts/dev.mjs'], {
    cwd: path.resolve(__dirname, '../..'), windowsHide: true,
    env: { ...process.env, JANET_DEV_SERVER_URL: url, JANET_E2E_USER_DATA_DIR: userData, JANET_E2E_REMOTE_DEBUGGING_PORT: String(debugPort) },
  });
  let output = '';
  child.stdout.on('data', (data) => { output += data; });
  child.stderr.on('data', (data) => { output += data; });
  let browser: Browser | undefined;
  try {
    await expect.poll(() => output, { timeout: 25_000 }).toContain('Starting Electron');
    await expect.poll(async () => fetch(`http://127.0.0.1:${debugPort}/json/version`).then((r) => r.ok).catch(() => false)).toBe(true);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
    const page = browser.contexts()[0].pages().find((page) => !page.url().startsWith('devtools:'))!;
    await expect(page).toHaveURL(url);
    await expect(page.getByRole('heading', { name: 'Create your first workspace' })).toBeVisible();
    await expect(page.locator('.terminal-container')).toHaveCount(0);
    await page.evaluate(() => window.janet.windowClose());
    await expect.poll(() => child.exitCode, { timeout: 10_000 }).toBe(0);
    await expect.poll(() => fetch(url).then(() => true).catch(() => false)).toBe(false);
    expect(output).not.toContain('spawn error');
  } finally {
    await testInfo.attach('dev-launcher-log', { body: output, contentType: 'text/plain' });
    await browser?.close().catch(() => {});
    if (child.exitCode === null && child.pid) {
      if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      else child.kill('SIGTERM');
    }
    await fs.promises.rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
