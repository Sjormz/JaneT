import React, { useEffect, useState } from 'react';
import { SavedSSHProfile, WorkspaceTabPreset, WorkspaceTerminal, createWorkspaceRoot } from '../types';
import { SavedPaneNode, serializePaneTree } from '../sessionRestore';
import { ChevronDownIcon, PlusIcon, XCloseIcon } from '../icons';
import Tooltip from './Tooltip';

export function sshProfileLabel(profile: SavedSSHProfile) {
  return `${profile.username ? `${profile.username}@` : ''}${profile.host}:${profile.port}`;
}

function selectedSshProfileLabel(terminal: WorkspaceTerminal, sshProfiles: SavedSSHProfile[]) {
  if (!terminal.sshProfileId) return 'Choose a saved connection';
  const profile = sshProfiles.find((candidate) => candidate.id === terminal.sshProfileId);
  return profile ? sshProfileLabel(profile) : 'Missing saved connection';
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
  const missingSshProfileIndex = terminals.findIndex((terminal) => (
    terminal.type === 'ssh'
    && (!terminal.sshProfileId || !sshProfiles.some((profile) => profile.id === terminal.sshProfileId))
  ));
  const canSubmit = Boolean(name.trim()) && missingSshProfileIndex === -1;

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
    if (!name.trim() || missingSshProfileIndex >= 0) return;
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
      <label className="form-field">
        <span>Preset name</span>
        <input className="form-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="My development setup" aria-label="Preset name" required />
      </label>
      <div className="workspace-terminal-list">
        {terminals.map((terminal, index) => (
          <div className="workspace-terminal-entry" key={index}>
            <div className="workspace-terminal-label-row">
              <span className="workspace-terminal-label">Terminal {index + 1}</span>
              {terminals.length > 1 && (
                <Tooltip label={`Remove terminal ${index + 1}`} placement="left">
                  <button type="button" className="workspace-terminal-remove" aria-label={`Remove terminal ${index + 1}`} onClick={() => setTerminals((current) => current.filter((_, i) => i !== index))}>
                    <XCloseIcon size="xs" />
                  </button>
                </Tooltip>
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
                  <span>{selectedSshProfileLabel(terminal, sshProfiles)}</span>
                  <ChevronDownIcon size="xs" />
                </button>
                {openProfileIndex === index && (
                  <div className="workspace-profile-menu" role="listbox" aria-label={`Terminal ${index + 1} SSH profiles`}>
                    {sshProfiles.length === 0 && <div className="workspace-profile-empty" role="option" aria-disabled="true">No saved SSH connections</div>}
                    {sshProfiles.map((profile) => <button key={profile.id} type="button" role="option" aria-selected={terminal.sshProfileId === profile.id} onClick={() => { updateTerminal(index, { ...terminal, sshProfileId: profile.id }); setOpenProfileIndex(null); }}>{sshProfileLabel(profile)}</button>)}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      {missingSshProfileIndex >= 0 && (
        <div className="workspace-form-help is-error" role="alert">
          Terminal {missingSshProfileIndex + 1} needs a saved SSH connection.
        </div>
      )}
      <button className="workspace-add-btn" type="button" onClick={() => setTerminals((current) => [...current, { type: 'local' }])}><PlusIcon size="xs" /> Add terminal</button>
      <button className="connect-btn" type="submit" disabled={!canSubmit}>{submitLabel}</button>
    </form>
  );
}
