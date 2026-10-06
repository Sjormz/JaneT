import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceFileOperations, assertManagedFolderRename } from '../../src/main/workspaceFileOperations';
import type { AppSettings, SavedSession } from '../../src/main/settings';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'janet-library-unit-')); roots.push(root);
  const main = path.join(root, 'Temporary');
  const workspace = path.join(main, 'Work');
  const project = path.join(workspace, 'Experiment');
  const library = path.join(root, 'Permanent');
  await fs.mkdir(project, { recursive: true }); await fs.mkdir(library);
  await fs.mkdir(path.join(project, '.git'));
  await fs.writeFile(path.join(project, '.git', 'config'), 'repo');
  await fs.writeFile(path.join(project, 'keep.txt'), 'important');
  let session: SavedSession = { groups: [{ id: 'work', name: 'Work', directory: workspace }],
    tabs: [{ id: 'project', title: 'Experiment', groupId: 'work', type: 'local', isProject: true, cwd: project, root: { type: 'leaf', cwd: project } }],
    activeTabId: 'project', sidebarOpen: true, tabsOpen: true, sidebarSection: 'files' };
  const trash = vi.fn(async (source: string) => { await fs.rename(source, path.join(root, 'recycled')); });
  const setSession = vi.fn((next: SavedSession) => { session = next; });
  const dependencies = { getSettings: () => ({ session, mainDirectory: main }) as AppSettings,
    setSession, trash, release: vi.fn(), protectedPaths: [root] };
  return { root, main, workspace, project, library, dependencies, get session() { return session; },
    operations: new WorkspaceFileOperations(dependencies) };
}

describe('temporary workspace file operations', () => {
  it('keeps a verified project and hidden repo files in Library before recycling its original', async () => {
    const f = await fixture();
    const result = await f.operations.run({ action: 'keep', groupId: 'work', projectId: 'project', destinationParent: f.library });
    const target = path.join(f.library, 'Experiment');
    expect(await fs.readFile(path.join(target, '.git/config'), 'utf8')).toBe('repo');
    expect(await fs.readFile(path.join(target, 'keep.txt'), 'utf8')).toBe('important');
    expect(result.session.groups?.[1]).toMatchObject({ kind: 'folder', directory: target });
    expect(result.session.tabs[0]).toMatchObject({ cwd: target, root: { cwd: target } });
    expect(f.dependencies.setSession.mock.invocationCallOrder[0]).toBeLessThan(f.dependencies.trash.mock.invocationCallOrder[0]);
    await expect(fs.stat(f.project)).rejects.toThrow();
  });
  it.each([false, true])('recycles a project or whole workspace only on explicit delete (workspace=%s)', async (whole) => {
    const f = await fixture();
    const result = await f.operations.run({ action: 'delete', groupId: 'work', ...(whole ? {} : { projectId: 'project' }) });
    expect(f.dependencies.trash).toHaveBeenCalledWith(whole ? f.workspace : f.project);
    expect(result.session.tabs).toEqual([]);
    expect(result.session.groups).toHaveLength(whole ? 0 : 1);
    expect(await fs.readFile(path.join(f.root, 'recycled', ...(whole ? ['Experiment'] : []), 'keep.txt'), 'utf8')).toBe('important');
  });
  it('never recycles or moves a Library project folder', async () => {
    const f = await fixture();
    f.session.groups![0].kind = 'folder';
    await expect(f.operations.run({ action: 'keep', groupId: 'work', projectId: 'project', destinationParent: f.library })).rejects.toThrow('Only managed');
    await expect(f.operations.run({ action: 'delete', groupId: 'work', projectId: 'project' })).rejects.toThrow('Only managed');
    expect(f.dependencies.trash).not.toHaveBeenCalled();
    expect(f.dependencies.setSession).not.toHaveBeenCalled();
    expect(await fs.readFile(path.join(f.project, 'keep.txt'), 'utf8')).toBe('important');
  });
  it.each([undefined, false])('deletes or keeps only entries saved as projects (isProject=%s)', async (isProject) => {
    const f = await fixture();
    if (isProject === undefined) delete f.session.tabs[0].isProject; else f.session.tabs[0].isProject = isProject;
    await expect(f.operations.run({ action: 'delete', groupId: 'work', projectId: 'project' })).rejects.toThrow('Only a project');
    await expect(f.operations.run({ action: 'keep', groupId: 'work', projectId: 'project', destinationParent: f.library })).rejects.toThrow('Only a project');
    expect(f.dependencies.trash).not.toHaveBeenCalled();
  });
  it.each([false, true])('never recycles or moves a Git worktree folder (workspace=%s)', async (whole) => {
    const f = await fixture();
    await fs.rm(path.join(f.project, '.git'), { recursive: true });
    await fs.writeFile(path.join(f.project, '.git'), 'gitdir: C:/repo/.git/worktrees/Experiment\n');
    await expect(f.operations.run({ action: 'delete', groupId: 'work', ...(whole ? {} : { projectId: 'project' }) })).rejects.toThrow('Git worktree');
    if (!whole) await expect(f.operations.run({ action: 'keep', groupId: 'work', projectId: 'project', destinationParent: f.library })).rejects.toThrow('Git worktree');
    expect(f.dependencies.trash).not.toHaveBeenCalled();
    expect(f.dependencies.setSession).not.toHaveBeenCalled();
    expect(await fs.readFile(path.join(f.project, 'keep.txt'), 'utf8')).toBe('important');
  });
  it.each(['delete-project', 'delete-workspace', 'keep-project'])('protects nested submodules before %s', async (action) => {
    const f = await fixture();
    const nested = path.join(f.project, 'packages', 'module');
    await fs.mkdir(nested, { recursive: true });
    await fs.writeFile(path.join(nested, '.git'), 'gitdir: ../../.git/modules/packages/module\n');
    await expect(f.operations.run({ action: action === 'keep-project' ? 'keep' : 'delete', groupId: 'work',
      ...(action === 'delete-workspace' ? {} : { projectId: 'project' }), destinationParent: f.library })).rejects.toThrow('Git worktree or submodule');
    expect(f.dependencies.trash).not.toHaveBeenCalled();
    expect(f.dependencies.setSession).not.toHaveBeenCalled();
    expect(f.dependencies.release).not.toHaveBeenCalled();
    expect(await fs.readFile(path.join(nested, '.git'), 'utf8')).toContain('gitdir:');
    expect(await fs.readdir(f.library)).toEqual([]);
  });
  it('stops safely when a Git marker cannot be inspected', async () => {
    const f = await fixture();
    const original = fs.lstat;
    const inspection = vi.spyOn(fs, 'lstat').mockImplementation((...args) => {
      if (String(args[0]) === path.join(f.project, '.git')) return Promise.reject(Object.assign(new Error('cannot inspect Git marker'), { code: 'EACCES' }));
      return original(...args);
    });
    syncBuiltinESMExports();
    try {
      await expect(f.operations.run({ action: 'delete', groupId: 'work', projectId: 'project' })).rejects.toThrow('cannot inspect');
      await expect(assertManagedFolderRename(f.session, f.project)).rejects.toThrow('cannot inspect');
    } finally { inspection.mockRestore(); syncBuiltinESMExports(); }
    expect(f.dependencies.trash).not.toHaveBeenCalled();
    expect(f.dependencies.setSession).not.toHaveBeenCalled();
    expect(f.dependencies.release).not.toHaveBeenCalled();
  });
  it('rejects Library deletion, root targets, blank IDs and sessions without their own directory', async () => {
    const f = await fixture();
    await expect(f.operations.run({ action: 'delete', groupId: 'work', projectId: '' })).rejects.toThrow('Invalid');
    f.session.groups![0].kind = 'folder';
    await expect(f.operations.run({ action: 'delete', groupId: 'work' })).rejects.toThrow('Only managed');
    delete f.session.groups![0].kind;
    f.session.tabs[0].cwd = f.workspace;
    await expect(f.operations.run({ action: 'delete', groupId: 'work', projectId: 'project' })).rejects.toThrow('does not own');
    f.session.groups![0].directory = f.root;
    await expect(f.operations.run({ action: 'delete', groupId: 'work' })).rejects.toThrow('protected root');
    expect(f.dependencies.trash).not.toHaveBeenCalled();
  });
  it('protects Library locations nested inside a temporary workspace', async () => {
    const f = await fixture();
    f.session.groups!.push({ id: 'linked', name: 'Linked', kind: 'folder', directory: f.project });
    await expect(f.operations.run({ action: 'delete', groupId: 'work' })).rejects.toThrow('overlaps');
    expect(f.dependencies.trash).not.toHaveBeenCalled();
  });
  it('rejects junction/symlink project roots instead of recycling their targets', async () => {
    const f = await fixture();
    const link = path.join(f.workspace, 'Link');
    await fs.symlink(f.library, link, process.platform === 'win32' ? 'junction' : 'dir');
    f.session.tabs[0].cwd = link;
    await expect(f.operations.run({ action: 'delete', groupId: 'work', projectId: 'project' })).rejects.toThrow('Linked');
    expect(f.dependencies.trash).not.toHaveBeenCalled();
  });
  it('does not merge destinations or allow promotion into temporary storage', async () => {
    const f = await fixture();
    await fs.mkdir(path.join(f.library, 'Experiment'));
    await expect(f.operations.run({ action: 'keep', groupId: 'work', projectId: 'project', destinationParent: f.library })).rejects.toThrow();
    await expect(f.operations.run({ action: 'keep', groupId: 'work', projectId: 'project', destinationParent: f.main })).rejects.toThrow('permanent location');
    expect(f.dependencies.trash).not.toHaveBeenCalled();
    expect(await fs.readFile(path.join(f.project, 'keep.txt'), 'utf8')).toBe('important');
  });
  it('retains the original on failed copy verification', async () => {
    const f = await fixture();
    const copy = vi.spyOn(fs, 'cp').mockResolvedValue(undefined);
    try { await expect(f.operations.run({ action: 'keep', groupId: 'work', projectId: 'project', destinationParent: f.library })).rejects.toThrow('original is intact'); }
    finally { copy.mockRestore(); }
    expect(f.dependencies.trash).not.toHaveBeenCalled();
    expect(f.dependencies.setSession).not.toHaveBeenCalled();
  });
  it('never trashes an original if saving the Library record fails', async () => {
    const f = await fixture();
    f.dependencies.setSession.mockImplementation(() => { throw new Error('disk full'); });
    await expect(f.operations.run({ action: 'keep', groupId: 'work', projectId: 'project', destinationParent: f.library })).rejects.toThrow('disk full');
    expect(f.dependencies.trash).not.toHaveBeenCalled();
    expect(await fs.readFile(path.join(f.project, 'keep.txt'), 'utf8')).toBe('important');
  });
  it('retains both copies when an external program changes the source during transfer', async () => {
    const f = await fixture();
    const realCopy = fs.cp;
    const copy = vi.spyOn(fs, 'cp').mockImplementation(async (...args) => {
      await realCopy(...args);
      await fs.writeFile(path.join(f.project, 'new-during-copy.txt'), 'new work');
    });
    try { await expect(f.operations.run({ action: 'keep', groupId: 'work', projectId: 'project', destinationParent: f.library })).rejects.toThrow('original is intact'); }
    finally { copy.mockRestore(); }
    expect(f.dependencies.trash).not.toHaveBeenCalled();
    expect(await fs.readFile(path.join(f.project, 'new-during-copy.txt'), 'utf8')).toBe('new work');
  });
  it('restores deletion metadata on trash failure without permanently deleting files', async () => {
    const f = await fixture();
    f.dependencies.trash.mockRejectedValue(new Error('in use'));
    await expect(f.operations.run({ action: 'delete', groupId: 'work' })).rejects.toThrow('Nothing was permanently deleted');
    expect(f.session.tabs).toHaveLength(1);
    expect(await fs.readFile(path.join(f.project, 'keep.txt'), 'utf8')).toBe('important');
  });
  it('keeps the Library copy and warns if recycling the verified original fails', async () => {
    const f = await fixture();
    f.dependencies.trash.mockRejectedValue(new Error('in use'));
    const result = await f.operations.run({ action: 'keep', groupId: 'work', projectId: 'project', destinationParent: f.library });
    expect(result.warning).toContain('original could not be recycled');
    expect(f.session.groups?.[1].kind).toBe('folder');
    expect(await fs.readFile(path.join(f.project, 'keep.txt'), 'utf8')).toBe('important');
  });
});

describe('managed folder rename', () => {
  it('allows a workspace folder and the folder its project owns', async () => {
    const f = await fixture();
    await expect(assertManagedFolderRename(f.session, f.workspace)).resolves.toBeUndefined();
    await expect(assertManagedFolderRename(f.session, f.project)).resolves.toBeUndefined();
  });
  it('refuses Library entries, Library and worktree projects, and folders holding them', async () => {
    const f = await fixture();
    const worktree = path.join(f.root, 'Experiment-feature');
    await fs.mkdir(worktree);
    const session: SavedSession = { ...f.session,
      groups: [...f.session.groups!, { id: 'library', name: 'Permanent', kind: 'folder', directory: f.library },
        { id: 'tree', name: 'Experiment-feature', kind: 'folder', directory: worktree }],
      tabs: [...f.session.tabs,
        { id: 'library-project', title: 'Permanent', groupId: 'library', type: 'local', isProject: true, cwd: f.library, root: { type: 'leaf' } },
        { id: 'worktree-project', title: 'Feature', groupId: 'library', type: 'local', isProject: true, cwd: worktree, root: { type: 'leaf' } }] };
    for (const folder of [f.library, worktree, f.root]) {
      await expect(assertManagedFolderRename(session, folder)).rejects.toThrow('Nothing was renamed');
    }
    // A workspace folder that holds a Library entry is not renamed either.
    session.groups!.push({ id: 'nested', name: 'Nested', kind: 'folder', directory: f.project });
    await expect(assertManagedFolderRename(session, f.workspace)).rejects.toThrow('Library entry');
    await expect(assertManagedFolderRename(session, f.project)).rejects.toThrow('Library entry');
  });
  it.each([false, true])('refuses renaming a folder containing a nested Git link (workspace=%s)', async (whole) => {
    const f = await fixture();
    const nested = path.join(f.project, 'packages', 'feature');
    await fs.mkdir(nested, { recursive: true });
    await fs.writeFile(path.join(nested, '.git'), 'gitdir: /repo/.git/worktrees/feature\n');
    await expect(assertManagedFolderRename(f.session, whole ? f.workspace : f.project)).rejects.toThrow('Git worktree or submodule');
  });
  it('protects managed folders inside Library and Library projects outside their entry folder', async () => {
    const f = await fixture();
    f.session.groups!.push({ id: 'outer', name: 'Outer', kind: 'folder', directory: f.main });
    await expect(assertManagedFolderRename(f.session, f.workspace)).rejects.toThrow('Library entry');
    f.session.groups!.pop();
    f.session.groups!.push({ id: 'external', name: 'External', kind: 'folder', directory: f.library });
    f.session.tabs.push({ id: 'external-project', title: 'External project', groupId: 'external', type: 'local',
      isProject: true, cwd: f.project, root: { type: 'leaf' } });
    await expect(assertManagedFolderRename(f.session, f.workspace)).rejects.toThrow('Library project');
  });
  it('refuses a project folder that is not saved as a project or is a Git worktree', async () => {
    const f = await fixture();
    const session = { ...f.session, tabs: [{ ...f.session.tabs[0], isProject: false }] };
    await expect(assertManagedFolderRename(session, f.project)).rejects.toThrow('Nothing was renamed');
    await fs.rm(path.join(f.project, '.git'), { recursive: true });
    await fs.writeFile(path.join(f.project, '.git'), 'gitdir: /repo/.git/worktrees/Experiment\n');
    await expect(assertManagedFolderRename(f.session, f.project)).rejects.toThrow('Git worktree');
  });
});
