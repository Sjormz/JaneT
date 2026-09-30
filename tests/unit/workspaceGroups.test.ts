import { describe, expect, it } from 'vitest';
import {
  isWorkspaceGroup, isWorkspaceProject, normalizeWorkspaceGroups, ownsWorkspaceProjectFolder, resolveLegacyWorkspaceProjects,
} from '../../src/shared/workspaceGroups';
import { normalizeSession } from '../../src/renderer/sessionRestore';

describe('workspace group persistence', () => {
  it('treats only explicitly flagged tabs as projects', () => {
    const groups = [{ id: 'work', name: 'Work', directory: 'C:\\Work\\' }];
    for (const cwd of ['c:/work/app', 'C:\\Work\\App\\']) {
      expect(isWorkspaceProject({ groupId: 'work', cwd, isProject: true }, groups)).toBe(true);
      // A new terminal, worktree, or folder opened in a project folder is a session.
      expect(isWorkspaceProject({ groupId: 'work', cwd }, groups)).toBe(false);
      expect(isWorkspaceProject({ groupId: 'work', cwd, isProject: false }, groups)).toBe(false);
    }
    expect(isWorkspaceProject({ groupId: 'work', cwd: undefined, isProject: true }, groups)).toBe(false);
    expect(isWorkspaceProject({ groupId: 'work', cwd: 'C:/Work', isProject: true }, [{ ...groups[0], kind: 'folder' }])).toBe(true);
    expect(isWorkspaceProject({ groupId: 'legacy', cwd: 'C:/Work/App', isProject: true }, [{ id: 'legacy', name: 'Old' }])).toBe(false);
  });

  it('lets only the owning project rename a temporary workspace folder', () => {
    const groups = [{ id: 'work', name: 'Work', directory: 'C:\\Work\\' }];
    expect(ownsWorkspaceProjectFolder({ groupId: 'work', cwd: 'c:/work/app', isProject: true }, groups)).toBe(true);
    for (const tab of [
      { groupId: 'work', cwd: 'C:/Work/App' },
      { groupId: 'work', cwd: 'C:/Work/App', isProject: false },
      { groupId: 'work', cwd: 'C:/Work/App/nested', isProject: true },
      { groupId: 'work', cwd: 'C:/Work', isProject: true },
    ]) expect(ownsWorkspaceProjectFolder(tab, groups)).toBe(false);
    expect(ownsWorkspaceProjectFolder({ groupId: 'work', cwd: 'C:/Work/App', isProject: true }, [{ ...groups[0], kind: 'folder' }])).toBe(false);
  });

  it('resolves legacy directory-backed projects once, without claiming secondary tabs', () => {
    const groups = [
      { id: 'legacy', name: 'Legacy', directory: 'C:/Work' },
      { id: 'current', name: 'Current', directory: 'C:/Current' },
      { id: 'library', name: 'Repo', kind: 'folder' as const, directory: 'C:/Repo' },
    ];
    const withTerminals = new Set(['project', 'second', 'worktree', 'current-worktree', 'library-child']);
    const resolved = resolveLegacyWorkspaceProjects([
      { id: 'project', groupId: 'legacy', cwd: 'C:\\Work\\App' },
      { id: 'second', groupId: 'legacy', cwd: 'c:/work/app/' },
      { id: 'nested', groupId: 'legacy', cwd: 'C:/Work/App/src' },
      { id: 'idle-second', groupId: 'legacy', cwd: 'C:/Work/Idle' },
      { id: 'idle', groupId: 'legacy', cwd: 'C:/Work/Idle' },
      { id: 'explicit', groupId: 'current', cwd: 'C:/Current/App', isProject: true },
      { id: 'current-worktree', groupId: 'current', cwd: 'C:/Current/App-feature' },
      { id: 'saved-session', groupId: 'legacy', cwd: 'C:/Work/Saved', isProject: false },
      { id: 'library-child', groupId: 'library', cwd: 'C:/Repo/sub' },
    ], groups, (tab) => withTerminals.has(tab.id) || tab.id === 'idle-second');
    expect(Object.fromEntries(resolved.map((tab) => [tab.id, tab.isProject]))).toEqual({
      project: true,
      second: false,
      nested: false,
      // Only projects outlive their last terminal, so an empty tab owns its folder.
      'idle-second': false,
      idle: true,
      explicit: true,
      // A workspace saved with explicit projects never infers more.
      'current-worktree': false,
      'saved-session': false,
      'library-child': false,
    });
    const again = resolveLegacyWorkspaceProjects(resolved, groups, () => true);
    expect(again).toEqual(resolved);
  });

  it('restores legacy sessions with explicit project ownership', () => {
    const session = normalizeSession({
      groups: [{ id: 'work', name: 'Work', directory: 'C:/Work' }],
      tabs: [
        { id: 'project', title: 'App', type: 'local', groupId: 'work', cwd: 'C:/Work/App', root: { type: 'leaf' } },
        { id: 'terminal-2', title: 'Terminal 2', type: 'local', groupId: 'work', cwd: 'C:/Work/App', root: { type: 'leaf' } },
      ],
    });
    expect(session.tabs.map((tab) => tab.isProject)).toEqual([true, false]);
  });
  it('preserves linked folder paths and multiple session memberships', () => {
    const group = { id: 'project', name: 'Project X', kind: 'folder', directory: 'C:/Projects/X', collapsed: true };
    const session = normalizeSession({ groups: [group], tabs: ['dev', 'test'].map((id) => ({
      id, title: id, type: 'local', groupId: 'project', cwd: group.directory, root: { type: 'leaf', cwd: group.directory },
    })) });
    expect(session.groups).toEqual([group]);
    expect(session.tabs.map((tab) => tab.groupId)).toEqual(['project', 'project']);
    expect(isWorkspaceGroup({ id: 'bad', name: 'Bad', kind: 'folder' })).toBe(false);
    expect(isWorkspaceGroup({ ...group, directory: '\0' })).toBe(false);
  });
  it('normalizes bounded unique groups and preserves workspace membership', () => {
    const group = { id: 'research', name: 'Research', collapsed: true };
    const session = normalizeSession({ groups: [group, group, { id: 'bad', name: '' }], tabs: [{
      id: 'workspace', title: 'Experiment', type: 'local', groupId: 'research', root: { type: 'leaf' },
    }] });
    expect(session.groups).toEqual([group]);
    expect(session.groups?.[0]).not.toBe(group);
    expect(session.tabs[0].groupId).toBe('research');
    expect(normalizeSession({ tabs: [] }).groups).toBeUndefined();
    expect(normalizeWorkspaceGroups(Array.from({ length: 100 }, (_, i) => ({ id: String(i), name: 'Group' })))).toHaveLength(64);
  });
  it('rejects malformed group data at the settings boundary', () => {
    for (const value of [null, [], { id: '', name: 'A' }, { id: 'a', name: ' ' },
      { id: 'a', name: 'A', collapsed: 'yes' }, { id: 'a', name: 'A', command: 'exec' },
      { id: 'a', name: 'x'.repeat(257) }]) expect(isWorkspaceGroup(value)).toBe(false);
  });
});
