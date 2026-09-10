import { forceClose } from './electronLifecycle';
import { test, expect, _electron as electron, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getTheme, themeNames, type ThemeName } from '../../src/renderer/themes';

const root = path.resolve(__dirname, '../..');
const agentHarness = path.join(root, 'tests/e2e/helpers/visual-agent.cjs');
const neutralCwd = process.env.SystemRoot ?? root;
const themes = themeNames;
const viewports = [{ width: 1280, height: 800 }, { width: 800, height: 600 }] as const;

function electronEnv(extra: NodeJS.ProcessEnv): Record<string, string> {
  const env = { ...process.env, ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
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
  return `node "${agentHarness}" ${encoded}`;
}

function gatedEmitCommand(event: Record<string, unknown>): string {
  const encoded = Buffer.from(agentSequence(event)).toString('base64');
  const started = Buffer.from(agentSequence({ event: 'turn.start', sessionId: event.sessionId, turnId: event.turnId })).toString('base64');
  return `node "${agentHarness}" ${started} ${encoded}`;
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

async function switchTheme(page: Page, theme: ThemeName): Promise<void> {
  await page.getByRole('button', { name: 'Open settings' }).click();
  const definition = getTheme(theme);
  const label = definition.label;
  await page.getByRole('button', { name: label, exact: true }).click();
  await page.getByRole('button', { name: 'Hide settings' }).click();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement)
    .getPropertyValue('--bg-primary').trim())).toBe(definition.css['bg-primary']);
}

async function measureVisualState(page: Page, name: string) {
  return page.evaluate((stateName) => {
    const visibleElement = (selector: string) => Array.from(document.querySelectorAll<HTMLElement>(selector))
      .find((element) => element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))!;
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
      const element = visibleElement(selector);
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
      '.status-bar', '.broadcast-input-banner', '.activity-count.running', '.activity-count.finished',
      '.vtab-item:has(.activity-dot.exited) .vtab-name', '.vtab-item:has(.activity-dot.disconnected) .vtab-name', '.leaf-awareness.needs-input',
      '.terminal-command-failed',
    ];
    const regions = keySelectors.map((selector) => {
      const element = visibleElement(selector);
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
    const failedMarker = visibleElement('.terminal-command-failed');
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
        workspaceToolsOverflowY: getComputedStyle(document.querySelector<HTMLElement>('.workspace-tools-panel')!).overflowY,
        explorerOverflowY: getComputedStyle(document.querySelector<HTMLElement>('.explorer-tree')!).overflowY,
        verticalDividerWidth: getComputedStyle(document.querySelector<HTMLElement>('.split-divider-vertical')!).width,
        horizontalDividerHeight: getComputedStyle(document.querySelector<HTMLElement>('.split-divider-horizontal')!).height,
        workspaceMainPadding: getComputedStyle(document.querySelector<HTMLElement>('.workspace-main')!).paddingTop,
        terminalLeafBorderWidth: getComputedStyle(document.querySelector<HTMLElement>('.terminal-leaf')!).borderTopWidth,
        terminalTracks: Array.from(document.querySelectorAll<HTMLElement>('.terminal-container')).map((container) => ({
          track: getComputedStyle(container.querySelector<HTMLElement>('.xterm-scrollable-element')!).backgroundColor,
          canvas: getComputedStyle(container).backgroundColor,
          outerOverflow: getComputedStyle(container).overflowY,
        })),
      },
      contrastPairs: [
        contrast('.activity-count.running'),
        contrast('.activity-count.finished'),
        contrast('.vtab-item:has(.activity-dot.exited) .vtab-name'),
        contrast('.vtab-item:has(.activity-dot.disconnected) .vtab-name'),
        contrast('.leaf-awareness.needs-input'),
        contrast('.terminal-leaf.broadcast-selected .leaf-title'),
        contrast('.broadcast-input-banner strong'),
      ],
    };
  }, name);
}

test('checks every built-in theme in the Electron visual matrix', async ({}, testInfo) => {
  test.setTimeout(120_000);
  const userData = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'janet-final-visual-e2e-'));
  const pageErrors: string[] = [];
  let app: ElectronApplication | undefined;

  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ mainDirectory: userData,
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
              {
                type: 'split', direction: 'horizontal', sizes: [1, 1],
                children: [
                  { type: 'leaf', title: 'Failed command', terminalType: 'local', cwd: neutralCwd },
                  { type: 'leaf', title: 'Stacked pane', terminalType: 'local', cwd: neutralCwd },
                ],
              },
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
    await expect(tab(page, 'Disconnected SSH')).toHaveAttribute('aria-label', /SSH disconnected/);

    const runningTerminal = await selectTab(page, 'Running agent');
    await typeCommand(page, runningTerminal, emitCommand({
      event: 'turn.start', sessionId: 'visual-running', turnId: 'turn-running',
    }));
    await expect(tab(page, 'Running agent')).toHaveAttribute('aria-label', /Hermes · Running/);

    const finishedTerminal = await selectTab(page, 'Finished agent');
    const finishedId = await finishedTerminal.getAttribute('data-terminal-id');
    expect(finishedId).toBeTruthy();
    await typeCommand(page, finishedTerminal, gatedEmitCommand({
      event: 'turn.end', sessionId: 'visual-finished',
      turnId: 'turn-finished', outcome: 'succeeded',
    }));
    await expect(tab(page, 'Finished agent')).toHaveAttribute('aria-label', /Hermes · Running/);

    const exitedTerminal = await selectTab(page, 'Exited shell');
    await typeCommand(page, exitedTerminal, 'exit');
    await expect(tab(page, 'Exited shell')).toHaveAttribute('aria-label', /Exited/, { timeout: 15_000 });

    await selectTab(page, 'Active workspace');
    await page.evaluate(({ id }) => window.janet.terminalWrite({ id, data: 'x\r', userInput: true }), {
      id: finishedId!,
    });
    await expect(tab(page, 'Finished agent')).toHaveAttribute('aria-label', /Hermes · Turn finished/);

    const activeTerminals = page.locator('.terminal-container');
    await expect(activeTerminals).toHaveCount(3);
    const clearCommand = process.platform === 'win32' ? 'cls' : 'clear';
    await typeCommand(page, activeTerminals.nth(0), clearCommand);
    await typeCommand(page, activeTerminals.nth(0), emitCommand({
      event: 'attention.request', sessionId: 'visual-active', turnId: 'turn-active',
    }));
    await expect(page.locator('.leaf-awareness.needs-input')).toHaveText('Hermes · Needs input');
    await typeCommand(page, activeTerminals.nth(1), clearCommand);
    // Keep input short on both platforms so its start marker survives the smallest pane.
    const failingCommand = process.platform === 'win32' ? 'cmd /c exit 1' : 'false';
    await typeCommand(page, activeTerminals.nth(1), failingCommand);
    await expect(activeTerminals.nth(1).locator('.terminal-command-failed'))
      .toHaveCount(1, { timeout: 15_000 });

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
          await expect(showTabs).toBeVisible();
          await showTabs.click();
        }
        // Bash redraws its prompt on resize; repeated reflows can scroll the old
        // command marker out of view. Keep this visual fixture in the viewport.
        const markerSuffix = `${themes.indexOf(theme)}-${viewport.width}`;
        const marker = `V${markerSuffix}`;
        await page.evaluate(({ id, command }) => window.janet.terminalWrite({
          id, data: `${command}\r`, userInput: true,
        }), {
          id: (await activeTerminals.nth(1).getAttribute('data-terminal-id'))!,
          command: process.platform === 'win32'
            ? `echo ('V'+'${markerSuffix}');${failingCommand}`
            : `printf 'V%s\\n' '${markerSuffix}'; ${failingCommand}`,
        });
        await expect(activeTerminals.nth(1).locator('.xterm-rows')).toContainText(marker);
        await expect(page.locator('.terminal-leaf').nth(1).locator('.leaf-awareness')).toHaveText('Shell · Ready');
        await expect(activeTerminals.nth(1).locator('.terminal-command-failed:visible').first()).toBeVisible();
        await tab(page, 'Active workspace').focus();
        await page.keyboard.press('Tab');
        await page.keyboard.press('Shift+Tab');
        await expect(tab(page, 'Active workspace')).toBeFocused();

        const report = await measureVisualState(page, `${theme}-${viewport.width}x${viewport.height}`);
        const chrome = await page.evaluate(() => {
          const brand = document.querySelector('.titlebar-brand')!.getBoundingClientRect();
          const command = document.querySelector('.titlebar-palette-btn')!.getBoundingClientRect();
          const controls = document.querySelector('.titlebar-right')!.getBoundingClientRect();
          return {
            separated: brand.right < command.left && command.right < controls.left,
            height: document.querySelector('.titlebar')!.getBoundingClientRect().height,
            commandDrag: getComputedStyle(document.querySelector('.titlebar-palette-btn')!).getPropertyValue('-webkit-app-region'),
            footerHeight: document.querySelector('.status-bar')!.getBoundingClientRect().height,
          };
        });
        expect(chrome.separated).toBe(true);
        expect(chrome.height).toBe(54);
        expect(chrome.footerHeight).toBe(28);
        expect(chrome.commandDrag).toBe('no-drag');
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
        expect(report.distinctions.workspaceToolsOverflowY).toBe('hidden');
        expect(report.distinctions.explorerOverflowY).toBe('auto');
        expect(parseFloat(report.distinctions.verticalDividerWidth)).toBeGreaterThanOrEqual(12);
        expect(parseFloat(report.distinctions.horizontalDividerHeight)).toBeGreaterThanOrEqual(12);
        expect(report.distinctions.workspaceMainPadding).toBe('0px');
        expect(report.distinctions.terminalLeafBorderWidth).toBe('1px');
        for (const track of report.distinctions.terminalTracks) {
          expect(track.track).toBe(track.canvas);
          expect(['auto', 'scroll']).not.toContain(track.outerOverflow);
        }
        expect(report.contrastPairs.filter(({ ratio }) => ratio < 7)).toEqual([]);
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
        await expect(menu.getByRole('menuitem', { name: 'Rename session' })).toBeFocused();
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
        await expect(menu.getByRole('menuitem', { name: 'Rename session' })).toBeFocused();
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
