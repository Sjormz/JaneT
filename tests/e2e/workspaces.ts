import type { Page } from '@playwright/test';

export async function createWorkspace(page: Page, name: string, terminals: Array<{
  title?: string; cwd?: string; sshLabel?: string; commands?: string[];
}>, newGroup?: string) {
  await page.getByRole('button', { name: 'New workspace or project' }).click();
  if (newGroup) {
    await page.getByRole('textbox', { name: 'Workspace name' }).fill(newGroup);
    await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
    await page.getByRole('button', { name: `New project in ${newGroup}`, exact: true }).click();
  } else {
    await page.getByRole('button', { name: 'Project', exact: true }).click();
  }
  await page.getByRole('textbox', { name: 'Project name' }).fill(name);
  await page.getByRole('combobox', { name: 'Initial terminals' }).selectOption(String(terminals.length));
  for (const [index, terminal] of terminals.entries()) {
    const label = `Terminal ${index + 1}`;
    if (terminal.title) await page.getByRole('textbox', { name: `${label} name (optional)` }).fill(terminal.title);
    if (terminal.sshLabel) {
      await page.getByRole('group', { name: `${label} type` }).getByRole('button', { name: 'SSH connection' }).click();
      await page.getByRole('button', { name: `${label} SSH profile` }).click();
      await page.getByRole('option', { name: terminal.sshLabel, exact: true }).click();
    } else if (terminal.cwd) await page.getByRole('textbox', { name: `${label} directory` }).fill(terminal.cwd);
    if (terminal.commands?.length) {
      const configuration = page.getByRole('group', { name: `${label} configuration` });
      await configuration.getByRole('button', { name: /Startup commands/ }).click();
      for (const [commandIndex, command] of terminal.commands.entries()) {
        await configuration.getByRole('button', { name: 'Add command', exact: true }).click();
        await page.getByRole('textbox', { name: `${label} startup command ${commandIndex + 1}`, exact: true }).fill(command);
      }
    }
  }
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
}
