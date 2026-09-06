import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useSettingsPersistence } from '../../src/renderer/useSettingsPersistence';

describe('settings persistence', () => {
  it('retains failed drafts and retries the newest values, not stale ones', async () => {
    const setSettings = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue({});
    Object.defineProperty(window, 'janet', { configurable: true, value: { setSettings } });
    const { result } = renderHook(useSettingsPersistence);
    await act(() => result.current.persist({ snippets: ['draft'], theme: 'old' }));
    expect(result.current.error).toBe(true);
    await act(() => result.current.persist({ theme: 'new' }));
    expect(setSettings).toHaveBeenLastCalledWith({ snippets: ['draft'], theme: 'new' });
    expect(result.current.error).toBe(false);
    await act(() => result.current.retry());
    expect(setSettings).toHaveBeenCalledTimes(2);
  });

  it('serializes in-flight updates and exposes retry after synchronous failures', async () => {
    let finish!: () => void;
    const setSettings = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }))
      .mockImplementationOnce(() => { throw new Error('bridge unavailable'); }).mockResolvedValue({});
    Object.defineProperty(window, 'janet', { configurable: true, value: { setSettings } });
    const { result } = renderHook(useSettingsPersistence);
    act(() => { void result.current.persist({ theme: 'old' }); });
    await waitFor(() => expect(setSettings).toHaveBeenCalledTimes(1));
    act(() => { void result.current.persist({ theme: 'new' }); });
    await act(async () => { finish(); });
    await waitFor(() => expect(result.current.error).toBe(true));
    await act(() => result.current.retry());
    expect(setSettings).toHaveBeenLastCalledWith({ theme: 'new' });
    expect(result.current.error).toBe(false);
  });
});
