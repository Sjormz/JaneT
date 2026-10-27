// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import type { ElectronApplication } from '@playwright/test';
import { firstWindow, forceClose } from '../e2e/electronLifecycle';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });

it('probes readiness synchronously without losing the first-window deadline', async () => {
  const page = { on: vi.fn(), waitForURL: vi.fn().mockResolvedValue(undefined) };
  let publishWindow!: (page: unknown) => void;
  const window = new Promise(resolve => { publishWindow = resolve; });
  const whenReady = vi.fn(async () => {});
  const isReady = vi.fn(() => false);
  const app = {
    firstWindow: vi.fn(() => window),
    evaluate: vi.fn(async (callback: (electron: any) => unknown) => {
      const result = callback({ app: { whenReady, isReady } });
      expect(result).not.toBeInstanceOf(Promise);
      publishWindow(page);
      return result;
    }),
  } as unknown as ElectronApplication;
  const result = firstWindow(app, { timeout: 1234 });
  try {
    await Promise.resolve();
    expect(isReady).toHaveBeenCalledOnce();
    expect(whenReady).not.toHaveBeenCalled();
    await expect(result).resolves.toBe(page);
    expect(app.firstWindow).toHaveBeenCalledWith({ timeout: 1234 });
    const [matchesUrl] = page.waitForURL.mock.calls[0];
    expect(matchesUrl(new URL('about:blank'))).toBe(false);
    expect(matchesUrl(new URL('janet://app/index.html'))).toBe(true);
  } finally {
    publishWindow(page);
    await result;
  }

  const timeout = new Error('first-window deadline');
  vi.mocked(app.firstWindow).mockRejectedValueOnce(timeout);
  vi.mocked(app.evaluate).mockImplementationOnce(() => new Promise(() => {}));
  await expect(firstWindow(app)).rejects.toBe(timeout);
  vi.mocked(app.firstWindow).mockResolvedValueOnce(page as any);
  vi.mocked(app.evaluate).mockImplementationOnce(() => new Promise(() => {}));
  await expect(firstWindow(app)).resolves.toBe(page);
});

it('waits for app document navigation within the original window budget', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  let loaded!: () => void;
  const navigation = new Promise<void>(resolve => { loaded = resolve; });
  const page = { on: vi.fn(), waitForURL: vi.fn(() => navigation) };
  const app = {
    firstWindow: vi.fn(async () => { vi.setSystemTime(200); return page; }),
    evaluate: vi.fn().mockResolvedValue(false),
  } as unknown as ElectronApplication;
  let returned = false;
  const result = firstWindow(app, { timeout: 1000 }).then(value => { returned = true; return value; });
  await vi.advanceTimersByTimeAsync(0);
  expect(page.waitForURL).toHaveBeenCalledWith(expect.any(Function), { waitUntil: 'domcontentloaded', timeout: 800 });
  expect(returned).toBe(false);
  loaded();
  await expect(result).resolves.toBe(page);
});

it('requests normal shutdown with exit observation installed before the request', async () => {
  const child = Object.assign(new EventEmitter(), { exitCode: null as number | null, signalCode: null, kill: vi.fn() });
  const quit = vi.fn(() => {
    expect(child.listenerCount('exit')).toBe(1);
    child.exitCode = 0;
    child.emit('exit', 0);
  });
  const immediateExit = vi.fn(() => { throw new Error('Native PTY cleanup was bypassed'); });
  const app = { process: () => child, evaluate: async (callback: (electron: any) => unknown) => (
    callback({ app: { quit, exit: immediateExit } })
  ) } as unknown as ElectronApplication;
  await forceClose(app);
  expect(quit).toHaveBeenCalledOnce();
  expect(immediateExit).not.toHaveBeenCalled();
  expect(child.kill).not.toHaveBeenCalled();
  expect(child.listenerCount('exit')).toBe(0);
});

it('kills only its child after a stalled debugger exit request and awaits process exit', async () => {
  vi.useFakeTimers();
  const child = Object.assign(new EventEmitter(), { pid: 12345, exitCode: null as number | null, signalCode: null, kill: vi.fn() });
  const exit = () => { child.exitCode = 0; child.emit('exit', 0); };
  child.kill.mockImplementation(exit);
  vi.mocked(execFile).mockImplementation((...args: any[]) => { exit(); args.at(-1)(null); return {} as any; });
  const app = { process: () => child, evaluate: vi.fn(() => {
    expect(child.listenerCount('exit')).toBe(1);
    return new Promise(() => {});
  }) } as unknown as ElectronApplication;
  const close = forceClose(app);
  await vi.advanceTimersByTimeAsync(5000);
  await close;
  if (process.platform === 'win32') expect(execFile).toHaveBeenCalledWith('taskkill', ['/PID', '12345', '/T', '/F'], expect.any(Object), expect.any(Function));
  else expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  expect(child.listenerCount('exit')).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it('does not release the profile while inherited Electron streams remain open after process exit', async () => {
  vi.useFakeTimers();
  const stdout = { closed: false };
  const child = Object.assign(new EventEmitter(), { exitCode: null as number | null, signalCode: null, stdout, stderr: null });
  const app = { process: () => child, evaluate: async () => {
    child.exitCode = 0;
    child.emit('exit', 0);
  } } as unknown as ElectronApplication;
  let finished = false;
  const close = forceClose(app).then(() => { finished = true; });
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(finished).toBe(false);
  } finally {
    stdout.closed = true;
    child.emit('close', 0, null);
    await close;
  }
  expect(finished).toBe(true);
  expect(child.listenerCount('close')).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it('bounds stream cleanup after an already-exited process without targeting that PID again', async () => {
  vi.useFakeTimers();
  const child = Object.assign(new EventEmitter(), { pid: 12345, exitCode: 0, signalCode: null,
    stdout: { closed: false }, stderr: null, kill: vi.fn() });
  const app = { process: () => child, evaluate: vi.fn() } as unknown as ElectronApplication;
  const result = expect(forceClose(app)).rejects.toThrow('streams did not close');
  await vi.advanceTimersByTimeAsync(5000);
  await result;
  expect(app.evaluate).not.toHaveBeenCalled();
  expect(child.kill).not.toHaveBeenCalled();
  expect(child.listenerCount('close')).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});
