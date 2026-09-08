import { describe, expect, it } from 'vitest';
import { isWorkspaceGroup, isWorkspaceProject, normalizeWorkspaceGroups } from '../../src/shared/workspaceGroups';
import { normalizeSession } from '../../src/renderer/sessionRestore';

describe('workspace group persistence', () => {
  it('retains only owned project directories after the last terminal closes', () => {
    const groups = [{ id: 'work', name: 'Work', directory: 'C:\\Work\\' }];
    for (const cwd of ['c:/work/app', 'C:\\Work\\App\\']) {
      expect(isWorkspaceProject({ groupId: 'work', cwd }, groups)).toBe(true);
    }
    for (const cwd of [undefined, 'C:/Work', 'c:/work/', 'C:/Other/App', 'C:/Work/App/nested']) {
      expect(isWorkspaceProject({ groupId: 'work', cwd }, groups)).toBe(false);
    }
    expect(isWorkspaceProject({ groupId: 'work', cwd: 'C:/Work/App' }, [{ ...groups[0], kind: 'folder' }])).toBe(true);
    expect(isWorkspaceProject({ groupId: 'work', cwd: 'C:/Work' }, [{ ...groups[0], kind: 'folder' }])).toBe(false);
    expect(isWorkspaceProject({ groupId: 'legacy', cwd: 'C:/Work/App' }, [{ id: 'legacy', name: 'Old' }])).toBe(false);
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
