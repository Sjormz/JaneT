import { test, expect, _electron as electron, type Page, type ElectronApplication } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { forceClose } from './electronLifecycle';
import { terminalSettings } from './workspaces';
import { getTheme } from '../../src/renderer/themes';

class MotionWorkspace {
  constructor(private page: Page) {}
  async ready() {
    await expect(this.page.locator('.terminal-container')).toHaveCount(2);
    for (const input of await this.page.locator('.xterm-helper-textarea').all()) {
      await expect(input).toHaveAttribute('data-shell-ready', 'true');
    }
  }
  async maximize() { await this.page.getByRole('button', { name: /Maximize pane — left/ }).click(); }
  async restore() { await this.page.keyboard.press('F6'); }
  async rename() {
    await this.page.getByLabel('left heading', { exact: true }).click({ button: 'right' });
    await this.page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
  }
  async createProject() {
    await this.page.getByRole('button', { name: 'Test library', exact: true }).click({ button: 'right' });
    await this.page.getByRole('menuitem', { name: 'Add project', exact: true }).click();
  }
  async theme(name: 'tokyo-night' | 'solarized-light') {
    const definition = getTheme(name);
    await this.page.getByRole('button', { name: 'Open settings' }).click();
    await this.page.getByRole('button', { name: definition.label, exact: true }).click();
    await this.page.getByRole('button', { name: 'Hide settings' }).click();
    await expect.poll(() => this.page.evaluate(() => getComputedStyle(document.documentElement)
      .getPropertyValue('--bg-primary').trim())).toBe(definition.css['bg-primary']);
    await expect(this.page.locator('.motion-presence[data-motion-state="closing"]')).toHaveCount(0);
  }
}

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`keeps motion, focus and terminal state correct with ${reducedMotion}`, async ({}, testInfo) => {
    const userData = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'janet-motion-'));
    const settings = terminalSettings(userData);
    const root = { type: 'split', direction: 'vertical', sizes: [1, 1], children: [
      { type: 'leaf', title: 'left', cwd: userData }, { type: 'leaf', title: 'right', cwd: userData },
    ] };
    fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ ...settings,
      keybindings: { 'maximize-pane': 'F6' },
      session: { ...settings.session, tabs: [{ ...settings.session.tabs[0], root }] },
    }));
    const env: Record<string, string> = { ...process.env, NODE_ENV: 'test', JANET_E2E_USER_DATA_DIR: userData };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.ELECTRON_NO_ATTACH_CONSOLE;
    let app: ElectronApplication | undefined;
    let observedPage: Page | undefined;
    let failure: unknown;
    let output = '';
    try {
      app = await electron.launch({ args: ['.'], cwd: path.resolve(__dirname, '../..'), env });
      app.process().stdout?.on('data', chunk => { output += chunk; });
      app.process().stderr?.on('data', chunk => { output += chunk; });
      const page = await app.firstWindow();
      observedPage = page;
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.emulateMedia({ reducedMotion });
      const workspace = new MotionWorkspace(page);
      await workspace.ready();
      await page.evaluate(() => {
        const state = (window as any).__motion = { transitions: 0, ready: 0, finished: 0, durations: [] as unknown[], holdExits: false };
        const start = document.startViewTransition.bind(document);
        document.startViewTransition = ((update: () => void) => {
          state.transitions++;
          const transition = start(update);
          void transition.ready.then(() => state.ready++).catch(() => {});
          void transition.finished.then(() => state.finished++);
          return transition;
        }) as typeof document.startViewTransition;
        const animate = Element.prototype.animate;
        Element.prototype.animate = function (frames, options) {
          const duration = typeof options === 'object' ? options?.duration : options;
          state.durations.push(duration);
          const animation = animate.call(this, frames, options);
          if (duration === 120 && state.holdExits) animation.pause();
          return animation;
        };
      });
      const terminalIds = await page.locator('.terminal-container').evaluateAll(elements => elements.map(el => el.getAttribute('data-terminal-id')));
      await workspace.maximize();
      await expect(page.locator('.terminal-container')).toHaveCount(1);
      await expect(page.locator('.terminal-leaf')).toHaveAttribute('aria-current', 'true');
      await expect.poll(() => page.evaluate(() => (window as any).__motion.ready)).toBe(reducedMotion === 'reduce' ? 0 : 1);
      await workspace.restore();
      await expect(page.locator('.terminal-container')).toHaveCount(2);
      expect(await page.locator('.terminal-container').evaluateAll(elements => elements.map(el => el.getAttribute('data-terminal-id')))).toEqual(terminalIds);
      await expect.poll(() => page.evaluate(() => (window as any).__motion.finished)).toBe(reducedMotion === 'reduce' ? 0 : 2);
      expect(await page.evaluate(() => (window as any).__motion.ready)).toBe(reducedMotion === 'reduce' ? 0 : 2);
      expect(await page.evaluate(() => (window as any).__motion.transitions)).toBe(reducedMotion === 'reduce' ? 0 : 2);

      await workspace.rename();
      const rename = page.getByRole('dialog', { name: 'Rename terminal' });
      await expect(rename.getByRole('textbox', { name: 'Terminal name' })).toBeFocused();
      await page.screenshot({ path: testInfo.outputPath('rename.png') });
      await page.evaluate(() => { (window as any).__motion.holdExits = true; });
      await page.keyboard.press('Escape');
      await expect(rename).toBeHidden();
      await expect(page.locator('.xterm-helper-textarea').first()).toBeFocused();
      if (reducedMotion === 'no-preference') {
        const closingRename = page.locator('.motion-presence[data-motion-state="closing"]').filter({ has: page.locator('.rename-dialog') });
        await expect(closingRename).toHaveAttribute('inert', '');
        await expect(closingRename).toHaveAttribute('aria-hidden', 'true');
      }
      await page.keyboard.type('node -e "console.log([\'__MOTION\',\'INPUT_READY__\'].join(\'_\'))"');
      await page.keyboard.press('Enter');
      await expect(page.locator('.xterm-rows').first()).toContainText('__MOTION_INPUT_READY__');
      await page.evaluate(() => {
        (window as any).__motion.holdExits = false;
        document.getAnimations().filter(animation => animation.playState === 'paused').forEach(animation => animation.finish());
      });
      await expect(page.locator('.motion-presence[data-motion-state="closing"]')).toHaveCount(0);

      await workspace.createProject();
      const project = page.getByRole('region', { name: 'Create project', exact: true });
      await expect(project.getByRole('textbox', { name: 'Project name' })).toBeVisible();
      await project.getByRole('textbox', { name: 'Project name' }).fill('Motion project');
      await expect(page.locator('.workspace-content')).toBeHidden();
      await project.getByRole('button', { name: 'Add terminals', exact: false }).click();
      await expect(project.getByRole('spinbutton', { name: 'Initial terminals' })).toBeVisible();
      const windowHandle = await app.browserWindow(page);
      await windowHandle.evaluate(window => window.setSize(800, 600));
      await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([800, 600]);
      await expect(project.getByRole('textbox', { name: 'Project name' })).toHaveValue('Motion project');
      for (const theme of ['tokyo-night', 'solarized-light'] as const) {
        await workspace.theme(theme);
        await page.screenshot({ path: testInfo.outputPath(`project-${theme}.png`) });
        expect(await project.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      }
      await project.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(project).toBeHidden();
      await expect(page.locator('.terminal-container')).toHaveCount(2);
      const durations = await page.evaluate(() => (window as any).__motion.durations as number[]);
      if (reducedMotion === 'reduce') expect(durations).toEqual([]);
      else { expect(durations).toContain(180); expect(durations).toContain(120); }
      expect(errors).toEqual([]);
    } catch (error) {
      failure = error;
      if (observedPage) {
        const diagnostics = await Promise.race([
          observedPage.evaluate(() => ({
            visibility: document.visibilityState, focused: document.hasFocus(),
            exits: Array.from(document.querySelectorAll('.motion-presence[data-motion-state="closing"]')).map(el => ({
              surface: el.firstElementChild?.className,
              animations: el.getAnimations({ subtree: true }).map(animation => ({ state: animation.playState,
                time: animation.currentTime, timing: animation.effect?.getComputedTiming() })),
            })),
          })).catch(() => 'Renderer unavailable'),
          new Promise(resolve => setTimeout(() => resolve('Renderer diagnostics timed out'), 1500)),
        ]);
        await testInfo.attach('motion-state', { body: JSON.stringify(diagnostics), contentType: 'application/json' });
      }
      throw error;
    }
    finally {
      await testInfo.attach('electron-output', { body: output, contentType: 'text/plain' });
      try {
        await forceClose(app);
        await fs.promises.rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch (error) { if (!failure) throw error; console.error('Motion fixture cleanup failed:', error); }
    }
  });
}
