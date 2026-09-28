import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';
import type { ThemeName, TransparencyPreference } from './settings';

/** What the renderer styles against: `full` glass, `reduced` (thicker, no desktop show-through) or `off` (solid). */
export type EffectiveTransparency = 'full' | 'reduced' | 'off';
export type WindowMaterialKind = 'vibrancy' | 'mica' | 'none';

/** Renderer argument carrying the initial state, so the first frame already matches the window material. */
export const WINDOW_MATERIAL_ARG = '--janet-window-material=';

export interface WindowMaterialState {
  preference: TransparencyPreference;
  effective: EffectiveTransparency;
  material: WindowMaterialKind;
  /** The OS "Reduce transparency" setting, when the platform reports one. */
  systemReducesTransparency: boolean;
}

/** Window background and light/dark scheme per theme; must match `bg-primary` in src/renderer/themes.ts. */
export const THEME_WINDOW: Record<ThemeName, { background: string; scheme: 'dark' | 'light' }> = {
  'one-dark': { background: '#0b0b0c', scheme: 'dark' },
  'tokyo-night': { background: '#0f0f1a', scheme: 'dark' },
  dracula: { background: '#1e1f29', scheme: 'dark' },
  'solarized-light': { background: '#fdf6e3', scheme: 'light' },
  gruvbox: { background: '#1b1b1b', scheme: 'dark' },
};

/** Windows 11 22H2 (build 22621) is the first release where Electron's backgroundMaterial applies. */
export function supportsMica(platform: string, osRelease: string): boolean {
  if (platform !== 'win32') return false;
  const build = Number(osRelease.split('.')[2]);
  return Number.isFinite(build) && build >= 22621;
}

export function resolveWindowMaterial(input: {
  platform: string;
  osRelease: string;
  preference: TransparencyPreference;
  systemReducesTransparency: boolean;
}): WindowMaterialState {
  const { platform, osRelease, preference, systemReducesTransparency } = input;
  const effective: EffectiveTransparency = preference === 'off' ? 'off'
    : preference === 'reduced' || systemReducesTransparency ? 'reduced'
      : 'full';
  // Only full glass lets the desktop show through; reduced keeps in-app depth on an opaque window.
  const material: WindowMaterialKind = effective !== 'full' ? 'none'
    : platform === 'darwin' ? 'vibrancy'
      : supportsMica(platform, osRelease) ? 'mica'
        : 'none';
  return { preference, effective, material, systemReducesTransparency };
}

/** BrowserWindow options for the initial material. The window stays hidden until first paint to avoid a flash. */
export function windowMaterialOptions(state: WindowMaterialState, theme: ThemeName): BrowserWindowConstructorOptions {
  const { background } = THEME_WINDOW[theme] ?? THEME_WINDOW['one-dark'];
  if (state.material === 'vibrancy') return { vibrancy: 'under-window', visualEffectState: 'followWindow', backgroundColor: '#00000000' };
  if (state.material === 'mica') return { backgroundMaterial: 'mica', backgroundColor: '#00000000' };
  return { backgroundColor: background };
}

const appliedMaterial = new WeakMap<BrowserWindow, { material: WindowMaterialKind; background: string }>();

/**
 * Re-applies the material to a live window after a theme or transparency change. Only values that changed are
 * touched: reconfiguring macOS vibrancy relayouts the window, which resizes terminals and makes shells redraw.
 */
export function applyWindowMaterial(window: BrowserWindow, state: WindowMaterialState, theme: ThemeName, platform: string): void {
  const background = state.material === 'none' ? (THEME_WINDOW[theme] ?? THEME_WINDOW['one-dark']).background : '#00000000';
  const previous = appliedMaterial.get(window);
  if (previous?.material !== state.material) {
    if (platform === 'darwin') window.setVibrancy(state.material === 'vibrancy' ? 'under-window' : null);
    if (platform === 'win32' && typeof window.setBackgroundMaterial === 'function') {
      window.setBackgroundMaterial(state.material === 'mica' ? 'mica' : 'none');
    }
  }
  if (previous?.background !== background) window.setBackgroundColor(background);
  appliedMaterial.set(window, { material: state.material, background });
}

/** Records what a window was created with, so the first refresh only changes what differs. */
export function recordInitialWindowMaterial(window: BrowserWindow, state: WindowMaterialState, theme: ThemeName): void {
  const background = state.material === 'none' ? (THEME_WINDOW[theme] ?? THEME_WINDOW['one-dark']).background : '#00000000';
  appliedMaterial.set(window, { material: state.material, background });
}
