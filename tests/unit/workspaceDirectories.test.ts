import { afterEach, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createWorkspaceDirectory, requireDirectory } from '../../src/main/workspaceDirectories';

const roots: string[] = [];
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
