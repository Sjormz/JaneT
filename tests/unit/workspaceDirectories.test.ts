import { afterEach, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createWorkspaceDirectory, requireDirectory, renameWorkspaceDirectory } from '../../src/main/workspaceDirectories';
import { rebaseDirectory } from '../../src/shared/workspaceGroups';

const roots: string[] = [];
it('renames real folders, keeps descendants, and rejects invalid names, collisions, and links', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'janet-rename-')); roots.push(root);
  const source = await createWorkspaceDirectory(root, 'Before');
  await fs.mkdir(path.join(source, 'Project'));
  await fs.writeFile(path.join(source, 'Project', 'keep.txt'), 'keep');
  await createWorkspaceDirectory(root, 'Occupied');
  for (const name of ['CON', 'COM¹', 'LPT².txt', '../escape', 'bad?', 'tail ', 'tail.']) {
    await expect(renameWorkspaceDirectory(source, name)).rejects.toThrow('folder name');
  }
  await expect(renameWorkspaceDirectory(source, 'Occupied')).rejects.toThrow('already exists');
  const target = await renameWorkspaceDirectory(source, 'After');
  expect(await fs.readFile(path.join(target, 'Project', 'keep.txt'), 'utf8')).toBe('keep');
  await expect(fs.stat(source)).rejects.toMatchObject({ code: 'ENOENT' });
  const linked = path.join(root, 'link');
  await fs.symlink(target, linked, process.platform === 'win32' ? 'junction' : 'dir');
  await expect(renameWorkspaceDirectory(linked, 'Not allowed')).rejects.toThrow('linked');
  if (process.platform === 'win32') expect(await renameWorkspaceDirectory(target, 'AFTER')).toBe(path.join(root, 'AFTER'));
  expect(rebaseDirectory('C:\\Work\\Old\\Project', 'c:\\work\\old', 'C:\\Work\\New')).toBe('C:\\Work\\New\\Project');
  expect(rebaseDirectory('/work/older/file', '/work/old', '/work/new')).toBe('/work/older/file');
  expect(rebaseDirectory('/work/old/file', '/work/old', '/work/new')).toBe('/work/new/file');
});
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
it('creates managed folders without merging existing data or escaping the chosen parent', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'janet-directories-')); roots.push(root);
  const group = await createWorkspaceDirectory(root, 'Research');
  const workspace = await createWorkspaceDirectory(group, 'Experiment A');
  expect(await requireDirectory(workspace)).toBe(await fs.realpath(workspace));
  await fs.writeFile(path.join(workspace, 'keep.txt'), 'keep');
  await expect(createWorkspaceDirectory(group, 'Experiment A')).rejects.toThrow('already exists');
  for (const name of ['../escape', '..', 'a/b', 'a\\b', 'CON', 'nul.txt', 'tail.', 'tail ', '', 'a'.repeat(129)]) {
    await expect(createWorkspaceDirectory(root, name)).rejects.toThrow('folder name');
  }
  expect(await fs.readFile(path.join(workspace, 'keep.txt'), 'utf8')).toBe('keep');
  await expect(requireDirectory(path.join(root, 'missing'))).rejects.toThrow('Locate');
  await expect(requireDirectory(path.join(workspace, 'keep.txt'))).rejects.toThrow('Locate');
  await expect(requireDirectory('relative')).rejects.toThrow('absolute');
  await fs.symlink(workspace, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await expect(createWorkspaceDirectory(root, 'linked')).rejects.toThrow('already exists');
});
