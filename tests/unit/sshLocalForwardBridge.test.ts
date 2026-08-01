import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.doUnmock('electron');
  vi.resetModules();
});

describe('preload SSH local-forward bridge', () => {
  it('invokes the three exact channels and payloads', async () => {
    const invoke = vi.fn().mockResolvedValue([]);
    const exposeInMainWorld = vi.fn();
    vi.doMock('electron', () => ({
      contextBridge: { exposeInMainWorld },
      ipcRenderer: { invoke, sendSync: vi.fn(), on: vi.fn(), removeListener: vi.fn(), send: vi.fn() },
    }));
    await import('../../src/main/preload');
    const api = exposeInMainWorld.mock.calls[0][1];
    const request = { id: 'forward-1', localPort: 0, destinationHost: '127.0.0.1', destinationPort: 9000 };

    await api.sshStartLocalForward({ sessionId: 'ssh-1', request });
    await api.sshStopLocalForward({ sessionId: 'ssh-1', id: 'forward-1' });
    await api.sshListLocalForwards({ sessionId: 'ssh-1' });

    expect(invoke.mock.calls).toEqual([
      ['ssh:startLocalForward', { sessionId: 'ssh-1', request }],
      ['ssh:stopLocalForward', { sessionId: 'ssh-1', id: 'forward-1' }],
      ['ssh:listLocalForwards', { sessionId: 'ssh-1' }],
    ]);
  });
});

describe('main SSH local-forward bridge', () => {
  it('passes the untouched nested request to the manager', async () => {
    const { registerSSHLocalForwardHandlers } = await import('../../src/main/sshLocalForwardIpc');
    const listeners = new Map<string, Function>();
    const manager = {
      startLocalForward: vi.fn().mockResolvedValue({ status: 'running' }),
      stopLocalForward: vi.fn().mockResolvedValue(true),
      listLocalForwards: vi.fn().mockReturnValue([]),
    };
    registerSSHLocalForwardHandlers((channel, listener) => listeners.set(channel, listener), manager);
    const request = { id: 'forward-1', localPort: 0, destinationHost: 'host', destinationPort: 80 };

    await listeners.get('ssh:startLocalForward')!({}, { sessionId: 'ssh-1', request });

    expect(manager.startLocalForward).toHaveBeenCalledWith('ssh-1', request);
    expect(manager.startLocalForward.mock.calls[0][1]).toBe(request);
  });

  it.each([
    null,
    { sessionId: 'ssh-1' },
    { sessionId: 'ssh-1', request: {}, extra: true },
    Object.assign(Object.create({}), { sessionId: 'ssh-1', request: {} }),
    Object.defineProperty({ request: {} }, 'sessionId', { get: () => 'ssh-1', enumerable: true }),
    { sessionId: 'bad\n', request: {} },
  ])('rejects malformed start envelopes before manager access', async (payload) => {
    const { registerSSHLocalForwardHandlers } = await import('../../src/main/sshLocalForwardIpc');
    const listeners = new Map<string, Function>();
    const manager = { startLocalForward: vi.fn(), stopLocalForward: vi.fn(), listLocalForwards: vi.fn() };
    registerSSHLocalForwardHandlers((channel, listener) => listeners.set(channel, listener), manager);

    expect(() => listeners.get('ssh:startLocalForward')!({}, payload)).toThrow(/Invalid SSH local-forward/);
    expect(manager.startLocalForward).not.toHaveBeenCalled();
  });

  it.each([
    ['ssh:stopLocalForward', { sessionId: 'ssh-1' }, 'stopLocalForward'],
    ['ssh:stopLocalForward', { sessionId: 'ssh-1', id: 'bad\n' }, 'stopLocalForward'],
    ['ssh:listLocalForwards', { sessionId: 'ssh-1', extra: true }, 'listLocalForwards'],
    ['ssh:listLocalForwards', { sessionId: '' }, 'listLocalForwards'],
  ])('rejects malformed %s envelopes before manager access', async (channel, payload, method) => {
    const { registerSSHLocalForwardHandlers } = await import('../../src/main/sshLocalForwardIpc');
    const listeners = new Map<string, Function>();
    const manager = { startLocalForward: vi.fn(), stopLocalForward: vi.fn(), listLocalForwards: vi.fn() };
    registerSSHLocalForwardHandlers((registeredChannel, listener) => listeners.set(registeredChannel, listener), manager);

    expect(() => listeners.get(channel)!({}, payload)).toThrow(/Invalid SSH local-forward/);
    expect(manager[method as 'stopLocalForward' | 'listLocalForwards']).not.toHaveBeenCalled();
  });
});
