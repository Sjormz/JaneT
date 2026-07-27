import { describe, expect, it, vi } from 'vitest';
import { sendRendererEvent } from '../../src/main/rendererEvents';

describe('sendRendererEvent', () => {
  it('drops output when a window is unavailable or destroyed during send', () => {
    const send = vi.fn();
    const liveWindow = {
      isDestroyed: () => false,
      webContents: { isDestroyed: () => false, send },
    };

    expect(sendRendererEvent(null, 'terminal:onData', { id: 'term', data: 'ignored' })).toBe(false);
    expect(sendRendererEvent({
      ...liveWindow,
      webContents: { isDestroyed: () => true, send },
    }, 'terminal:onData', { id: 'term', data: 'ignored' })).toBe(false);
    send.mockImplementationOnce(() => { throw new Error('Object has been destroyed'); });
    expect(sendRendererEvent(liveWindow, 'terminal:onData', { id: 'term', data: 'late' })).toBe(false);
    expect(() => sendRendererEvent(liveWindow, 'terminal:onData', { id: 'term', data: 'ok' })).not.toThrow();
    expect(send).toHaveBeenLastCalledWith('terminal:onData', { id: 'term', data: 'ok' });
  });
});
