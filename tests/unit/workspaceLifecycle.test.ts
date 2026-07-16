import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  WorkspaceLifecycleController,
  type WorkspaceActivity,
  type WorkspaceClosePrompt,
  type WorkspaceLifecycleDependencies,
  type WorkspaceWindow,
} from '../../src/main/workspaceLifecycle';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function makeWindow() {
  return {
    close: vi.fn<WorkspaceWindow['close']>(),
    hide: vi.fn<WorkspaceWindow['hide']>(),
    show: vi.fn<WorkspaceWindow['show']>(),
    focus: vi.fn<WorkspaceWindow['focus']>(),
    isDestroyed: vi.fn<WorkspaceWindow['isDestroyed']>(() => false),
  } satisfies WorkspaceWindow;
}

function makeHarness(activity: WorkspaceActivity = { localTerminals: 1, sshSessions: 0 }) {
  const chooseDecision = vi.fn<WorkspaceLifecycleDependencies['chooseDecision']>()
    .mockResolvedValue('cancel');
  const getActivity = vi.fn<WorkspaceLifecycleDependencies['getActivity']>(() => activity);
  const requestClosePreparation = vi.fn<WorkspaceLifecycleDependencies['requestClosePreparation']>()
    .mockResolvedValue('saved');
  const stopAll = vi.fn<WorkspaceLifecycleDependencies['stopAll']>().mockResolvedValue(undefined);
  const quit = vi.fn<WorkspaceLifecycleDependencies['quit']>();
  const onBackgroundChange = vi.fn<WorkspaceLifecycleDependencies['onBackgroundChange']>(() => true);

  const controller = new WorkspaceLifecycleController({
    getActivity,
    chooseDecision,
    requestClosePreparation,
    stopAll,
    quit,
    onBackgroundChange,
  });

  return {
    controller,
    window: makeWindow(),
    getActivity,
    chooseDecision,
    requestClosePreparation,
    stopAll,
    quit,
    onBackgroundChange,
  };
}

describe('WorkspaceLifecycleController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('closes immediately without prompting when no work is running', async () => {
    const harness = makeHarness({ localTerminals: 0, sshSessions: 0 });

    await harness.controller.handleClose(harness.window);

    expect(harness.chooseDecision).not.toHaveBeenCalled();
    expect(harness.stopAll).not.toHaveBeenCalled();
    expect(harness.quit).not.toHaveBeenCalled();
    expect(harness.requestClosePreparation).toHaveBeenCalledWith('window-close');
    expect(harness.window.close).toHaveBeenCalledOnce();
  });

  it('quits the application instead of only closing its window for an idle quit request', async () => {
    const harness = makeHarness({ localTerminals: 0, sshSessions: 0 });

    await harness.controller.handleQuit(harness.window);

    expect(harness.window.close).not.toHaveBeenCalled();
    expect(harness.requestClosePreparation).toHaveBeenCalledWith('application-quit');
    expect(harness.quit).toHaveBeenCalledOnce();
  });

  it('hides the window and preserves running work when backgrounding is chosen', async () => {
    const harness = makeHarness({
      localTerminals: 2,
      sshSessions: 1,
      localDetails: ['node + 1 related process'],
      sshDetails: ['dev@example.com:22'],
    });
    harness.chooseDecision.mockResolvedValue('background');

    await harness.controller.handleClose(harness.window);

    expect(harness.window.hide).toHaveBeenCalledOnce();
    expect(harness.onBackgroundChange).toHaveBeenCalledWith(true);
    expect(harness.stopAll).not.toHaveBeenCalled();
    expect(harness.quit).not.toHaveBeenCalled();
    expect(harness.window.close).not.toHaveBeenCalled();
    expect(harness.requestClosePreparation).not.toHaveBeenCalled();
  });

  it('keeps the window visible when no reliable background reopen path is available', async () => {
    const harness = makeHarness();
    harness.chooseDecision.mockResolvedValue('background');
    harness.onBackgroundChange.mockReturnValue(false);

    await harness.controller.handleClose(harness.window);

    expect(harness.window.hide).not.toHaveBeenCalled();
    expect(harness.window.show).toHaveBeenCalledOnce();
    expect(harness.window.focus).toHaveBeenCalledOnce();
    expect(harness.quit).not.toHaveBeenCalled();
    expect(harness.requestClosePreparation).not.toHaveBeenCalled();
  });

  it('does not request editor resolution when an application quit is converted to backgrounding', async () => {
    const harness = makeHarness();
    harness.chooseDecision.mockResolvedValue('background');

    await harness.controller.handleQuit(harness.window);

    expect(harness.window.hide).toHaveBeenCalledOnce();
    expect(harness.requestClosePreparation).not.toHaveBeenCalled();
    expect(harness.stopAll).not.toHaveBeenCalled();
    expect(harness.quit).not.toHaveBeenCalled();
  });

  it('waits for all work to stop before quitting', async () => {
    const harness = makeHarness();
    const cleanup = deferred<void>();
    const events: string[] = [];
    harness.chooseDecision.mockResolvedValue('stop');
    harness.stopAll.mockImplementation(async () => {
      events.push('stop:start');
      await cleanup.promise;
      events.push('stop:done');
    });
    harness.quit.mockImplementation(() => {
      events.push('quit');
    });

    const closing = harness.controller.handleClose(harness.window);
    await vi.waitFor(() => expect(harness.stopAll).toHaveBeenCalledOnce());

    expect(harness.quit).not.toHaveBeenCalled();
    cleanup.resolve();
    await closing;

    expect(events).toEqual(['stop:start', 'stop:done', 'quit']);
    expect(harness.requestClosePreparation).toHaveBeenCalledWith('window-close');
    expect(harness.quit).toHaveBeenCalledOnce();
  });

  it('leaves the visible workspace untouched when close is cancelled', async () => {
    const harness = makeHarness();
    harness.chooseDecision.mockResolvedValue('cancel');

    await harness.controller.handleClose(harness.window);

    expect(harness.window.hide).not.toHaveBeenCalled();
    expect(harness.window.close).not.toHaveBeenCalled();
    expect(harness.stopAll).not.toHaveBeenCalled();
    expect(harness.quit).not.toHaveBeenCalled();
    expect(harness.onBackgroundChange).not.toHaveBeenCalled();
    expect(harness.requestClosePreparation).not.toHaveBeenCalled();
  });

  it('coalesces duplicate close requests while one decision is pending', async () => {
    const harness = makeHarness();
    const decision = deferred<'background'>();
    harness.chooseDecision.mockReturnValue(decision.promise);

    const firstClose = harness.controller.handleClose(harness.window);
    const duplicateClose = harness.controller.handleClose(harness.window);

    expect(harness.chooseDecision).toHaveBeenCalledOnce();
    decision.resolve('background');
    await Promise.all([firstClose, duplicateClose]);

    expect(harness.window.hide).toHaveBeenCalledOnce();
    expect(harness.onBackgroundChange).toHaveBeenCalledTimes(1);
    expect(harness.requestClosePreparation).not.toHaveBeenCalled();
  });

  it('upgrades a pending window close when an application quit arrives', async () => {
    const harness = makeHarness();
    const activity = deferred<WorkspaceActivity>();
    harness.getActivity.mockReturnValue(activity.promise);

    const close = harness.controller.handleClose(harness.window);
    const quit = harness.controller.handleQuit(harness.window);
    activity.resolve({ localTerminals: 0, sshSessions: 0 });
    await Promise.all([close, quit]);

    expect(harness.window.close).not.toHaveBeenCalled();
    expect(harness.requestClosePreparation).toHaveBeenCalledWith('application-quit');
    expect(harness.quit).toHaveBeenCalledOnce();
  });

  it('shows and focuses a hidden workspace', async () => {
    const harness = makeHarness();
    harness.chooseDecision.mockResolvedValue('background');
    await harness.controller.handleClose(harness.window);

    harness.controller.show(harness.window);

    expect(harness.window.show).toHaveBeenCalledOnce();
    expect(harness.window.focus).toHaveBeenCalledOnce();
    expect(harness.onBackgroundChange).toHaveBeenLastCalledWith(false);
  });

  it('describes active work and presents semantic close actions', async () => {
    const harness = makeHarness({
      localTerminals: 2,
      sshSessions: 1,
      localDetails: ['node + 1 related process'],
      sshDetails: ['dev@example.com:22'],
    });
    let prompt: WorkspaceClosePrompt | undefined;
    harness.chooseDecision.mockImplementation(async (value) => {
      prompt = value;
      return 'cancel';
    });

    await harness.controller.handleClose(harness.window);

    expect(prompt).toEqual(expect.objectContaining({
      title: 'Keep JaneT running?',
      defaultDecision: 'background',
      cancelDecision: 'cancel',
      actions: [
        { decision: 'background', label: 'Keep running in background' },
        { decision: 'stop', label: 'Stop all and quit' },
        { decision: 'cancel', label: 'Cancel' },
      ],
    }));
    expect(prompt?.message).toMatch(/terminals or SSH connections are still active/i);
    expect(prompt?.detail).toMatch(/2 terminals with active work/i);
    expect(prompt?.detail).toMatch(/1 SSH connection/i);
    expect(prompt?.detail).toMatch(/node \+ 1 related process/i);
    expect(prompt?.detail).toMatch(/dev@example\.com:22/i);
  });

  it('can explicitly stop background work and quit from the tray', async () => {
    const harness = makeHarness();
    const events: string[] = [];
    harness.stopAll.mockImplementation(async () => {
      events.push('stop');
    });
    harness.quit.mockImplementation(() => {
      events.push('quit');
    });

    await harness.controller.stopFromTray();

    expect(events).toEqual(['stop', 'quit']);
    expect(harness.onBackgroundChange).toHaveBeenCalledWith(false);
    expect(harness.chooseDecision).not.toHaveBeenCalled();
    expect(harness.requestClosePreparation).toHaveBeenCalledWith('tray-stop');
  });

  it.each(['saved', 'discarded'] as const)('proceeds after the renderer resolves %s', async (resolution) => {
    const harness = makeHarness({ localTerminals: 0, sshSessions: 0 });
    harness.requestClosePreparation.mockResolvedValue(resolution);

    await harness.controller.handleClose(harness.window);

    expect(harness.window.close).toHaveBeenCalledOnce();
  });

  it('does not close, stop, or quit when dirty editor resolution is cancelled', async () => {
    const harness = makeHarness({ localTerminals: 0, sshSessions: 0 });
    harness.requestClosePreparation.mockResolvedValue('cancel');

    await harness.controller.handleClose(harness.window);

    expect(harness.window.close).not.toHaveBeenCalled();
    expect(harness.stopAll).not.toHaveBeenCalled();
    expect(harness.quit).not.toHaveBeenCalled();
  });

  it('does not stop active work when renderer close preparation is cancelled', async () => {
    const harness = makeHarness();
    harness.chooseDecision.mockResolvedValue('stop');
    harness.requestClosePreparation.mockResolvedValue('cancel');

    await harness.controller.handleClose(harness.window);

    expect(harness.stopAll).not.toHaveBeenCalled();
    expect(harness.quit).not.toHaveBeenCalled();
  });

  it('waits for renderer close preparation before stopping active work', async () => {
    const harness = makeHarness();
    const preparation = deferred<'saved'>();
    harness.chooseDecision.mockResolvedValue('stop');
    harness.requestClosePreparation.mockReturnValue(preparation.promise);

    const closing = harness.controller.handleClose(harness.window);
    await vi.waitFor(() => expect(harness.requestClosePreparation).toHaveBeenCalledOnce());
    expect(harness.stopAll).not.toHaveBeenCalled();

    preparation.resolve('saved');
    await closing;
    expect(harness.stopAll).toHaveBeenCalledOnce();
    expect(harness.quit).toHaveBeenCalledOnce();
  });

  it('does not stop or quit from the tray when editor resolution is cancelled', async () => {
    const harness = makeHarness();
    harness.requestClosePreparation.mockResolvedValue('cancel');

    await harness.controller.stopFromTray();

    expect(harness.stopAll).not.toHaveBeenCalled();
    expect(harness.quit).not.toHaveBeenCalled();
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

describe('tray stop confirmation', () => {
  it('uses Cancel as the safe default and only stops after explicit confirmation', async () => {
    const showMessageBox = vi.fn()
      .mockResolvedValueOnce({ response: 0 })
      .mockResolvedValueOnce({ response: 1 });
    vi.doMock('electron', () => ({
      app: {
        commandLine: { appendSwitch: vi.fn() },
        requestSingleInstanceLock: vi.fn(() => false),
        quit: vi.fn(),
        on: vi.fn(),
        whenReady: vi.fn(() => Promise.resolve()),
        setPath: vi.fn(),
      },
      protocol: {
        registerSchemesAsPrivileged: vi.fn(),
      },
      dialog: {
        showMessageBox,
        showErrorBox: vi.fn(),
      },
      shell: { openExternal: vi.fn() },
    }));
    vi.resetModules();

    const { backgroundTrayMenuTemplate, confirmStopAllFromTray } = await import('../../src/main/index');
    const stopAllAndQuit = vi.fn().mockResolvedValue(undefined);

    await expect(confirmStopAllFromTray(stopAllAndQuit)).resolves.toBe(false);
    expect(stopAllAndQuit).not.toHaveBeenCalled();
    expect(showMessageBox).toHaveBeenLastCalledWith(expect.objectContaining({
      buttons: ['Cancel', 'Stop all and quit'],
      defaultId: 0,
      cancelId: 0,
    }));

    await expect(confirmStopAllFromTray(stopAllAndQuit)).resolves.toBe(true);
    expect(stopAllAndQuit).toHaveBeenCalledOnce();

    const confirmFromMenu = vi.fn().mockResolvedValue(false);
    const template = backgroundTrayMenuTemplate(vi.fn(), confirmFromMenu);
    const stopItem = template.find((item) => item.label === 'Stop all and quit');
    expect(stopItem?.click).toBeTypeOf('function');
    stopItem?.click?.();
    await vi.waitFor(() => expect(confirmFromMenu).toHaveBeenCalledOnce());

    vi.doUnmock('electron');
  });
});
