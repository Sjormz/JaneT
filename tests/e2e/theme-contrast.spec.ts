import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { forceClose } from './electronLifecycle';
import { terminalSettings } from './workspaces';
import { getTheme, themeNames, type ThemeName } from '../../src/renderer/themes';

// In-app contrast for every glass surface (docs/design/liquid-glass.md, Contrast). A page screenshot cannot see the OS
// material, so each text element's background is composited in the renderer from computed backgrounds, over the
// worst-case backdrop for its tier:
// - chrome sits on the window: its ancestors (the window tint) over the theme-matched OS material, when the window
//   is translucent (vibrancy or Mica), otherwise over the opaque window;
// - floating glass blurs the workspace: the layer's own backgrounds over the opaque content background, and over a
//   blurred dense-text region modelled as 40% ink on that background.
// The specular edge gradient is ignored: it sits on the outer border, not behind text.

const root = path.resolve(__dirname, '../..');
const CHROME = ['.titlebar', '.sidebar', '.vtab-bar', '.status-bar'];
const FLOATING = ['.command-palette', '.titlebar-settings-popover'];
// Approximate macOS under-window vibrancy / Windows Mica tints, matched to the theme's scheme by themeSource.
const OS_MATERIAL = { dark: [36, 36, 38], light: [236, 236, 236] } as const;

type Failure = { surface: string; text: string; color: string; background: string; ratio: number; required: number };

function measure(page: Page, surfaces: string[], osMaterial: readonly number[]) {
  return page.evaluate(({ surfaces, floating, osMaterial }) => {
    type RGBA = [number, number, number, number];
    const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    // Resolve any computed colour (rgb(), color(srgb …) from color-mix()) to 8-bit sRGB through the canvas.
    const parse = (color: string): RGBA => {
      probe.clearRect(0, 0, 1, 1);
      probe.fillStyle = '#000';
      probe.fillStyle = color;
      probe.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    };
    const over = (top: RGBA, bottom: RGBA): RGBA => [0, 1, 2].map(i => top[i] * top[3] + bottom[i] * (1 - top[3])).concat(1) as RGBA;
    const luminance = ([r, g, b]: RGBA) => [r, g, b].map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
      .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (a: RGBA, b: RGBA) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
    const css = getComputedStyle(document.documentElement);
    const content = parse(css.getPropertyValue('--bg-primary'));
    const ink = parse(css.getPropertyValue('--text-primary'));
    const translucentWindow = parse(getComputedStyle(document.documentElement).backgroundColor)[3] < 1;
    const floatingBackdrops: RGBA[] = [content, over([...ink.slice(0, 3), 0.4] as RGBA, content)];
    const chromeBackdrops: RGBA[] = translucentWindow ? [[...osMaterial, 1] as RGBA] : [content];
    const failures: Array<{ surface: string; text: string; color: string; background: string; ratio: number; required: number }> = [];
    let checked = 0;
    for (const surface of surfaces) {
      const host = document.querySelector(surface);
      if (!host) throw new Error(`Surface ${surface} is not rendered`);
      const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
      const elements = new Set<HTMLElement>();
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.textContent?.trim() && node.parentElement) elements.add(node.parentElement);
      }
      for (const element of elements) {
        const rect = element.getBoundingClientRect();
        if (!rect.width || !rect.height || !element.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
        if (element.closest('.sr-only, .xterm, .monaco-editor, :disabled, [aria-disabled="true"]')) continue;
        const floatingHost = element.closest(floating.join(', '));
        // Floating layers nested in chrome (the settings popover) are measured as their own surface.
        if (floatingHost && !floating.includes(surface)) continue;
        const style = getComputedStyle(element);
        const chain: HTMLElement[] = [];
        let opacity = 1;
        const top = floatingHost ?? document.documentElement;
        for (let node: HTMLElement | null = element; node; node = node === top ? null : node.parentElement) {
          chain.unshift(node);
          opacity *= Number(getComputedStyle(node).opacity);
        }
        const backdrops = floatingHost ? floatingBackdrops : chromeBackdrops;
        const size = parseFloat(style.fontSize);
        const required = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700) ? 3 : 4.5;
        const text = parse(style.color);
        let worst = Infinity;
        let worstBackground = '';
        for (const backdrop of backdrops) {
          let background = backdrop;
          for (const node of chain) background = over(parse(getComputedStyle(node).backgroundColor), background);
          const foreground = over([...text.slice(0, 3), text[3] * opacity] as RGBA, background);
          const value = ratio(foreground, background);
          if (value < worst) { worst = value; worstBackground = `rgb(${background.slice(0, 3).map(Math.round).join(' ')})`; }
        }
        checked++;
        if (worst < required) {
          failures.push({ surface, text: element.textContent!.trim().slice(0, 40), color: style.color,
            background: worstBackground, ratio: Math.round(worst * 100) / 100, required });
        }
      }
    }
    return { checked, failures };
  }, { surfaces, floating: FLOATING, osMaterial: [...osMaterial] });
}

async function chooseTheme(page: Page, name: ThemeName) {
  const theme = getTheme(name);
  await page.getByRole('button', { name: theme.label, exact: true }).click();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim()))
    .toBe(theme.css['bg-primary']);
  await expect(page.locator('html')).not.toHaveAttribute('data-layout-transition');
  await settled(page);
}

/** Colour transitions report the previous theme's colours until they finish; measure only settled styles. */
async function settled(page: Page) {
  await expect.poll(() => page.evaluate(() => document.getAnimations()
    .filter(animation => animation.playState === 'running' && animation.effect?.getComputedTiming().iterations !== Infinity).length)).toBe(0);
}

for (const transparency of ['system', 'reduced'] as const) {
  test(`keeps glass text legible in every theme with ${transparency} transparency`, async ({}, testInfo) => {
    const userData = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'janet-contrast-'));
    fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ ...terminalSettings(userData), transparency }));
    const env: Record<string, string> = { ...process.env, NODE_ENV: 'test', JANET_E2E_USER_DATA_DIR: userData };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.ELECTRON_NO_ATTACH_CONSOLE;
    let app: ElectronApplication | undefined;
    let failure: unknown;
    try {
      app = await electron.launch({ args: ['.'], cwd: root, env });
      const page = await app.firstWindow();
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await expect(page.locator('.xterm-helper-textarea')).toHaveAttribute('data-shell-ready', 'true');
      await expect(page.locator('html')).toHaveAttribute('data-transparency', transparency === 'reduced' ? 'reduced' : /full|reduced/);
      const results: Record<string, { checked: number; failures: Failure[] }> = {};
      for (const name of themeNames) {
        const scheme = await page.getByRole('button', { name: 'Open settings' }).click()
          .then(() => chooseTheme(page, name))
          .then(() => page.evaluate(() => document.documentElement.dataset.scheme as 'dark' | 'light'));
        // Settings popover open: measures the floating tier over the chrome, then the palette on its own.
        const withSettings = await measure(page, [...CHROME, '.titlebar-settings-popover'], OS_MATERIAL[scheme]);
        await page.getByRole('button', { name: 'Hide settings' }).click();
        await page.locator('.titlebar-palette-btn').click();
        await expect(page.locator('.command-palette')).toBeVisible();
        await settled(page);
        const palette = await measure(page, ['.command-palette'], OS_MATERIAL[scheme]);
        await page.keyboard.press('Escape');
        await expect(page.locator('.command-palette')).toHaveCount(0);
        results[name] = { checked: withSettings.checked + palette.checked, failures: [...withSettings.failures, ...palette.failures] };
      }
      await testInfo.attach('contrast', { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
      for (const name of themeNames) {
        expect(results[name].checked, `${name} text elements measured`).toBeGreaterThan(20);
        expect(results[name].failures, `${name} contrast failures`).toEqual([]);
      }
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      try {
        await forceClose(app);
        await fs.promises.rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch (error) { if (!failure) throw error; console.error('Contrast fixture cleanup failed:', error); }
    }
  });
}

