import { expect, type Page } from '@playwright/test';
import { createWorkspaceRoot } from '../../src/renderer/types';
import { normalizeSession, serializePaneTree } from '../../src/renderer/sessionRestore';

export function terminalSettings(directory: string) {
  return { mainDirectory: directory, session: {
    groups: [{ id: 'fixture-library', name: 'Test library', kind: 'folder', directory }],
    tabs: [{ id: 'fixture-session', groupId: 'fixture-library', title: 'Terminal', type: 'local', isProject: true, cwd: directory,
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

// Build per-pane commands and unavailable paths for a stopped test app.
export function workspaceFixture(settings: any, name: string, terminals: Array<{
  title?: string; cwd?: string; commands?: string[];
}>, groupName?: string) {
  const root = serializePaneTree(createWorkspaceRoot(terminals.map((terminal) => ({
    type: 'local' as const,
    title: terminal.title,
    cwd: terminal.cwd,
    startupCommands: terminal.commands,
  }))), {}, { includeStartupCommands: true });
  const session = normalizeSession(settings.session);
  const groups = session?.groups?.length ? session.groups : [{ id: 'fixture-group', name: groupName ?? 'Test work' }];
  return { ...settings, session: { ...session, groups,
    tabs: [...(session?.tabs ?? []).filter((tab: any) => tab.id !== 'fixture-restored'), { id: 'fixture-restored', title: name, groupId: groups[0].id, type: 'local', isProject: true, root }],
    activeTabId: 'fixture-restored', tabsOpen: true,
  } };
}
