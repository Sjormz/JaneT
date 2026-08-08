import { test, expect, _electron as electron, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const root = path.resolve(__dirname, '../..');
const neutralCwd = process.env.SystemRoot ?? root;
const themes = ['tokyo-night', 'solarized-light'] as const;
const viewports = [{ width: 1280, height: 800 }, { width: 800, height: 600 }] as const;

function electronEnv(extra: NodeJS.ProcessEnv): Record<string, string> {
  const env = { ...process.env, ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

async function forceClose(app: ElectronApplication | undefined): Promise<void> {
  if (!app) return;
  try {
    await app.evaluate(({ app: electronApp }) => electronApp.exit(0));
  } catch {}
  await app.waitForEvent('close', { timeout: 5_000 }).catch(() => {});
}

function tab(page: Page, title: string): Locator {
  return page.locator('.vtab-item').filter({ has: page.locator('.vtab-name', { hasText: title }) });
}

function agentSequence(event: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify({ version: 1, ...event })).toString('base64url');
  return `\u001b]777;janet-agent;hermes;${encoded}\u001b\\`;
}

function emitCommand(event: Record<string, unknown>): string {
  const encoded = Buffer.from(agentSequence(event)).toString('base64');
  return `node -e "process.stdout.write(Buffer.from('${encoded}','base64'))"`;
}

function gatedEmitCommand(event: Record<string, unknown>): string {
  const encoded = Buffer.from(agentSequence(event)).toString('base64');
  return `node -e "process.stdin.once('data',()=>process.stdout.write(Buffer.from('${encoded}','base64')))"`;
}

async function typeCommand(page: Page, terminal: Locator, command: string): Promise<void> {
  const textarea = terminal.locator('.xterm-helper-textarea');
  await expect(textarea).toHaveCount(1);
  await expect(textarea).toHaveAttribute('data-shell-ready', 'true', { timeout: 15_000 });
  await textarea.focus();
  await page.keyboard.type(command, { delay: 1 });
  await page.keyboard.press('Enter');
}

async function selectTab(page: Page, title: string): Promise<Locator> {
  const target = tab(page, title);
  await target.click();
  await expect(target).toHaveClass(/active/);
  const terminal = page.locator('.terminal-leaf[aria-current="true"] .terminal-container');
  await expect(terminal).toBeVisible({ timeout: 15_000 });
  return terminal;
}

async function switchTheme(page: Page, theme: typeof themes[number]): Promise<void> {
  await page.getByRole('button', { name: 'Open settings' }).click();
  const label = theme === 'tokyo-night' ? 'Tokyo Night' : 'Solarized Light';
  await page.getByRole('button', { name: label, exact: true }).click();
  await page.getByRole('button', { name: 'Hide settings' }).click();
  const expected = theme === 'tokyo-night' ? 'rgb(15, 15, 26)' : 'rgb(253, 246, 227)';
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement)
    .getPropertyValue('--bg-primary').trim())).toBe(theme === 'tokyo-night' ? '#0f0f1a' : '#fdf6e3');
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(expected);
}

async function measureVisualState(page: Page, name: string) {
  return page.evaluate((stateName) => {
    type Rgba = [number, number, number, number];
    const parseColor = (value: string): Rgba => {
      if (value === 'transparent') return [0, 0, 0, 0];
      const numbers = value.match(/[\d.]+/g)?.map(Number) ?? [];
      if (value.startsWith('color(srgb')) {
        return [numbers[0] * 255, numbers[1] * 255, numbers[2] * 255, numbers[3] ?? 1];
      }
      return [numbers[0] ?? 0, numbers[1] ?? 0, numbers[2] ?? 0, numbers[3] ?? 1];
    };
    const composite = (foreground: Rgba, background: Rgba): Rgba => {
      const alpha = foreground[3] + background[3] * (1 - foreground[3]);
      if (alpha === 0) return [0, 0, 0, 0];
      return [
        (foreground[0] * foreground[3] + background[0] * background[3] * (1 - foreground[3])) / alpha,
        (foreground[1] * foreground[3] + background[1] * background[3] * (1 - foreground[3])) / alpha,
        (foreground[2] * foreground[3] + background[2] * background[3] * (1 - foreground[3])) / alpha,
        alpha,
      ];
    };
    const effectiveBackground = (element: Element): Rgba => {
      const ancestors: Element[] = [];
      for (let current: Element | null = element; current; current = current.parentElement) ancestors.unshift(current);
      return ancestors.reduce<Rgba>((background, current) => (
        composite(parseColor(getComputedStyle(current).backgroundColor), background)
      ), [0, 0, 0, 0]);
    };
    const luminance = ([red, green, blue]: Rgba) => {
      const channels = [red, green, blue].map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    };
    const contrast = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector)!;
      const background = effectiveBackground(element);
      const foreground = composite(parseColor(getComputedStyle(element).color), background);
      const lighter = Math.max(luminance(foreground), luminance(background));
      const darker = Math.min(luminance(foreground), luminance(background));
      return {
        selector,
        foreground: getComputedStyle(element).color,
        background: background.slice(0, 3).map((channel) => Math.round(channel)),
        ratio: (lighter + 0.05) / (darker + 0.05),
      };
    };
    const keySelectors = [
      '.app', '.titlebar', '.app-body', '.workspace-tools', '.vtab-bar', '.terminal-area',
      '.status-bar', '.broadcast-input-banner', '.vtab-sub.running', '.vtab-sub.finished',
      '.vtab-sub.exited', '.vtab-sub.disconnected', '.leaf-awareness.needs-input',
      '.terminal-command-failed',
    ];
    const regions = keySelectors.map((selector) => {
      const element = document.querySelector<HTMLElement>(selector)!;
      const rect = element.getBoundingClientRect();
      return {
        selector,
        visible: element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
        rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
        insideViewport: rect.left >= -1 && rect.top >= -1
          && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1,
      };
    });
    const activeHeader = document.querySelector<HTMLElement>('.terminal-leaf[aria-current="true"] .terminal-leaf-header')!;
    const broadcastLeaf = document.querySelector<HTMLElement>('.terminal-leaf.broadcast-selected')!;
    const activeTab = document.querySelector<HTMLElement>('.vtab-item.active')!;
    const inactiveTab = document.querySelector<HTMLElement>('.vtab-item:not(.active)')!;
    const failedMarker = document.querySelector<HTMLElement>('.terminal-command-failed')!;
    return {
      name: stateName,
      viewport: { width: innerWidth, height: innerHeight },
      document: {
        bodyScrollWidth: document.body.scrollWidth,
        rootScrollWidth: document.documentElement.scrollWidth,
        bodyScrollHeight: document.body.scrollHeight,
        rootScrollHeight: document.documentElement.scrollHeight,
      },
      regions,
      distinctions: {
        activePaneShadow: getComputedStyle(activeHeader).boxShadow,
        broadcastOutlineStyle: getComputedStyle(broadcastLeaf).outlineStyle,
        broadcastOutlineWidth: getComputedStyle(broadcastLeaf).outlineWidth,
        activeTabOutlineStyle: getComputedStyle(activeTab).outlineStyle,
        activeTabOutlineWidth: getComputedStyle(activeTab).outlineWidth,
        activeTabBackground: effectiveBackground(activeTab).slice(0, 3).map(Math.round),
        inactiveTabBackground: effectiveBackground(inactiveTab).slice(0, 3).map(Math.round),
        failedMarkerBorder: getComputedStyle(failedMarker).borderLeftWidth,
      },
      contrastPairs: [
        contrast('.workspace-tools-following'),
        contrast('.vtab-sub.running'),
        contrast('.vtab-sub.finished'),
        contrast('.vtab-sub.exited'),
        contrast('.vtab-sub.disconnected'),
        contrast('.leaf-awareness.needs-input'),
        contrast('.terminal-leaf.broadcast-selected .leaf-title'),
        contrast('.broadcast-input-banner strong'),
      ],
    };
  }, name);
}

test('proves the final two-theme Electron visual matrix', async ({}, testInfo) => {
  test.setTimeout(120_000);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'janet-final-visual-e2e-'));
  const pageErrors: string[] = [];
  let app: ElectronApplication | undefined;

  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({
    theme: 'tokyo-night',
    fontSize: 14,
    sidebarSide: 'left',
    keybindings: {},
    sshProfiles: [],
    workspaceTabs: [],
    session: {
      tabs: [
        {
          id: 'visual-active', title: 'Active workspace', type: 'local', cwd: neutralCwd,
          root: {
            type: 'split', direction: 'vertical', sizes: [1, 1],
            children: [
              { type: 'leaf', title: 'Focused', terminalType: 'local', cwd: neutralCwd },
              { type: 'leaf', title: 'Failed command', terminalType: 'local', cwd: neutralCwd },
            ],
          },
          selectedPanePath: [0],
        },
        {
          id: 'visual-running', title: 'Running agent', type: 'local', cwd: neutralCwd,
          root: { type: 'leaf', title: 'Running', terminalType: 'local', cwd: neutralCwd },
        },
        {
          id: 'visual-finished', title: 'Finished agent', type: 'local', cwd: neutralCwd,
          root: { type: 'leaf', title: 'Finished', terminalType: 'local', cwd: neutralCwd },
        },
        {
          id: 'visual-exited', title: 'Exited shell', type: 'local', cwd: neutralCwd,
          root: { type: 'leaf', title: 'Exited', terminalType: 'local', cwd: neutralCwd },
        },
        {
          id: 'visual-disconnected', title: 'Disconnected SSH', type: 'ssh', sshProfileId: 'missing-neutral-profile',
          root: { type: 'leaf', title: 'Remote', terminalType: 'ssh', sshProfileId: 'missing-neutral-profile' },
        },
      ],
      activeTabId: 'visual-active',
      sidebarOpen: true,
      tabsOpen: true,
      sidebarSection: 'files',
    },
  }, null, 2), 'utf8');

  try {
    app = await electron.launch({
      args: ['.'],
      cwd: root,
      env: electronEnv({ NODE_ENV: 'test', JANET_E2E_USER_DATA_DIR: userData }),
    });
    const observedPages = new Set<Page>();
    const capturePageErrors = (candidate: Page) => {
      if (observedPages.has(candidate)) return;
      observedPages.add(candidate);
      candidate.on('pageerror', (error) => pageErrors.push(error.message));
    };
    app.on('window', capturePageErrors);
    app.windows().forEach(capturePageErrors);
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1280, 800));
    await expect.poll(() => page.evaluate(() => ({ width: innerWidth, height: innerHeight })))
      .toEqual({ width: 1280, height: 800 });
    await expect(page.locator('.vtab-item')).toHaveCount(5);
    await expect(tab(page, 'Disconnected SSH').locator('.vtab-sub')).toHaveText('SSH disconnected');

    const runningTerminal = await selectTab(page, 'Running agent');
    await typeCommand(page, runningTerminal, emitCommand({
      event: 'turn.start', sessionId: 'visual-running', turnId: 'turn-running',
    }));
    await expect(tab(page, 'Running agent').locator('.vtab-sub')).toHaveText('Hermes · Running');

    const finishedTerminal = await selectTab(page, 'Finished agent');
    await typeCommand(page, finishedTerminal, emitCommand({
      event: 'turn.start', sessionId: 'visual-finished', turnId: 'turn-finished',
    }));
    await expect(tab(page, 'Finished agent').locator('.vtab-sub')).toHaveText('Hermes · Running');
    const finishedId = await finishedTerminal.getAttribute('data-terminal-id');
    expect(finishedId).toBeTruthy();
    await typeCommand(page, finishedTerminal, gatedEmitCommand({
      event: 'turn.end', sessionId: 'visual-finished',
      turnId: 'turn-finished', outcome: 'succeeded',
    }));

    const exitedTerminal = await selectTab(page, 'Exited shell');
    await typeCommand(page, exitedTerminal, 'exit');
    await expect(tab(page, 'Exited shell').locator('.vtab-sub')).toHaveText('Exited', { timeout: 15_000 });

    await selectTab(page, 'Active workspace');
    await page.evaluate(({ id }) => window.janet.terminalWrite({ id, data: 'x\r', userInput: true }), {
      id: finishedId!,
    });
    await expect(tab(page, 'Finished agent').locator('.vtab-sub')).toHaveText('Hermes · Turn finished');

    const activeTerminals = page.locator('.terminal-container');
    await expect(activeTerminals).toHaveCount(2);
    await typeCommand(page, activeTerminals.nth(0), emitCommand({
      event: 'attention.request', sessionId: 'visual-active', turnId: 'turn-active',
    }));
    await expect(page.locator('.leaf-awareness.needs-input')).toHaveText('Hermes · Needs input');
    await typeCommand(page, activeTerminals.nth(0), 'cls');
    await typeCommand(page, activeTerminals.nth(1), 'cls');
    const failingCommand = process.platform === 'win32' ? 'test' : 'false';
    await typeCommand(page, activeTerminals.nth(1), failingCommand);
    await expect(page.locator('.terminal-command-failed')).toBeVisible({ timeout: 15_000 });

    const recipients = page.locator('.broadcast-recipient');
    await recipients.nth(0).check();
    await recipients.nth(1).check();
    await page.getByRole('alertdialog', { name: 'Start broadcast input?' })
      .getByRole('button', { name: 'Start broadcast input' }).click();
    await expect(page.locator('.terminal-leaf.broadcast-selected')).toHaveCount(2);
    await activeTerminals.nth(0).locator('.xterm-helper-textarea').focus();
    await expect(page.locator('.terminal-leaf').nth(0)).toHaveAttribute('aria-current', 'true');

    const reports = [];
    for (const theme of themes) {
      await switchTheme(page, theme);
      for (const viewport of viewports) {
        await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]?.setSize(
          size.width,
          size.height,
        ), viewport);
        await expect.poll(() => page.evaluate(() => ({ width: innerWidth, height: innerHeight })))
          .toEqual(viewport);
        if (viewport.width === 800) {
          const showTabs = page.getByRole('button', { name: 'Show terminal tabs' });
          if (await showTabs.isVisible()) await showTabs.click();
        }
        await expect.poll(async () => (
          await activeTerminals.nth(1).locator('.xterm-rows > div').allTextContents()
        ).some((row) => row.trimEnd().endsWith(failingCommand))).toBe(true);
        await tab(page, 'Active workspace').focus();
        await page.keyboard.press('Tab');
        await page.keyboard.press('Shift+Tab');
        await expect(tab(page, 'Active workspace')).toBeFocused();

        const report = await measureVisualState(page, `${theme}-${viewport.width}x${viewport.height}`);
        expect(report.document.bodyScrollWidth).toBeLessThanOrEqual(viewport.width);
        expect(report.document.rootScrollWidth).toBeLessThanOrEqual(viewport.width);
        expect(report.document.bodyScrollHeight).toBeLessThanOrEqual(viewport.height);
        expect(report.document.rootScrollHeight).toBeLessThanOrEqual(viewport.height);
        expect(report.regions.every(({ visible, insideViewport }) => visible && insideViewport)).toBe(true);
        expect(report.distinctions.activePaneShadow).not.toBe('none');
        expect(report.distinctions.broadcastOutlineStyle).toBe('solid');
        expect(parseFloat(report.distinctions.broadcastOutlineWidth)).toBeGreaterThanOrEqual(3);
        expect(report.distinctions.activeTabOutlineStyle).toBe('solid');
        expect(parseFloat(report.distinctions.activeTabOutlineWidth)).toBeGreaterThanOrEqual(2);
        expect(report.distinctions.activeTabBackground).not.toEqual(report.distinctions.inactiveTabBackground);
        expect(report.distinctions.failedMarkerBorder).toBe('2px');
        expect(report.contrastPairs.filter(({ ratio }) => ratio < 4.5)).toEqual([]);
        reports.push(report);

        const screenshot = testInfo.outputPath(`final-visual-matrix-${theme}-${viewport.width}x${viewport.height}.png`);
        await page.screenshot({ path: screenshot });
        await testInfo.attach(`final-visual-matrix-${theme}-${viewport.width}x${viewport.height}`, {
          path: screenshot,
          contentType: 'image/png',
        });

        const activeTab = tab(page, 'Active workspace');
        await activeTab.evaluate((element, point) => element.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: point.x,
          clientY: point.y,
        })), { x: viewport.width - 1, y: viewport.height - 1 });
        const menu = page.getByRole('menu', { name: 'Actions for Active workspace' });
        await expect(menu).toBeVisible();
        const menuBox = await menu.boundingBox();
        expect(menuBox).not.toBeNull();
        expect(menuBox!.x).toBeGreaterThanOrEqual(0);
        expect(menuBox!.y).toBeGreaterThanOrEqual(0);
        expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(viewport.width + 1);
        expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(viewport.height + 1);
        await expect(menu.getByRole('menuitem', { name: 'Rename tab' })).toBeFocused();
        await page.evaluate(() => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
        await expect(menu).toBeHidden();
        await expect(activeTab).toBeFocused();
        await expect(page.locator('.terminal-leaf.broadcast-selected')).toHaveCount(2);

        await activeTab.evaluate((element, point) => element.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: point.x,
          clientY: point.y,
        })), { x: viewport.width - 1, y: viewport.height - 1 });
        await expect(menu.getByRole('menuitem', { name: 'Rename tab' })).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(menu).toBeHidden();
        await expect(activeTab).toBeFocused();
        await expect(page.locator('.terminal-leaf.broadcast-selected')).toHaveCount(2);
      }
    }

    const reportPath = testInfo.outputPath('final-visual-matrix-geometry.json');
    fs.writeFileSync(reportPath, JSON.stringify(reports, null, 2), 'utf8');
    await testInfo.attach('final-visual-matrix-geometry', {
      path: reportPath,
      contentType: 'application/json',
    });
    const storedPageErrors = (await Promise.all([...observedPages].map(async (observedPage) => (
      (await observedPage.pageErrors({ filter: 'all' })).map((error) => error.message)
    )))).flat();
    expect([...pageErrors, ...storedPageErrors]).toEqual([]);
  } finally {
    await forceClose(app);
    fs.rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
