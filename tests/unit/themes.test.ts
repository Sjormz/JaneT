import { describe, it, expect } from 'vitest';
import { getTheme, themeNames, applyCssTheme } from '../../src/renderer/themes';

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

  it('returns tokyo-night by default for unknown themes', () => {
    const theme = getTheme('nonexistent' as any);
    expect(theme.name).toBe('tokyo-night');
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

  it('keeps Solarized Light chrome, functional colors, and terminal text legible', () => {
    const theme = getTheme('solarized-light');
    expect(contrastRatio(theme.css['text-primary'], theme.css['bg-secondary'])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(theme.css['text-secondary'], theme.css['bg-tertiary'])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(theme.xterm.foreground!, theme.xterm.background!)).toBeGreaterThanOrEqual(4.5);
    for (const color of ['text-accent', 'red', 'green', 'yellow', 'cyan']) {
      expect(contrastRatio(theme.css[color], theme.css['bg-tertiary'])).toBeGreaterThanOrEqual(3);
    }
  });
});
