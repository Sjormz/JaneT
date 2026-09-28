import { readRendererStylesheets } from './stylesheets';
import { describe, it, expect } from 'vitest';
import { getTheme, themeNames, applyCssTheme, themeScheme } from '../../src/renderer/themes';

const globalCss = readRendererStylesheets();

function relativeLuminance(hex: string) {
  const channels = hex.slice(1).match(/.{2}/g)!.map((channel) => parseInt(channel, 16) / 255);
  const [red, green, blue] = channels.map((value) => (
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  ));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground: string, background: string) {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
    / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
}

describe('themes', () => {
  it('has all expected themes', () => {
    expect(themeNames).toContain('tokyo-night');
    expect(themeNames).toContain('dracula');
    expect(themeNames).toContain('one-dark');
    expect(themeNames).toContain('solarized-light');
    expect(themeNames).toContain('gruvbox');
  });

  it('returns one-dark by default for unknown themes', () => {
    const theme = getTheme('nonexistent' as any);
    expect(theme.name).toBe('one-dark');
  });

  it('each theme has required fields', () => {
    for (const name of themeNames) {
      const theme = getTheme(name);
      expect(theme.name).toBe(name);
      expect(theme.label).toBeTruthy();
      expect(theme.css).toBeTruthy();
      expect(theme.css['bg-primary']).toBeTruthy();
      expect(theme.css['text-primary']).toBeTruthy();
      expect(theme.xterm).toBeTruthy();
      expect(theme.xterm.background).toBeTruthy();
      expect(theme.xterm.foreground).toBeTruthy();
    }
  });

  it('dracula theme has correct label', () => {
    const theme = getTheme('dracula');
    expect(theme.label).toBe('Dracula');
  });

  it('applyCssTheme sets CSS variables on root', () => {
    // Setup: create a document root mock
    const root = document.documentElement;
    const originalStyle = root.style.cssText;

    applyCssTheme({ 'bg-primary': '#ff0000', 'text-primary': '#00ff00' });

    expect(root.style.getPropertyValue('--bg-primary')).toBe('#ff0000');
    expect(root.style.getPropertyValue('--text-primary')).toBe('#00ff00');

    // Cleanup
    root.style.cssText = originalStyle;
  });

  it('applyCssTheme drops optional properties the next theme does not define', () => {
    const root = document.documentElement;
    const originalStyle = root.style.cssText;
    applyCssTheme(getTheme('dracula').css);
    expect(root.style.getPropertyValue('--accent-text')).toBe(getTheme('dracula').css['accent-text']);
    applyCssTheme(getTheme('solarized-light').css);
    expect(root.style.getPropertyValue('--accent-text')).toBe('');
    expect(root.style.getPropertyValue('--bg-primary')).toBe(getTheme('solarized-light').css['bg-primary']);
    root.style.cssText = originalStyle;
  });

  it('keeps Solarized Light chrome, functional colors, and terminal text legible', () => {
    const theme = getTheme('solarized-light');
    expect(contrastRatio(theme.css['text-primary'], theme.css['bg-secondary'])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(theme.css['text-secondary'], theme.css['bg-tertiary'])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(theme.xterm.foreground!, theme.xterm.background!)).toBeGreaterThanOrEqual(4.5);
    for (const color of ['text-accent', 'red', 'green', 'yellow', 'cyan']) {
      expect(contrastRatio(theme.css[color], theme.css['bg-tertiary'])).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps accent-button text legible when switching between all themes', () => {
    const root = document.documentElement;
    const originalStyle = root.style.cssText;
    try {
      for (const name of [...themeNames, 'tokyo-night'] as const) {
        applyCssTheme(getTheme(name).css);
        expect(contrastRatio(root.style.getPropertyValue('--on-accent'),
          root.style.getPropertyValue('--text-accent'))).toBeGreaterThanOrEqual(4.5);
      }
    } finally { root.style.cssText = originalStyle; }
  });

  it('keeps secondary sidebar text legible on the chrome glass in every theme', () => {
    const sidebarSurfaceTokens = [...globalCss.matchAll(/([^{}]+)\{([^{}]*)\}/gs)]
      .filter(([, selectors]) => selectors.split(',').some((selector) => selector.trim() === '.sidebar'))
      .flatMap(([, , declarations]) => (
        [...declarations.matchAll(/background:\s*var\(--([\w-]+)\)/g)].map((match) => match[1])
      ));
    expect(sidebarSurfaceTokens.at(-1)).toBe('material-chrome');
    expect(globalCss).toMatch(/--material-chrome:\s*color-mix\(in srgb, var\(--bg-secondary\) var\(--material-chrome-opacity\), transparent\)/);
    expect(globalCss).toMatch(/--material-window:\s*color-mix\(in srgb, var\(--bg-primary\) var\(--material-window-opacity\), transparent\)/);
    const percent = (pattern: RegExp) => Number(globalCss.match(pattern)![1]) / 100;
    const chromeOpacity = {
      dark: percent(/--material-chrome-opacity:\s*(\d+)%/),
      light: percent(/:root\[data-scheme='light'\]\s*\{[^}]*--material-chrome-opacity:\s*(\d+)%/),
    };
    const windowTint = percent(/:root\[data-window-material='mica'\]\s*\{\s*--material-window-opacity:\s*(\d+)%/);
    // Worst case under full glass: the theme-matched OS material behind the tinted window (liquid-glass.md, Contrast).
    const osMaterial = { dark: '#2b2b2e', light: '#e6e1d4' };
    const mix = (top: string, alpha: number, bottom: string) => '#' + [1, 3, 5].map((index) => Math.round(
      parseInt(top.slice(index, index + 2), 16) * alpha + parseInt(bottom.slice(index, index + 2), 16) * (1 - alpha),
    ).toString(16).padStart(2, '0')).join('');

    for (const name of themeNames) {
      const { css } = getTheme(name);
      const scheme = themeScheme(css);
      const behindChrome = mix(css['bg-primary'], windowTint, osMaterial[scheme]);
      const chrome = mix(css['bg-secondary'], chromeOpacity[scheme], behindChrome);
      expect(contrastRatio(css['text-secondary'], chrome), `${name} text-secondary on chrome ${chrome}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
