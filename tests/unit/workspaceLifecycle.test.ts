import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  WorkspaceLifecycleController,
  type WorkspaceLifecycleDependencies,
} from '../../src/main/workspaceLifecycle';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function makeHarness() {
  const requestClosePreparation = vi.fn<WorkspaceLifecycleDependencies['requestClosePreparation']>()
    .mockResolvedValue('saved');
  const stopAll = vi.fn<WorkspaceLifecycleDependencies['stopAll']>().mockResolvedValue(undefined);
  const quit = vi.fn<WorkspaceLifecycleDependencies['quit']>();
  const controller = new WorkspaceLifecycleController({ requestClosePreparation, stopAll, quit });

  return { controller, requestClosePreparation, stopAll, quit };
}

describe('WorkspaceLifecycleController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stops managed resources and quits when the window closes', async () => {
    const harness = makeHarness();

    await harness.controller.handleClose();

    expect(harness.requestClosePreparation).toHaveBeenCalledWith('window-close');
    expect(harness.stopAll).toHaveBeenCalledOnce();
    expect(harness.quit).toHaveBeenCalledOnce();
  });

  it('uses the application-quit preparation reason for an application quit', async () => {
    const harness = makeHarness();

    await harness.controller.handleQuit();

    expect(harness.requestClosePreparation).toHaveBeenCalledWith('application-quit');
    expect(harness.stopAll).toHaveBeenCalledOnce();
    expect(harness.quit).toHaveBeenCalledOnce();
  });

  it('waits for editor preparation and resource shutdown before quitting', async () => {
    const harness = makeHarness();
    const preparation = deferred<'saved'>();
    const cleanup = deferred<void>();
    const events: string[] = [];
    harness.requestClosePreparation.mockImplementation(async () => {
      events.push('prepare:start');
      const result = await preparation.promise;
      events.push('prepare:done');
      return result;
    });
    harness.stopAll.mockImplementation(async () => {
      events.push('stop:start');
      await cleanup.promise;
      events.push('stop:done');
    });
    harness.quit.mockImplementation(() => events.push('quit'));

    const closing = harness.controller.handleClose();
    await vi.waitFor(() => expect(harness.requestClosePreparation).toHaveBeenCalledOnce());
    expect(harness.stopAll).not.toHaveBeenCalled();

    preparation.resolve('saved');
    await vi.waitFor(() => expect(harness.stopAll).toHaveBeenCalledOnce());
    expect(harness.quit).not.toHaveBeenCalled();

    cleanup.resolve();
    await closing;
    expect(events).toEqual(['prepare:start', 'prepare:done', 'stop:start', 'stop:done', 'quit']);
  });

  it('does not stop resources or quit when dirty-editor resolution is cancelled', async () => {
    const harness = makeHarness();
    harness.requestClosePreparation.mockResolvedValue('cancel');

    await harness.controller.handleClose();

    expect(harness.stopAll).not.toHaveBeenCalled();
    expect(harness.quit).not.toHaveBeenCalled();
  });

  it.each(['saved', 'discarded'] as const)('proceeds after the renderer resolves %s', async (resolution) => {
    const harness = makeHarness();
    harness.requestClosePreparation.mockResolvedValue(resolution);

    await harness.controller.handleClose();

    expect(harness.stopAll).toHaveBeenCalledOnce();
    expect(harness.quit).toHaveBeenCalledOnce();
  });

  it('coalesces duplicate close and quit requests', async () => {
    const harness = makeHarness();
    const preparation = deferred<'saved'>();
    harness.requestClosePreparation.mockReturnValue(preparation.promise);

    const close = harness.controller.handleClose();
    const duplicateClose = harness.controller.handleClose();
    const quit = harness.controller.handleQuit();
    expect(harness.requestClosePreparation).toHaveBeenCalledOnce();

    preparation.resolve('saved');
    await Promise.all([close, duplicateClose, quit]);

    expect(harness.stopAll).toHaveBeenCalledOnce();
    expect(harness.quit).toHaveBeenCalledOnce();
  });

  it('exposes the update-install preparation gate without stopping resources itself', async () => {
    const harness = makeHarness();
    harness.requestClosePreparation.mockResolvedValue('discarded');

    await expect(harness.controller.prepareForClose('update-install')).resolves.toBe(true);

    expect(harness.requestClosePreparation).toHaveBeenCalledWith('update-install');
    expect(harness.stopAll).not.toHaveBeenCalled();
    expect(harness.quit).not.toHaveBeenCalled();
  });

  it('reports a cancelled update-install preparation gate', async () => {
    const harness = makeHarness();
    harness.requestClosePreparation.mockResolvedValue('cancel');

    await expect(harness.controller.prepareForClose('update-install')).resolves.toBe(false);

    expect(harness.stopAll).not.toHaveBeenCalled();
    expect(harness.quit).not.toHaveBeenCalled();
  });
});
