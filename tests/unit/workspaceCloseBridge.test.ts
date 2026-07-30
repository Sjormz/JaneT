import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  WORKSPACE_PREPARE_FOR_CLOSE_CHANNEL,
  WORKSPACE_RESOLVE_PREPARE_FOR_CLOSE_CHANNEL,
  WorkspaceClosePreparationCoordinator,
  type WorkspaceCloseRenderer,
  type WorkspacePrepareForCloseRequest,
  type WorkspacePrepareForCloseResolution,
} from '../../src/main/workspaceLifecycle';

class FakeRenderer implements WorkspaceCloseRenderer {
  destroyed = false;
  readonly send = vi.fn<(channel: string, ...args: unknown[]) => void>();
  private readonly unavailableListeners = new Map<
    'destroyed' | 'render-process-gone',
    Set<(...args: unknown[]) => void>
  >();

  isDestroyed(): boolean {
    return this.destroyed;
  }

  once(
    event: 'destroyed' | 'render-process-gone',
    listener: (...args: unknown[]) => void,
  ): this {
    const listeners = this.unavailableListeners.get(event) ?? new Set();
    listeners.add(listener);
    this.unavailableListeners.set(event, listeners);
    return this;
  }

  removeListener(
    event: 'destroyed' | 'render-process-gone',
    listener: (...args: unknown[]) => void,
  ): this {
    this.unavailableListeners.get(event)?.delete(listener);
    return this;
  }

  destroy(): void {
    this.destroyed = true;
    this.emitUnavailable('destroyed');
  }

  emitUnavailable(event: 'destroyed' | 'render-process-gone'): void {
    const listeners = [...(this.unavailableListeners.get(event) ?? [])];
    this.unavailableListeners.delete(event);
    listeners.forEach((listener) => listener());
  }
}

afterEach(() => {
  vi.doUnmock('electron');
  vi.resetModules();
});

describe('WorkspaceClosePreparationCoordinator', () => {
  it.each(['saved', 'discarded'] as const)('accepts a matching %s renderer reply', async (resolution) => {
    const coordinator = new WorkspaceClosePreparationCoordinator();
    const renderer = new FakeRenderer();

    const pending = coordinator.request(renderer, 'window-close');
    expect(renderer.send).toHaveBeenCalledOnce();
    const [channel, request] = renderer.send.mock.calls[0] as [string, WorkspacePrepareForCloseRequest];
    expect(channel).toBe(WORKSPACE_PREPARE_FOR_CLOSE_CHANNEL);
    expect(request).toEqual({
      requestId: 'workspace-close-1',
      reason: 'window-close',
    });

    expect(coordinator.resolve(renderer, { requestId: request.requestId, resolution })).toBe(true);
    await expect(pending).resolves.toBe(resolution);
    expect(coordinator.resolve(renderer, { requestId: request.requestId, resolution })).toBe(false);
  });

  it('coalesces duplicate requests for one renderer', async () => {
    const coordinator = new WorkspaceClosePreparationCoordinator();
    const renderer = new FakeRenderer();

    const first = coordinator.request(renderer, 'window-close');
    const duplicate = coordinator.request(renderer, 'application-quit');
    const request = renderer.send.mock.calls[0][1] as WorkspacePrepareForCloseRequest;

    expect(duplicate).toBe(first);
    expect(renderer.send).toHaveBeenCalledOnce();
    expect(request.reason).toBe('window-close');
    coordinator.resolve(renderer, { requestId: request.requestId, resolution: 'cancel' });
    await expect(Promise.all([first, duplicate])).resolves.toEqual(['cancel', 'cancel']);
  });

  it('rejects wrong-renderer, stale, malformed, and invalid-decision replies', async () => {
    const coordinator = new WorkspaceClosePreparationCoordinator();
    const renderer = new FakeRenderer();
    const otherRenderer = new FakeRenderer();
    const pending = coordinator.request(renderer, 'window-close');
    const request = renderer.send.mock.calls[0][1] as WorkspacePrepareForCloseRequest;

    expect(coordinator.resolve(otherRenderer, { requestId: request.requestId, resolution: 'saved' })).toBe(false);
    expect(coordinator.resolve(renderer, { requestId: 'old-request', resolution: 'saved' })).toBe(false);
    expect(coordinator.resolve(renderer, { requestId: request.requestId, resolution: 'proceed' })).toBe(false);
    expect(coordinator.resolve(renderer, null)).toBe(false);

    expect(coordinator.resolve(renderer, { requestId: request.requestId, resolution: 'cancel' })).toBe(true);
    await expect(pending).resolves.toBe('cancel');
  });

  it('safely cancels when the renderer is already destroyed, becomes destroyed, or cannot receive', async () => {
    const coordinator = new WorkspaceClosePreparationCoordinator();
    const destroyed = new FakeRenderer();
    destroyed.destroyed = true;
    await expect(coordinator.request(destroyed, 'application-quit')).resolves.toBe('cancel');
    expect(destroyed.send).not.toHaveBeenCalled();

    const becomesDestroyed = new FakeRenderer();
    const pending = coordinator.request(becomesDestroyed, 'update-install');
    becomesDestroyed.destroy();
    await expect(pending).resolves.toBe('cancel');

    const processGone = new FakeRenderer();
    const processGonePending = coordinator.request(processGone, 'application-quit');
    processGone.emitUnavailable('render-process-gone');
    await expect(processGonePending).resolves.toBe('cancel');

    const sendFails = new FakeRenderer();
    sendFails.send.mockImplementation(() => {
      throw new Error('renderer unavailable');
    });
    await expect(coordinator.request(sendFails, 'window-close')).resolves.toBe('cancel');
  });

  it('does not attach a second renderer to an in-flight request', async () => {
    const coordinator = new WorkspaceClosePreparationCoordinator();
    const renderer = new FakeRenderer();
    const replacement = new FakeRenderer();
    const pending = coordinator.request(renderer, 'window-close');
    const request = renderer.send.mock.calls[0][1] as WorkspacePrepareForCloseRequest;

    await expect(coordinator.request(replacement, 'application-quit')).resolves.toBe('cancel');
    expect(replacement.send).not.toHaveBeenCalled();

    coordinator.resolve(renderer, { requestId: request.requestId, resolution: 'saved' });
    await expect(pending).resolves.toBe('saved');
  });

  it('cancels a close request when a live renderer never replies', async () => {
    vi.useFakeTimers();
    try {
      const coordinator = new WorkspaceClosePreparationCoordinator(1_000);
      const renderer = new FakeRenderer();
      const pending = coordinator.request(renderer, 'application-quit');

      await vi.advanceTimersByTimeAsync(1_000);

      await expect(pending).resolves.toBe('cancel');
      const request = renderer.send.mock.calls[0][1] as WorkspacePrepareForCloseRequest;
      expect(coordinator.resolve(renderer, { requestId: request.requestId, resolution: 'saved' })).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('preload close-preparation bridge', () => {
  it('exposes a removable request listener and a typed resolution invoke', async () => {
    const listeners = new Map<string, (...args: any[]) => void>();
    const invoke = vi.fn().mockResolvedValue(true);
    const removeListener = vi.fn();
    const on = vi.fn((channel: string, listener: (...args: any[]) => void) => {
      listeners.set(channel, listener);
    });
    const exposeInMainWorld = vi.fn();
    vi.doMock('electron', () => ({
      contextBridge: { exposeInMainWorld },
      ipcRenderer: {
        invoke,
        on,
        removeListener,
      },
    }));

    await import('../../src/main/preload');
    const api = exposeInMainWorld.mock.calls[0]?.[1] as {
      onPrepareForClose(callback: (request: WorkspacePrepareForCloseRequest) => void | Promise<void>): () => void;
      resolvePrepareForClose(resolution: WorkspacePrepareForCloseResolution): Promise<boolean>;
      onTerminalData(callback: (event: { id: string; data: string }) => void): () => void;
      onTerminalExit(callback: (event: { id: string; exitCode: number; signal: number }) => void): () => void;
    };
    const callback = vi.fn();
    const unsubscribe = api.onPrepareForClose(callback);
    const request: WorkspacePrepareForCloseRequest = {
      requestId: 'workspace-close-42',
      reason: 'update-install',
    };

    listeners.get(WORKSPACE_PREPARE_FOR_CLOSE_CHANNEL)?.({}, request);
    expect(callback).toHaveBeenCalledWith(request);

    const resolution: WorkspacePrepareForCloseResolution = {
      requestId: request.requestId,
      resolution: 'discarded',
    };
    await expect(api.resolvePrepareForClose(resolution)).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledWith(WORKSPACE_RESOLVE_PREPARE_FOR_CLOSE_CHANNEL, resolution);

    unsubscribe();
    const unattendedRequest: WorkspacePrepareForCloseRequest = {
      requestId: 'workspace-close-43',
      reason: 'application-quit',
    };
    listeners.get(WORKSPACE_PREPARE_FOR_CLOSE_CHANNEL)?.({}, unattendedRequest);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith(
      WORKSPACE_RESOLVE_PREPARE_FOR_CLOSE_CHANNEL,
      { requestId: unattendedRequest.requestId, resolution: 'cancel' },
    ));
    expect(removeListener).not.toHaveBeenCalled();

    const terminalCallbacks = Array.from({ length: 20 }, () => vi.fn());
    const unsubscribeTerminal = terminalCallbacks.map((terminalCallback) => api.onTerminalData(terminalCallback));
    expect(on.mock.calls.filter(([channel]) => channel === 'terminal:onData')).toHaveLength(1);
    listeners.get('terminal:onData')?.({}, { id: 'term-1', data: 'output' });
    for (const terminalCallback of terminalCallbacks) {
      expect(terminalCallback).toHaveBeenCalledWith({ id: 'term-1', data: 'output' });
    }
    unsubscribeTerminal.forEach((unsubscribe) => unsubscribe());
    listeners.get('terminal:onData')?.({}, { id: 'term-1', data: 'late' });
    for (const terminalCallback of terminalCallbacks) expect(terminalCallback).toHaveBeenCalledOnce();

    const exitCallbacks = Array.from({ length: 20 }, () => vi.fn());
    const unsubscribeExit = exitCallbacks.map((exitCallback) => api.onTerminalExit(exitCallback));
    expect(on.mock.calls.filter(([channel]) => channel === 'terminal:onExit')).toHaveLength(1);
    listeners.get('terminal:onExit')?.({}, { id: 'term-1', exitCode: 17, signal: 9 });
    for (const exitCallback of exitCallbacks) {
      expect(exitCallback).toHaveBeenCalledWith({ id: 'term-1', exitCode: 17, signal: 9 });
    }
    unsubscribeExit.forEach((unsubscribe) => unsubscribe());
    listeners.get('terminal:onExit')?.({}, { id: 'term-1', exitCode: 0, signal: 0 });
    for (const exitCallback of exitCallbacks) expect(exitCallback).toHaveBeenCalledOnce();
  });
});
