import React, { useState } from 'react';
import type { WorkspaceGroup } from '../../shared/workspaceGroups';

export type WorkspaceEntryRequest = { action: 'create' | 'link'; groupId?: string };

export default function EmptyWorkspace({ groups, mainDirectory, onRequest }: {
  groups: WorkspaceGroup[]; mainDirectory?: string | null; onRequest: (request: WorkspaceEntryRequest) => void;
}) {
  const [selectedId, setSelectedId] = useState('');
  const selected = groups.find(group => group.id === selectedId) ?? groups[0];
  const library = selected?.kind === 'folder';
  return <section className="fresh-profile-entry" aria-labelledby="fresh-profile-entry-title">
    <h2 id="fresh-profile-entry-title">{selected ? 'What would you like to work on?' : mainDirectory ? 'Create your first workspace' : 'Choose where to work'}</h2>
    <p>{selected
      ? 'Choose a workspace for a temporary project, or a Library folder for a new terminal session.'
      : mainDirectory ? 'A workspace holds temporary projects. Each project gets its own folder and terminals. For an existing repo, link its folder to Library.' : 'Link a folder to Library to open terminals. You can set up workspaces later from the side panel.'}</p>
    {selected && <>
      <label className="form-field"><span>Where do you want to work?</span>
        <select className="form-input" value={selected.id} onChange={event => setSelectedId(event.target.value)}>
          {(['Workspaces', 'Library'] as const).map(section => <optgroup key={section} label={section}>
            {groups.filter(group => (group.kind === 'folder') === (section === 'Library')).map(group =>
              <option key={group.id} value={group.id}>{group.name}</option>)}
          </optgroup>)}
        </select>
      </label>
      <p>{library ? 'Start terminals in this folder without moving or copying its files.' : 'Create a project folder here, then choose how many terminals to open.'}</p>
    </>}
    <div className="fresh-profile-entry-actions" role="group" aria-label={selected ? 'Selected location' : 'Get started'}>
      <button type="button" className="empty-workspace-primary" onClick={() => onRequest({ action: 'create', groupId: selected?.id })}>
        {!mainDirectory && !library ? 'Set up workspaces' : selected ? library ? 'Start session' : 'Create project' : 'Create workspace'}
      </button>
    </div>
    <div className="empty-workspace-locations" role="group" aria-label="Add a location">
      <p>{selected ? 'Or add another location' : 'Or use an existing folder'}</p>
      <div className="fresh-profile-entry-actions">
        {selected && mainDirectory && <button type="button" onClick={() => onRequest({ action: 'create' })}>Add another workspace</button>}
        <button type="button" onClick={() => onRequest({ action: 'link' })}>{selected ? 'Link another folder' : 'Link folder to Library'}</button>
      </div>
    </div>
  </section>;
}
