import type { ElectronApplication } from '@playwright/test';
import { execFile, type ChildProcess } from 'node:child_process';

export async function firstWindow(app: ElectronApplication, options?: Parameters<ElectronApplication['firstWindow']>[0]) {
  const timeout = options?.timeout ?? 30_000;
  const started = Date.now();
  // Let the inspector request return while Electron's native readiness event is pending.
  const window = app.firstWindow(options);
  const page = await Promise.race([
    window,
    app.evaluate(({ app }) => app.isReady()).then(() => window),
  ]);
  page.on('pageerror', error => console.error('[Electron renderer error]', error.message));
  const remaining = timeout === 0 ? 0 : timeout - (Date.now() - started);
  if (timeout !== 0 && remaining <= 0) throw new Error('Electron first-window deadline expired before document navigation.');
  await page.waitForURL(url => url.href !== 'about:blank', { waitUntil: 'domcontentloaded', timeout: remaining });
  return page;
}

function waitForChildEvent(child: ChildProcess, event: 'exit' | 'close', timeout: number): Promise<boolean> {
  const exited = child.exitCode !== null || child.signalCode !== null;
  const streamsClosed = [child.stdin, child.stdout, child.stderr].every(stream => !stream || stream.closed);
  if (exited && (event === 'exit' || streamsClosed)) return Promise.resolve(true);
  return new Promise(resolve => {
    const finish = (exited: boolean) => {
      clearTimeout(timer);
      child.removeListener(event, onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeout);
    child.once(event, onExit);
  });
}

export function waitForExit(child: ChildProcess, timeout: number): Promise<boolean> {
  return waitForChildEvent(child, 'exit', timeout);
}

/** Cleanup must not wait on the debugger connection that may have caused the failure. */
export async function forceClose(app: ElectronApplication | undefined): Promise<void> {
  if (!app) return;
  const child = app.process();
  if (child.exitCode === null && child.signalCode === null) {
    const exited = waitForExit(child, 5000);
    // Drain the application's PTYs before Node tears down their native callbacks.
    // A stalled renderer/debugger still reaches the same bounded kill fallback.
    void app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => {});
    if (!await exited) {
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
  }
  // `exit` can precede inherited pipe closure. Wait for both before callers
  // remove the profile; Node's `close` event represents that complete boundary.
  if (!await waitForChildEvent(child, 'close', 5000)) {
    throw new Error(`Test-owned Electron process ${child.pid} exited but its streams did not close.`);
  }
}
