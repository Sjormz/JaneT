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

export async function createWorkspace(page: Page, name: string, terminals: Array<{
  title?: string; cwd?: string; sshLabel?: string; commands?: string[];
}>, newGroup?: string) {
  if (newGroup) {
    await page.getByRole('button', { name: 'New workspace', exact: true }).click();
    await page.getByRole('textbox', { name: 'Workspace name' }).fill(newGroup);
    await page.getByRole('dialog', { name: 'Create workspace', exact: true }).getByRole('button', { name: 'Create workspace', exact: true }).click();
    await page.getByRole('button', { name: `Add project to ${newGroup}`, exact: true }).click();
  } else {
    await page.getByRole('button', { name: /^Add project to / }).first().click();
  }
  await page.getByRole('textbox', { name: 'Project name' }).fill(name);
  await page.getByRole('button', { name: /Add terminals/ }).click();
  await page.getByRole('spinbutton', { name: 'Initial terminals' }).fill(String(terminals.length));
  await page.getByRole('radio', { name: 'Custom', exact: true }).check();
  await page.getByRole('textbox', { name: 'Custom command' }).fill('echo');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
}

// Legacy SSH, per-pane commands, and unavailable paths remain supported on restore.
// Seed those fixtures directly now that the creation form only offers shared local setup.
export async function restoreWorkspaceFixture(page: Page, name: string, terminals: Array<{
  title?: string; cwd?: string; sshLabel?: string; commands?: string[];
}>, groupName?: string) {
  const settings = await page.evaluate(() => window.janet.getSettings());
  const profiles = settings.sshProfiles ?? [];
  const root = serializePaneTree(createWorkspaceRoot(terminals.map((terminal) => ({
    type: terminal.sshLabel ? 'ssh' as const : 'local' as const,
    title: terminal.title,
    cwd: terminal.cwd,
    sshProfileId: terminal.sshLabel ? profiles.find((profile: any) =>
      (profile.username ? profile.username + '@' : '') + profile.host + ':' + profile.port === terminal.sshLabel)?.id : undefined,
    startupCommands: terminal.commands,
  }))), {}, { includeStartupCommands: true });
  const session = settings.session;
  const groups = session?.groups?.length ? session.groups : [{ id: 'fixture-group', name: groupName ?? 'Test work' }];
  await page.evaluate(async ({ session, groups, root, name }) => {
    await window.janet.setSettings({ session: { ...session, groups,
      tabs: [...(session?.tabs ?? []).filter((tab: any) => tab.id !== 'fixture-restored'), { id: 'fixture-restored', title: name, groupId: groups[0].id, type: 'local', root }],
      activeTabId: 'fixture-restored', tabsOpen: true,
    } });
    location.reload();
  }, { session, groups, root, name });
  await expect(page.locator('.vtab-name').getByText(name, { exact: true })).toBeVisible();
}
