import { forceClose } from './electronLifecycle';
import { test, expect, _electron as electron, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getTheme, type ThemeName } from '../../src/renderer/themes';

// Design review captures of every surface (docs/design/liquid-glass.md, Review tooling). Opt-in and never part of CI:
//   JANET_DESIGN_CAPTURE=<run label> npx playwright test --config playwright.config.ts tests/e2e/design-captures.spec.ts
// The label names the output folder, e.g. `baseline` and `candidate` for scripts/design-style-diff.mjs.
const phase = process.env.JANET_DESIGN_CAPTURE;
const root = path.resolve(__dirname, '../..');
const themes: ThemeName[] = ['one-dark', 'solarized-light'];
const viewports = [{ width: 1440, height: 900 }, { width: 900, height: 640 }] as const;

// Output goes to test-results/design-captures/<label> unless JANET_DESIGN_OUT redirects it. JANET_DESIGN_STYLES=1 also dumps every
// element's computed style per surface, so a refactor can be proven style-identical with scripts/design-style-diff.mjs.
const outOverride = process.env.JANET_DESIGN_OUT;
const dumpStyles = process.env.JANET_DESIGN_STYLES === '1';
const themeFilter = process.env.JANET_DESIGN_THEMES?.split(',');
const viewportFilter = process.env.JANET_DESIGN_VIEWPORTS?.split(',');
// Page screenshots cannot show OS vibrancy (it composites outside the page), so reviews can pin a solid window.
const transparency = process.env.JANET_DESIGN_TRANSPARENCY;

test.skip(!phase || !/^[\w.-]+$/.test(phase), 'Set JANET_DESIGN_CAPTURE=<run label> to capture design review screenshots.');

/** Computed style of every element outside terminal/editor content, deduplicated into a style table. */
async function snapshotStyles(page: Page) {
  return page.evaluate(() => {
    // Settle hover/focus transitions so a mid-flight value is not mistaken for a style change.
    for (const animation of document.getAnimations()) {
      if (animation.effect?.getComputedTiming().iterations !== Infinity) animation.finish();
    }
    const skip = '.xterm-rows, .xterm-screen canvas, .xterm-accessibility, .xterm-helper-textarea, .composition-view, .view-lines, .monaco-editor .lines-content, .monaco-editor .margin-view-overlays, .monaco-aria-container, .monaco-scrollable-element > .scrollbar, .xterm-scrollable-element > .scrollbar';
    const geometry = /^(width|height|block-size|inline-size|top|bottom|left|right|inset-.*|perspective-origin|transform-origin)$/;
    const styles: string[] = [];
    const index = new Map<string, number>();
    const elements: Record<string, number> = {};
    const keyOf = (element: Element): string => {
      const parts: string[] = [];
      for (let current: Element | null = element; current && current !== document.documentElement; current = current.parentElement) {
        const parent: Element | null = current.parentElement;
        const position = parent ? Array.prototype.indexOf.call(parent.children, current) : 0;
        const label = current.getAttribute('aria-label') ?? '';
        parts.unshift(`${current.tagName.toLowerCase()}${label ? `[${label}]` : ''}:${position}`);
      }
      return parts.join('>');
    };
    const visit = (element: Element, pseudo?: string) => {
      const computed = getComputedStyle(element, pseudo);
      if (pseudo && (computed.content === 'none' || computed.content === 'normal')) return;
      // xterm sizes its scroll area from the scrollback length, and pane transition names carry random ids.
      const inTerminal = !!element.closest('.xterm');
      const declarations: string[] = [];
      for (let i = 0; i < computed.length; i += 1) {
        const name = computed[i];
        if (inTerminal && geometry.test(name)) continue;
        let value = computed.getPropertyValue(name);
        if (name === 'view-transition-name') value = value.replace(/-[a-z0-9]+-[a-z0-9]+$/, '');
        declarations.push(`${name}:${value}`);
      }
      const text = declarations.join(';');
      let id = index.get(text);
      if (id === undefined) { id = styles.length; styles.push(text); index.set(text, id); }
      elements[`${keyOf(element)}${pseudo ?? ''}`] = id;
    };
    for (const element of Array.from(document.querySelectorAll('*'))) {
      if (element.closest(skip)) continue;
      visit(element); visit(element, '::before'); visit(element, '::after');
    }
    const classes = [...new Set(Array.from(document.querySelectorAll('[class]'), (element) => element.getAttribute('class')!.trim()))];
    return { styles, elements, classes };
  });
}

function electronEnv(extra: NodeJS.ProcessEnv): Record<string, string> {
  const env = { ...process.env, ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

function createFixture(base: string): string {
  const project = path.join(base, 'janet-demo');
  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  fs.mkdirSync(path.join(project, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(project, 'README.md'), '# JaneT demo workspace\n');
  fs.writeFileSync(path.join(project, 'package.json'), '{\n  "name": "janet-demo",\n  "private": true\n}\n');
  fs.writeFileSync(path.join(project, 'src', 'app.ts'), "export const workspace = {\n  localShells: true,\n  splitPanes: 2,\n  status: 'draft',\n};\n");
  const git = (args: string[]) => execFileSync('git', args, { cwd: project, stdio: 'ignore' });
  git(['init', '-b', 'feature/workspace-presets']);
  git(['config', 'user.email', 'janet-demo@example.com']);
  git(['config', 'user.name', 'JaneT Demo']);
  git(['add', '.']);
  git(['commit', '-m', 'Create neutral demo workspace']);
  fs.writeFileSync(path.join(project, 'src', 'app.ts'), "export const workspace = {\n  localShells: true,\n  splitPanes: 2,\n  status: 'ready',\n};\n");
  fs.writeFileSync(path.join(project, 'docs', 'workspaces.md'), '# Saved workspaces\n');
  fs.writeFileSync(path.join(project, 'CHANGELOG.md'), '# Next\n');
  git(['add', '--', 'docs/workspaces.md']);
  return project;
}

function writeSettings(userData: string, project: string, theme: ThemeName): void {
  const leaf = (title: string) => ({ type: 'leaf', title, terminalType: 'local', cwd: project });
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({
    mainDirectory: userData, theme, fontSize: 13, sidebarSide: 'left', keybindings: {},
    ...(transparency ? { transparency } : {}),
    snippets: [{ id: 'demo-checks', name: 'Check demo workspace', content: 'git status -sb' }],
    notificationsEnabled: true, notificationThresholdSeconds: 10,
    session: {
      groups: [{ id: 'demo-library', name: 'Demo library', kind: 'folder', directory: project }],
      tabs: [
        { id: 'demo-workspace', groupId: 'demo-library', title: 'Demo workspace', type: 'local', cwd: project,
          root: { type: 'split', direction: 'vertical', sizes: [1, 1], children: [leaf('Workspace'), leaf('Checks')] },
          selectedPanePath: [0] },
        { id: 'command-demo', groupId: 'demo-library', title: 'Command demo', type: 'local', cwd: project, root: leaf('Commands') },
      ],
      activeTabId: 'demo-workspace', sidebarOpen: true, tabsOpen: true, sidebarSection: 'files',
    },
  }, null, 2));
}

async function runCommand(page: Page, terminal: Locator, command: string): Promise<void> {
  const textarea = terminal.locator('.xterm-helper-textarea');
  await expect(textarea).toHaveAttribute('data-shell-ready', 'true', { timeout: 20_000 });
  await textarea.focus();
  await page.keyboard.type(command, { delay: 2 });
  await page.keyboard.press('Enter');
}

for (const theme of themes.filter((name) => !themeFilter || themeFilter.includes(name))) {
  for (const viewport of viewports.filter((size) => !viewportFilter || viewportFilter.includes(`${size.width}x${size.height}`))) {
    test(`captures ${phase ?? 'design review'} surfaces for ${theme} at ${viewport.width}x${viewport.height}`, async () => {
      test.setTimeout(180_000);
      // Fixed, owned path so the status bar shows a synthetic location instead of a per-user temp dir.
      const base = path.join(fs.realpathSync(os.tmpdir() === '/tmp' || process.platform !== 'darwin' ? os.tmpdir() : '/tmp'), 'JaneT-Design');
      const marker = path.join(base, '.janet-design-capture');
      if (fs.existsSync(base)) {
        if (!fs.existsSync(marker)) throw new Error(`Refusing to remove unowned path ${base}`);
        fs.rmSync(base, { recursive: true, force: true });
      }
      fs.mkdirSync(base);
      fs.writeFileSync(marker, 'Owned by tests/e2e/design-captures.spec.ts\n');
      const userData = path.join(base, 'profile');
      const home = path.join(base, 'home');
      fs.mkdirSync(userData);
      fs.mkdirSync(home);
      // Synthetic shell identity: no real user, host or dotfiles in published images.
      fs.writeFileSync(path.join(home, '.zshrc'), "PROMPT='demo@janet %1~ %% '\n");
      fs.writeFileSync(path.join(home, '.bashrc'), "PS1='demo@janet \\W $ '\n");
      const project = createFixture(base);
      writeSettings(userData, project, theme);
      const outDir = outOverride ? path.resolve(root, outOverride, phase!) : path.join(root, 'test-results', 'design-captures', phase!);
      fs.mkdirSync(outDir, { recursive: true });
      const suffix = `${theme}-${viewport.width}x${viewport.height}`;
      const failures: string[] = [];
      let app: ElectronApplication | undefined;
      const shot = async (name: string, target: Page | Locator) => {
        await expect(page.locator('.motion-presence[data-motion-state="closing"]')).toHaveCount(0);
        await (target as Page).screenshot({ path: path.join(outDir, `${name}--${suffix}.png`), animations: 'disabled', caret: 'hide' });
        if (dumpStyles) fs.writeFileSync(path.join(outDir, `${name}--${suffix}.styles.json`), JSON.stringify(await snapshotStyles(page)));
      };
      const step = async (name: string, body: () => Promise<void>) => {
        try { await body(); } catch (error) { failures.push(`${name}: ${(error as Error).message.split('\n')[0]}`); await page.keyboard.press('Escape').catch(() => {}); }
      };
      let page!: Page;
      try {
        app = await electron.launch({ args: ['.'], cwd: root, env: electronEnv({ NODE_ENV: 'test', JANET_E2E_USER_DATA_DIR: userData, HOME: home, ZDOTDIR: '' }) });
        page = await app.firstWindow();
        await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim()))
          .toBe(getTheme(theme).css['bg-primary']);
        await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height), viewport);
        await expect.poll(() => page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual(viewport);
        // Results finished while the window is unfocused count as unread; OS focus at launch is a race.
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
        await expect.poll(() => page.evaluate(() => window.janet.isWindowFocused())).toBe(true);
        await page.addStyleTag({ content: '.xterm-cursor, .status-version { visibility: hidden !important; }' });
        const terminals = page.locator('.terminal-container');
        await expect(terminals).toHaveCount(2, { timeout: 20_000 });
        await runCommand(page, terminals.nth(0), 'clear; git status -sb');
        await runCommand(page, terminals.nth(1), 'clear; ls -1');
        await expect(terminals.nth(0).locator('.xterm-rows')).toContainText('workspace-presets', { timeout: 20_000 });
        await expect(terminals.nth(1).locator('.xterm-rows')).toContainText('README.md', { timeout: 20_000 });
        await expect(page.locator('.activity-count.finished')).toHaveCount(0);
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await shot('01-workspace', page);

        await step('pane-hover', async () => {
          await page.getByLabel('Checks heading', { exact: true }).hover();
          await shot('02-pane-header-hover', page);
        });
        await step('pane-menu', async () => {
          await page.getByLabel('Workspace heading', { exact: true }).click({ button: 'right' });
          await expect(page.getByRole('menuitem', { name: 'Rename', exact: true })).toBeVisible();
          await shot('03-pane-context-menu', page);
          await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
          await expect(page.getByRole('dialog')).toBeVisible();
          await shot('04-rename-dialog', page);
          await page.keyboard.press('Escape');
        });
        await step('add-terminals', async () => {
          await page.getByRole('button', { name: 'Add terminals' }).first().click();
          await expect(page.getByRole('button', { name: 'Close add terminals' })).toBeVisible();
          await shot('05-add-terminals', page);
          await page.getByRole('button', { name: 'Close add terminals' }).click();
        });
        await step('maximize', async () => {
          await page.getByRole('button', { name: /Maximize pane — Workspace/ }).click();
          await page.waitForFunction(() => document.querySelectorAll('.terminal-leaf').length >= 1);
          await shot('06-pane-maximized', page);
          await page.getByRole('button', { name: /Restore pane — Workspace|Restore/ }).first().click();
        });
        await step('search', async () => {
          await page.getByRole('button', { name: /^Open command palette/ }).click();
          await page.getByRole('option', { name: /Search terminal output/ }).click();
          await page.getByRole('textbox', { name: 'Search terminal output' }).fill('README');
          await shot('07-terminal-search', page);
          await page.getByRole('button', { name: 'Close search' }).click();
        });
        const showTabs = page.getByRole('button', { name: 'Show terminal tabs' });
        const ensureTabs = async () => { if (await showTabs.count()) await showTabs.click(); };
        const palette = () => page.getByRole('button', { name: /^Open command palette/ }).click();
        await step('palette', async () => {
          await palette();
          await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
          await shot('08-command-palette', page);
          await page.keyboard.type('theme');
          await shot('09-command-palette-filtered', page);
          await page.keyboard.press('Escape');
        });
        await step('snippets', async () => {
          await palette();
          await page.getByRole('option', { name: /Open snippets/ }).click();
          await expect(page.getByRole('dialog', { name: 'Snippets' })).toBeVisible();
          await shot('10-snippets', page);
          await page.keyboard.press('Escape');
        });
        await step('history', async () => {
          await palette();
          await page.getByRole('option', { name: /Open command history/ }).click();
          await expect(page.getByRole('dialog', { name: 'Command history' })).toBeVisible();
          await shot('11-command-history', page);
          await page.getByRole('button', { name: 'Close command history' }).click();
        });
        await step('settings', async () => {
          await page.getByRole('button', { name: 'Open settings' }).click();
          await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
          await shot('12-settings', page);
          await page.getByRole('button', { name: 'Keyboard shortcuts' }).click();
          await expect(page.getByRole('button', { name: 'Close keyboard shortcuts' })).toBeVisible();
          await shot('13-keyboard-shortcuts', page);
          await page.getByRole('button', { name: 'Close keyboard shortcuts' }).click();
        });
        await step('workspace-creation', async () => {
          await ensureTabs();
          await page.getByRole('button', { name: 'New workspace', exact: true }).click();
          await expect(page.getByRole('dialog', { name: 'Create workspace' })).toBeVisible();
          await shot('14-workspace-creation', page);
          await page.getByRole('button', { name: 'Close creation dialog' }).click();
        });
        await step('project-creation', async () => {
          await ensureTabs();
          await page.getByRole('button', { name: 'Demo library', exact: true }).click({ button: 'right' });
          await expect(page.getByRole('menuitem', { name: 'Add project' })).toBeVisible();
          await shot('15-workspace-context-menu', page);
          await page.getByRole('menuitem', { name: 'Add project' }).click();
          await expect(page.locator('.project-creation-content')).toBeVisible();
          await shot('16-project-creation', page);
          await page.getByRole('button', { name: 'Cancel' }).click();
        });
        await step('main-directory', async () => {
          await ensureTabs();
          await page.getByRole('button', { name: 'Main directory settings' }).click();
          await expect(page.getByRole('dialog', { name: 'Main directory settings' })).toBeVisible();
          await shot('17-main-directory', page);
          await page.getByRole('button', { name: 'Close main directory settings' }).click();
        });
        await step('tooltip', async () => {
          await ensureTabs();
          await page.getByRole('button', { name: 'New workspace', exact: true }).hover();
          await expect(page.getByRole('tooltip')).toBeVisible();
          await shot('18-tooltip', page);
          await page.mouse.move(viewport.width / 2, viewport.height / 2);
        });
        await step('explorer-editor', async () => {
          await page.getByRole('tab', { name: 'Explorer' }).click();
          await page.getByRole('button', { name: 'Open folder src' }).click();
          await shot('19-file-explorer', page);
          await page.getByRole('button', { name: 'Open file app.ts' }).click();
          await expect(page.locator('.monaco-editor-host')).toContainText("status: 'ready'", { timeout: 20_000 });
          // Text renders before the tokenizer colours it; capture the highlighted editor.
          await expect.poll(() => page.locator('.monaco-editor-host .view-line span span')
            .evaluateAll(spans => new Set(spans.map(span => getComputedStyle(span).color)).size), { timeout: 10_000 }).toBeGreaterThan(3);
          await shot('20-editor', page);
          await page.getByRole('tab', { name: 'Terminal', exact: true }).click();
        });
        await step('source-control', async () => {
          await page.getByRole('tab', { name: 'Source Control' }).click();
          await expect(page.locator('.git-tree').getByText('Staged Changes')).toBeVisible({ timeout: 20_000 });
          await shot('21-source-control', page);
          await page.locator('.git-tree').getByText('app.ts', { exact: true }).click();
          await expect(page.locator('.monaco-diff-editor, .monaco-diff-host, .monaco-editor-host').first()).toBeVisible({ timeout: 20_000 });
          await shot('22-diff-editor', page);
          await page.getByRole('tab', { name: 'Terminal', exact: true }).click();
        });
        await step('collapsed-chrome', async () => {
          await page.getByRole('button', { name: 'Collapse project tools' }).click();
          await page.getByRole('button', { name: 'Collapse terminal tabs' }).click();
          await shot('23-chrome-collapsed', page);
        });
        await step('single-pane-tab', async () => {
          await ensureTabs();
          await page.locator('.vtab-item', { hasText: 'Command demo' }).click();
          await shot('24-single-pane-tab', page);
        });
      } finally {
        await forceClose(app);
        fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
      if (failures.length) console.warn(`Design capture gaps (${suffix}):\n  ${failures.join('\n  ')}`);
    });
  }
}
