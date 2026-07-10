import React, { useEffect, useState } from 'react';
import { SavedSSHProfile, WorkspaceTabPreset, WorkspaceTerminal, createWorkspaceRoot } from '../types';
import { SavedPaneNode, serializePaneTree } from '../sessionRestore';
import { ChevronDownIcon, PlusIcon, XCloseIcon } from '../icons';

export function sshProfileLabel(profile: SavedSSHProfile) {
  return `${profile.username ? `${profile.username}@` : ''}${profile.host}:${profile.port}`;
}

function newPresetId() {
  return `workspace-tab-${Date.now()}`;
}

function terminalsFromRoot(root: SavedPaneNode | undefined): WorkspaceTerminal[] {
  if (!root) return [{ type: 'local' }];
  if (root.type === 'leaf') return [{ type: root.terminalType ?? 'local', cwd: root.cwd, sshProfileId: root.sshProfileId }];
  return root.children.flatMap(terminalsFromRoot);
}

function applyTerminals(root: SavedPaneNode, terminals: WorkspaceTerminal[]): SavedPaneNode {
  let index = 0;
  const apply = (node: SavedPaneNode): SavedPaneNode => {
    if (node.type === 'leaf') {
      const terminal = terminals[index++] ?? { type: node.terminalType ?? 'local', cwd: node.cwd, sshProfileId: node.sshProfileId };
      return {
        type: 'leaf',
        title: node.title,
        terminalType: terminal.type,
        cwd: terminal.cwd,
        sshProfileId: terminal.sshProfileId,
      };
    }
    return { ...node, children: node.children.map(apply) };
  };
  return apply(root);
}

interface WorkspaceTabPresetFormProps {
  sshProfiles: SavedSSHProfile[];
  preset?: WorkspaceTabPreset | null;
  submitLabel: string;
  onSubmit: (preset: WorkspaceTabPreset) => void;
}

export default function WorkspaceTabPresetForm({ sshProfiles, preset, submitLabel, onSubmit }: WorkspaceTabPresetFormProps) {
  const [name, setName] = useState('');
  const [terminals, setTerminals] = useState<WorkspaceTerminal[]>([{ type: 'local' }]);
  const [openProfileIndex, setOpenProfileIndex] = useState<number | null>(null);

  useEffect(() => {
    setName(preset?.name ?? '');
    setTerminals(terminalsFromRoot(preset?.root));
    setOpenProfileIndex(null);
  }, [preset]);

  const updateTerminal = (index: number, next: WorkspaceTerminal) => {
    setTerminals((current) => current.map((terminal, i) => i === index ? next : terminal));
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || terminals.some((terminal) => terminal.type === 'ssh' && !terminal.sshProfileId)) return;
    const root = preset?.root
      ? applyTerminals(preset.root, terminals)
      : serializePaneTree(createWorkspaceRoot(terminals));
    onSubmit({
      id: preset?.id ?? newPresetId(),
      name: name.trim(),
      type: 'local',
      root,
      terminalCount: terminals.length,
      splitDirection: root.type === 'split' ? root.direction : 'vertical',
    });
  };

  return (
    <form className="workspace-form" onSubmit={handleSubmit}>
      <input className="form-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Workspace name" aria-label="Workspace name" required />
      <div className="workspace-terminal-list">
        {terminals.map((terminal, index) => (
          <div className="workspace-terminal-entry" key={index}>
            <div className="workspace-terminal-label-row">
              <span className="workspace-terminal-label">Terminal {index + 1}</span>
              {terminals.length > 1 && (
                <button type="button" className="workspace-terminal-remove" aria-label={`Remove terminal ${index + 1}`} onClick={() => setTerminals((current) => current.filter((_, i) => i !== index))}>
                  <XCloseIcon size="xs" />
                </button>
              )}
            </div>
            <div className="workspace-terminal-type" role="group" aria-label={`Terminal ${index + 1} type`}>
              <button type="button" className={terminal.type === 'local' ? 'active' : ''} onClick={() => updateTerminal(index, { type: 'local', cwd: terminal.type === 'local' ? terminal.cwd : undefined })}>Local terminal</button>
              <button type="button" className={terminal.type === 'ssh' ? 'active' : ''} onClick={() => updateTerminal(index, { type: 'ssh', sshProfileId: terminal.type === 'ssh' ? terminal.sshProfileId : undefined })}>SSH connection</button>
            </div>
            {terminal.type === 'local' ? (
              <input className="form-input" value={terminal.cwd ?? ''} onChange={(event) => updateTerminal(index, { ...terminal, cwd: event.target.value || undefined })} placeholder="Directory path (blank = home)" aria-label={`Terminal ${index + 1} directory`} />
            ) : (
              <div className="workspace-profile-select">
                <button type="button" className="workspace-profile-trigger" aria-label={`Terminal ${index + 1} SSH profile`} aria-expanded={openProfileIndex === index} aria-haspopup="listbox" onClick={() => setOpenProfileIndex((open) => open === index ? null : index)}>
                  <span>{terminal.sshProfileId ? sshProfileLabel(sshProfiles.find((profile) => profile.id === terminal.sshProfileId)!) : 'Select saved SSH'}</span>
                  <ChevronDownIcon size="xs" />
                </button>
                {openProfileIndex === index && (
                  <div className="workspace-profile-menu" role="listbox" aria-label={`Terminal ${index + 1} SSH profiles`}>
                    <button type="button" role="option" aria-selected={!terminal.sshProfileId} onClick={() => { updateTerminal(index, { ...terminal, sshProfileId: undefined }); setOpenProfileIndex(null); }}>Select saved SSH</button>
                    {sshProfiles.map((profile) => <button key={profile.id} type="button" role="option" aria-selected={terminal.sshProfileId === profile.id} onClick={() => { updateTerminal(index, { ...terminal, sshProfileId: profile.id }); setOpenProfileIndex(null); }}>{sshProfileLabel(profile)}</button>)}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      <button className="workspace-add-btn" type="button" onClick={() => setTerminals((current) => [...current, { type: 'local' }])}><PlusIcon size="xs" /> Add terminal</button>
      <button className="connect-btn" type="submit">{submitLabel}</button>
    </form>
  );
}
