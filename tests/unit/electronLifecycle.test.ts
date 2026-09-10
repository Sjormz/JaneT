// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import type { ElectronApplication } from '@playwright/test';
import { forceClose } from '../e2e/electronLifecycle';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });

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
