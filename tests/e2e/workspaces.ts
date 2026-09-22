import { expect, type Page } from '@playwright/test';
import { createWorkspaceRoot } from '../../src/renderer/types';
import { serializePaneTree } from '../../src/renderer/sessionRestore';

export function terminalSettings(directory: string) {
  return { mainDirectory: directory, session: {
    groups: [{ id: 'fixture-library', name: 'Test library', kind: 'folder', directory }],
    tabs: [{ id: 'fixture-session', groupId: 'fixture-library', title: 'Terminal', type: 'local', cwd: directory,
      root: { type: 'leaf', cwd: directory } }],
    activeTabId: 'fixture-session', sidebarOpen: true, tabsOpen: true, sidebarSection: 'files',
  } };
}

export async function ensureProjectTerminalsOpen(page: Page) {
  const terminalCount = page.getByRole('spinbutton', { name: 'Initial terminals' });
  if (await terminalCount.count() === 0) {
    await page.getByRole('button', { name: /Add terminals/ }).click();
  }
  await expect(terminalCount).toBeVisible();
}

export async function createWorkspace(page: Page, name: string, terminals: Array<{
  title?: string; cwd?: string; commands?: string[];
}>, newGroup?: string) {
  if (newGroup) {
    await page.getByRole('button', { name: 'New workspace', exact: true }).click();
    await page.getByRole('textbox', { name: 'Workspace name' }).fill(newGroup);
    await page.getByRole('dialog', { name: 'Create workspace', exact: true }).getByRole('button', { name: 'Create workspace', exact: true }).click();
    await page.getByRole('button', { name: newGroup, exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Add project', exact: true }).click();
  } else {
    await page.locator('.workspace-group-toggle').first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Add project', exact: true }).click();
  }
  await page.getByRole('textbox', { name: 'Project name' }).fill(name);
  await ensureProjectTerminalsOpen(page);
  await page.getByRole('spinbutton', { name: 'Initial terminals' }).fill(String(terminals.length));
  await page.getByRole('radio', { name: 'Custom', exact: true }).check();
  await page.getByRole('textbox', { name: 'Custom command' }).fill('echo JANET_STARTUP_READY');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
}

// Seed per-pane commands and unavailable paths directly; creation uses shared local setup.
export async function restoreWorkspaceFixture(page: Page, name: string, terminals: Array<{
  title?: string; cwd?: string; commands?: string[];
}>, groupName?: string) {
  const settings = await page.evaluate(() => window.janet.getSettings());
  const root = serializePaneTree(createWorkspaceRoot(terminals.map((terminal) => ({
    type: 'local' as const,
    title: terminal.title,
    cwd: terminal.cwd,
    startupCommands: terminal.commands,
  }))), {}, { includeStartupCommands: true });
  const session = settings.session;
  const groups = session?.groups?.length ? session.groups : [{ id: 'fixture-group', name: groupName ?? 'Test work' }];
  // Freeze the old renderer's debounced autosave until reload discards it.
  await page.clock.pauseAt(new Date());
  try {
    await page.evaluate(async ({ session, groups, root, name }) => {
      await window.janet.setSettings({ session: { ...session, groups,
        tabs: [...(session?.tabs ?? []).filter((tab: any) => tab.id !== 'fixture-restored'), { id: 'fixture-restored', title: name, groupId: groups[0].id, type: 'local', root }],
        activeTabId: 'fixture-restored', tabsOpen: true,
      } });
    }, { session, groups, root, name });
    await page.reload({ waitUntil: 'domcontentloaded' });
  } finally {
    await page.clock.resume();
  }
  await expect(page.locator('.vtab-name').getByText(name, { exact: true })).toBeVisible();
}
