import type { ElectronApplication } from '@playwright/test';
import { execFile, type ChildProcess } from 'node:child_process';

export async function firstWindow(app: ElectronApplication, options?: Parameters<ElectronApplication['firstWindow']>[0]) {
  const timeout = options?.timeout ?? 30_000;
  const started = Date.now();
  // Synchronous inspector queries let native startup advance while waiting for its window.
  // One query can arrive before readiness and leave macOS stalled until the next inspector request.
  const window = app.firstWindow(options);
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const readiness = new Promise<never>((_resolve, reject) => {
    const probe = () => {
      app.evaluate(({ app }) => app.isReady()).then(() => {
        if (!settled) timer = setTimeout(probe, 100);
      }, reject);
    };
    probe();
  });
  let page;
  try {
    page = await Promise.race([window, readiness]);
  } finally {
    settled = true;
    clearTimeout(timer);
  }
  page.on('pageerror', error => console.error('[Electron renderer error]', error.message));
  const remaining = timeout === 0 ? 0 : timeout - (Date.now() - started);
  if (timeout !== 0 && remaining <= 0) throw new Error('Electron first-window deadline expired before document navigation.');
  await page.waitForURL(url => url.href !== 'about:blank', { waitUntil: 'domcontentloaded', timeout: remaining });
  return page;
}

export function waitForExit(child: ChildProcess, timeout: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise(resolve => {
    const finish = (exited: boolean) => {
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeout);
    child.once('exit', onExit);
  });
}

/** Cleanup must not wait on the debugger connection that may have caused the failure. */
export async function forceClose(app: ElectronApplication | undefined): Promise<void> {
  if (!app) return;
  const child = app.process();
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = waitForExit(child, 5000);
  void app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => {});
  if (await exited) return;
  const killed = waitForExit(child, 5000);
  if (process.platform === 'win32') {
    await new Promise<void>((resolve, reject) => {
      execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }, error => {
        if (error && child.exitCode === null && child.signalCode === null) reject(error);
        else resolve();
      });
    });
  } else child.kill('SIGKILL');
  if (!await killed) throw new Error(`Test-owned Electron process ${child.pid} did not exit.`);
}
