import type { WindowMaterialState } from '../main/windowMaterial';

/**
 * Publishes the effective transparency and window material as attributes on <html>, where the material tokens in
 * styles/tokens.css read them. Without a state (e.g. in component tests) the app renders as fully opaque.
 */
export function applyWindowMaterialAttributes(state: WindowMaterialState | null | undefined): void {
  const root = document.documentElement;
  root.dataset.transparency = state?.effective ?? 'off';
  root.dataset.windowMaterial = state?.material ?? 'none';
}
