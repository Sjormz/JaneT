import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { forceClose } from './electronLifecycle';
import { terminalSettings } from './workspaces';
import { getTheme } from '../../src/renderer/themes';

const root = path.resolve(__dirname, '../..');

function launch(userData: string): Promise<ElectronApplication> {
  const env: Record<string, string> = { ...process.env, NODE_ENV: 'test', JANET_E2E_USER_DATA_DIR: userData } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  return electron.launch({ args: ['.'], cwd: root, env });
}

/** What System should resolve to on this machine, derived from the OS rather than from the app. */
async function expectedSystemState(app: ElectronApplication): Promise<{ effective: 'full' | 'reduced'; material: string }> {
  return app.evaluate(({ nativeTheme }) => {
    if (nativeTheme.prefersReducedTransparency) return { effective: 'reduced' as const, material: 'none' };
    const build = Number(process.getSystemVersion().split('.')[2]);
    const material = process.platform === 'darwin' ? 'vibrancy' : process.platform === 'win32' && build >= 22621 ? 'mica' : 'none';
    return { effective: 'full' as const, material };
  });
}

async function materialState(page: Page, app: ElectronApplication) {
  const renderer = await page.evaluate(() => {
    const titlebar = getComputedStyle(document.querySelector('.titlebar')!);
    return {
      transparency: document.documentElement.dataset.transparency,
      material: document.documentElement.dataset.windowMaterial,
      scheme: document.documentElement.dataset.scheme,
      titlebarBackground: titlebar.backgroundColor,
      titlebarFilter: titlebar.backdropFilter,
    };
  });
  const native = await app.evaluate(({ BrowserWindow, nativeTheme }) => ({
    background: BrowserWindow.getAllWindows()[0].getBackgroundColor().toLowerCase(),
    themeSource: nativeTheme.themeSource,
  }));
  return { ...renderer, ...native };
}

/** Alpha of a computed colour: rgb()/rgba() or color(srgb r g b / a) as produced by color-mix(). */
function alphaOf(color: string): number {
  const slash = color.match(/\/\s*([\d.]+)\s*\)$/);
  if (slash) return Number(slash[1]);
  const rgba = color.match(/^rgba\([^)]*,\s*([\d.]+)\s*\)$/);
  return rgba ? Number(rgba[1]) : 1;
}

async function chooseTransparency(page: Page, label: 'System' | 'Reduced' | 'Off') {
  await page.getByRole('button', { name: 'Open settings' }).click();
  const group = page.getByRole('group', { name: 'Transparency' });
  await group.getByRole('button', { name: label }).click();
  await expect(group.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Hide settings' }).click();
}

async function paletteFilter(page: Page): Promise<string> {
  await page.getByRole('button', { name: /^Open command palette/ }).click();
  const palette = page.locator('.command-palette');
  await expect(palette).toBeVisible();
  const filter = await palette.evaluate((element) => getComputedStyle(element).backdropFilter);
  await page.keyboard.press('Escape');
  await expect(palette).toHaveCount(0);
  return filter;
}

test('applies, persists and falls back through the Transparency setting', async () => {
  test.setTimeout(90_000);
  const userData = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'janet-transparency-'));
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ ...terminalSettings(userData), theme: 'one-dark' }));
  const oneDark = getTheme('one-dark').css['bg-primary'];
  let app: ElectronApplication | undefined;
  try {
    app = await launch(userData);
    let page = await app.firstWindow();
    await expect(page.locator('.titlebar')).toBeVisible();
    const expected = await expectedSystemState(app);

    // System (default): full glass unless the OS reduces transparency. The window is transparent only when the
    // OS supplies a material; otherwise it keeps the opaque theme colour, so it never shows an empty frame.
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.windowMaterial)).toBe(expected.material);
    let state = await materialState(page, app);
    expect(state).toMatchObject({ transparency: expected.effective, scheme: 'dark', themeSource: 'dark' });
    // getBackgroundColor() reports #RRGGBB, so the transparent window reads as black; no theme canvas is pure black.
    if (expected.material === 'none') expect(state.background).toBe(oneDark);
    else expect(['#00000000', '#000000']).toContain(state.background);
    if (expected.effective === 'full') expect(alphaOf(state.titlebarBackground)).toBeCloseTo(0.78, 2);
    // Chrome is a tint over the window material; only floating layers blur.
    expect(state.titlebarFilter).toBe('none');
    expect(await paletteFilter(page)).toContain(expected.effective === 'full' ? 'blur(40px)' : 'blur(16px)');

    // Off: every tier solid and unblurred, and the window background opaque.
    await chooseTransparency(page, 'Off');
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.transparency)).toBe('off');
    state = await materialState(page, app);
    expect(state).toMatchObject({ material: 'none', background: oneDark });
    expect(alphaOf(state.titlebarBackground)).toBe(1);
    expect(await paletteFilter(page)).toBe('none');

    // Reduced: thicker glass on an opaque window.
    await chooseTransparency(page, 'Reduced');
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.transparency)).toBe('reduced');
    state = await materialState(page, app);
    expect(state).toMatchObject({ material: 'none', background: oneDark });
    expect(await paletteFilter(page)).toContain('blur(16px)');

    // A light theme switches the native scheme so OS materials and dialogs match it.
    await page.getByRole('button', { name: 'Open settings' }).click();
    await page.getByRole('button', { name: getTheme('solarized-light').label, exact: true }).click();
    await page.getByRole('button', { name: 'Hide settings' }).click();
    await expect.poll(() => app!.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('light');
    await expect(page.locator('html')).toHaveAttribute('data-scheme', 'light');

    // The preference survives a restart and is applied before the first frame.
    await expect.poll(() => JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')).transparency).toBe('reduced');
    await forceClose(app);
    app = await launch(userData);
    page = await app.firstWindow();
    await expect(page.locator('html')).toHaveAttribute('data-transparency', 'reduced');
    await expect(page.locator('html')).toHaveAttribute('data-window-material', 'none');
    await page.getByRole('button', { name: 'Open settings' }).click();
    await expect(page.getByRole('group', { name: 'Transparency' }).getByRole('button', { name: 'Reduced' }))
      .toHaveAttribute('aria-pressed', 'true');
  } finally {
    await forceClose(app);
    fs.rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
