import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RefreshCoordinator,
  type RefreshReason,
  useRefreshTask,
} from '../../src/renderer/refreshCoordinator';

const coordinators: RefreshCoordinator[] = [];
let visibilityState: DocumentVisibilityState;

function coordinator(resolutionMs = 10): RefreshCoordinator {
  const instance = new RefreshCoordinator(resolutionMs);
  coordinators.push(instance);
  return instance;
}

async function flushRuns(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  visibilityState = 'visible';
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibilityState);
});

afterEach(() => {
  for (const instance of coordinators.splice(0)) instance.dispose();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('RefreshCoordinator', () => {
  it('runs on registration and observes each task interval from one base timer', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const refresh = coordinator(10);
    const fast = vi.fn();
    const slow = vi.fn();

    refresh.register('fast', 20, fast);
    refresh.register('slow', 50, slow);
    expect(fast).toHaveBeenCalledWith('register');
    expect(slow).toHaveBeenCalledWith('register');
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    await flushRuns();

    await vi.advanceTimersByTimeAsync(20);
    expect(fast).toHaveBeenLastCalledWith('heartbeat');
    expect(fast).toHaveBeenCalledTimes(2);
    expect(slow).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30);
    expect(fast).toHaveBeenCalledTimes(3);
    expect(slow).toHaveBeenLastCalledWith('heartbeat');
    expect(slow).toHaveBeenCalledTimes(2);
  });

  it('allows only one run at a time and coalesces invalidations into one follow-up', async () => {
    const refresh = coordinator();
    let resolveInitial!: () => void;
    const initial = new Promise<void>((resolve) => {
      resolveInitial = resolve;
    });
    const run = vi.fn((reason: RefreshReason) => reason === 'register' ? initial : undefined);

    refresh.register('git', 60_000, run);
    refresh.invalidate('heartbeat', 'git');
    refresh.invalidate('manual', 'git');
    refresh.invalidate('mutation', 'git');
    expect(run).toHaveBeenCalledTimes(1);

    resolveInitial();
    await flushRuns();
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenLastCalledWith('mutation');
  });

  it('does not turn a slow periodic task into a continuous catch-up loop', async () => {
    const refresh = coordinator(10);
    let resolveInitial!: () => void;
    const initial = new Promise<void>((resolve) => { resolveInitial = resolve; });
    const run = vi.fn(() => initial);

    refresh.register('slow', 20, run);
    await vi.advanceTimersByTimeAsync(100);
    expect(run).toHaveBeenCalledTimes(1);

    resolveInitial();
    await flushRuns();
    await vi.advanceTimersByTimeAsync(19);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('pauses background work while blurred or hidden, then refreshes immediately on resume', async () => {
    const refresh = coordinator(10);
    const run = vi.fn();
    refresh.register('git', 20, run);
    await flushRuns();

    window.dispatchEvent(new Event('blur'));
    await vi.advanceTimersByTimeAsync(100);
    refresh.invalidate('prompt');
    refresh.invalidate('mutation');
    expect(run).toHaveBeenCalledTimes(1);

    refresh.invalidate('manual');
    await flushRuns();
    expect(run).toHaveBeenLastCalledWith('manual');

    window.dispatchEvent(new Event('focus'));
    await flushRuns();
    expect(run).toHaveBeenLastCalledWith('focus');

    visibilityState = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(100);
    expect(run).toHaveBeenCalledTimes(3);

    visibilityState = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await flushRuns();
    expect(run).toHaveBeenCalledTimes(4);
    expect(run).toHaveBeenLastCalledWith('visibility');
  });

  it('isolates thrown and rejected runners without stopping other tasks', async () => {
    const refresh = coordinator();
    const throws = vi.fn(() => {
      throw new Error('sync failure');
    });
    const rejects = vi.fn(() => Promise.reject(new Error('async failure')));
    const healthy = vi.fn();

    refresh.register('throws', 1_000, throws);
    refresh.register('rejects', 1_000, rejects);
    refresh.register('healthy', 1_000, healthy);
    await flushRuns();

    expect(() => refresh.invalidate('manual')).not.toThrow();
    await flushRuns();
    expect(throws).toHaveBeenCalledTimes(2);
    expect(rejects).toHaveBeenCalledTimes(2);
    expect(healthy).toHaveBeenCalledTimes(2);
  });

  it('makes registration cleanup idempotent and removes shared infrastructure with the last task', async () => {
    const removeWindowListener = vi.spyOn(window, 'removeEventListener');
    const removeDocumentListener = vi.spyOn(document, 'removeEventListener');
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const refresh = coordinator();
    const run = vi.fn();

    const firstCleanup = refresh.register('git', 100, run);
    const duplicateCleanup = refresh.register('git', 100, run);
    await flushRuns();
    expect(run).toHaveBeenCalledTimes(1);

    firstCleanup();
    firstCleanup();
    duplicateCleanup();
    refresh.unregister('git');

    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    expect(removeWindowListener).toHaveBeenCalledWith('focus', expect.any(Function));
    expect(removeWindowListener).toHaveBeenCalledWith('blur', expect.any(Function));
    expect(removeDocumentListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });

  it('does not let cleanup from a replaced registration remove the current task', async () => {
    const refresh = coordinator();
    const oldRun = vi.fn();
    const currentRun = vi.fn();
    const oldCleanup = refresh.register('git', 100, oldRun);
    const currentCleanup = refresh.register('git', 100, currentRun);
    await flushRuns();

    oldCleanup();
    refresh.invalidate('manual', 'git');
    await flushRuns();
    expect(currentRun).toHaveBeenCalledTimes(2);
    expect(currentRun).toHaveBeenLastCalledWith('manual');

    currentCleanup();
    refresh.invalidate('manual', 'git');
    expect(currentRun).toHaveBeenCalledTimes(2);
  });
});

describe('useRefreshTask', () => {
  it('tracks the latest runner and unregisters when disabled or unmounted', async () => {
    const refresh = coordinator();
    const firstRun = vi.fn();
    const latestRun = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ enabled, run }: { enabled: boolean; run: (reason: RefreshReason) => void }) => {
        useRefreshTask({ key: 'git', intervalMs: 100, enabled, run }, refresh);
      },
      { initialProps: { enabled: true, run: firstRun } },
    );
    await flushRuns();
    expect(firstRun).toHaveBeenCalledWith('register');

    rerender({ enabled: true, run: latestRun });
    act(() => refresh.invalidate('manual', 'git'));
    await flushRuns();
    expect(latestRun).toHaveBeenCalledWith('manual');
    expect(firstRun).toHaveBeenCalledTimes(1);

    rerender({ enabled: false, run: latestRun });
    act(() => refresh.invalidate('manual', 'git'));
    expect(latestRun).toHaveBeenCalledTimes(1);

    unmount();
  });
});
