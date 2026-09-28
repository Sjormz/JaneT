import { describe, expect, it } from 'vitest';
import { THEME_WINDOW } from '../../src/main/windowMaterial';
import { getTheme, themeNames, themeScheme } from '../../src/renderer/themes';
import { readRendererStylesheets } from './stylesheets';

const css = readRendererStylesheets();

describe('material styles', () => {
  it('declares only the unprefixed backdrop-filter', () => {
    // Vite's minifier keeps only the last of backdrop-filter / -webkit-backdrop-filter, and Chromium ignores the
    // -webkit form, so a pair silently removes the blur from packaged builds.
    expect(css).not.toMatch(/-webkit-backdrop-filter\s*:/);
  });

  it('keeps every glass tier at or above the contrast floors', () => {
    const opacity = (block: string, name: string) => Number(block.match(new RegExp(`--material-${name}-opacity:\\s*(\\d+)%`))?.[1]);
    const rootBlock = css.match(/--material-window:[\s\S]*?--material-floating-filter:[^;]+;/)![0];
    const light = css.match(/:root\[data-scheme='light'\]\s*\{([^}]*)\}/)![1];
    // docs/design/liquid-glass.md, Contrast: chrome >= 76% dark / 70% light, floating >= 80% dark / 62% light.
    expect(opacity(rootBlock, 'chrome')).toBeGreaterThanOrEqual(76);
    expect(opacity(rootBlock, 'floating')).toBeGreaterThanOrEqual(80);
    expect(opacity(light, 'chrome')).toBeGreaterThanOrEqual(70);
    expect(opacity(light, 'floating')).toBeGreaterThanOrEqual(62);
  });

  it('makes every tier solid and unblurred when transparency is off', () => {
    const off = css.match(/:root\[data-transparency='off'\]\s*\{([^}]*)\}/)![1];
    expect(off).toMatch(/--material-chrome-opacity:\s*100%/);
    expect(off).toMatch(/--material-floating-opacity:\s*100%/);
    expect(off).toMatch(/--material-chrome-filter:\s*none/);
    expect(off).toMatch(/--material-floating-filter:\s*none/);
  });

  it('keeps the main-process window colours in step with the themes', () => {
    for (const name of themeNames) {
      const theme = getTheme(name);
      expect(THEME_WINDOW[name], name).toEqual({ background: theme.css['bg-primary'], scheme: themeScheme(theme.css) });
    }
  });
});

describe('stylesheet tokens', () => {
  it('only references custom properties that are defined somewhere', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    // A var() of an undefined property makes a whole shorthand (e.g. font) invalid, silently.
    const defined = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1]));
    for (const match of fs.readFileSync(path.join(process.cwd(), 'src/renderer/themes.ts'), 'utf8').matchAll(/'([a-z0-9-]+)':\s*'/g)) defined.add(`--${match[1]}`);
    // Set at runtime by applyCssTheme or inline by components.
    for (const name of ['--glass-bg-strong', '--text-tertiary', '--text-disabled', '--on-accent']) defined.add(name);
    const components = path.join(process.cwd(), 'src/renderer/components');
    for (const file of fs.readdirSync(components)) {
      for (const match of fs.readFileSync(path.join(components, file), 'utf8').matchAll(/'(--[a-z0-9-]+)'/g)) defined.add(match[1]);
    }
    const undefinedProperties = [...new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1]))]
      .filter((name) => !defined.has(name));
    expect(undefinedProperties).toEqual([]);
  });
});
