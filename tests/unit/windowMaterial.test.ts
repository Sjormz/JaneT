import { describe, expect, it, vi } from 'vitest';
import { resolveWindowMaterial, supportsMica, windowMaterialOptions } from '../../src/main/windowMaterial';

const resolve = (platform: string, preference: 'system' | 'reduced' | 'off', systemReducesTransparency = false, osRelease = '24.0.0') =>
  resolveWindowMaterial({ platform, osRelease, preference, systemReducesTransparency });

describe('window material', () => {
  it('uses vibrancy on macOS and Mica on Windows 11 22H2+ only for full glass', () => {
    expect(resolve('darwin', 'system')).toMatchObject({ effective: 'full', material: 'vibrancy' });
    expect(resolve('win32', 'system', false, '10.0.22631')).toMatchObject({ effective: 'full', material: 'mica' });
    expect(resolve('win32', 'system', false, '10.0.22000')).toMatchObject({ effective: 'full', material: 'none' });
    expect(resolve('win32', 'system', false, '10.0.19045')).toMatchObject({ material: 'none' });
    expect(resolve('linux', 'system', false, '6.8.0')).toMatchObject({ effective: 'full', material: 'none' });
  });

  it('follows the OS Reduce transparency setting only under System', () => {
    expect(resolve('darwin', 'system', true)).toMatchObject({ effective: 'reduced', material: 'none', systemReducesTransparency: true });
    expect(resolve('darwin', 'reduced')).toMatchObject({ effective: 'reduced', material: 'none' });
    expect(resolve('darwin', 'off', false)).toMatchObject({ effective: 'off', material: 'none' });
    expect(resolve('darwin', 'off', true)).toMatchObject({ effective: 'off', material: 'none' });
  });

  it('gives an opaque theme background whenever there is no native material', () => {
    expect(windowMaterialOptions(resolve('darwin', 'system'), 'one-dark'))
      .toEqual({ vibrancy: 'under-window', visualEffectState: 'followWindow', backgroundColor: '#00000000' });
    expect(windowMaterialOptions(resolve('win32', 'system', false, '10.0.26100'), 'dracula'))
      .toEqual({ backgroundMaterial: 'mica', backgroundColor: '#00000000' });
    expect(windowMaterialOptions(resolve('darwin', 'off'), 'solarized-light')).toEqual({ backgroundColor: '#fdf6e3' });
    expect(windowMaterialOptions(resolve('linux', 'system'), 'gruvbox')).toEqual({ backgroundColor: '#1b1b1b' });
  });

  it('only reports Mica support on Windows builds that honour it', () => {
    expect(supportsMica('win32', '10.0.22621')).toBe(true);
    expect(supportsMica('win32', 'not-a-version')).toBe(false);
    expect(supportsMica('darwin', '10.0.22621')).toBe(false);
  });
});

describe('applying window material', () => {
  it('only reconfigures what changed, so theme switches do not relayout the window', async () => {
    const { applyWindowMaterial, recordInitialWindowMaterial } = await import('../../src/main/windowMaterial');
    const window = { setVibrancy: vi.fn(), setBackgroundMaterial: vi.fn(), setBackgroundColor: vi.fn() };
    const full = resolve('darwin', 'system');
    recordInitialWindowMaterial(window as never, full, 'one-dark');
    applyWindowMaterial(window as never, full, 'dracula', 'darwin');
    expect(window.setVibrancy).not.toHaveBeenCalled();
    expect(window.setBackgroundColor).not.toHaveBeenCalled();
    const off = resolve('darwin', 'off');
    applyWindowMaterial(window as never, off, 'dracula', 'darwin');
    expect(window.setVibrancy).toHaveBeenCalledWith(null);
    expect(window.setBackgroundColor).toHaveBeenCalledWith('#1e1f29');
    applyWindowMaterial(window as never, off, 'gruvbox', 'darwin');
    expect(window.setVibrancy).toHaveBeenCalledTimes(1);
    expect(window.setBackgroundColor).toHaveBeenLastCalledWith('#1b1b1b');
  });
});
