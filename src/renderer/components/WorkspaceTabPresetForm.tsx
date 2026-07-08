import React, { useEffect, useState } from 'react';
import { SavedSSHProfile, WorkspaceTabPreset } from '../types';

export function sshProfileLabel(profile: SavedSSHProfile) {
  return `${profile.username ? `${profile.username}@` : ''}${profile.host}:${profile.port}`;
}

function newPresetId() {
  return `workspace-tab-${Date.now()}`;
}

interface WorkspaceTabPresetFormProps {
  sshProfiles: SavedSSHProfile[];
  preset?: WorkspaceTabPreset | null;
  submitLabel: string;
  onSubmit: (preset: WorkspaceTabPreset) => void;
}

export default function WorkspaceTabPresetForm({
  sshProfiles,
  preset,
  submitLabel,
  onSubmit,
}: WorkspaceTabPresetFormProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<'local' | 'ssh'>('local');
  const [cwd, setCwd] = useState('');
  const [sshProfileId, setSshProfileId] = useState('');
  const [terminalCount, setTerminalCount] = useState(1);
  const [splitDirection, setSplitDirection] = useState<'horizontal' | 'vertical'>('vertical');

  useEffect(() => {
    setName(preset?.name ?? '');
    setType(preset?.type ?? 'local');
    setCwd(preset?.cwd ?? '');
    setSshProfileId(preset?.sshProfileId ?? '');
    setTerminalCount(preset?.terminalCount ?? 1);
    setSplitDirection(preset?.splitDirection ?? 'vertical');
  }, [preset]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    const nextPreset: WorkspaceTabPreset = {
      id: preset?.id ?? newPresetId(),
      name: name.trim() || (type === 'ssh' ? 'SSH workspace' : 'Local workspace'),
      type,
      cwd: type === 'local' ? cwd.trim() || undefined : undefined,
      sshProfileId: type === 'ssh' ? sshProfileId || undefined : undefined,
      terminalCount: Math.max(1, Math.min(8, terminalCount || 1)),
      splitDirection,
    };

    if (nextPreset.type === 'ssh' && !nextPreset.sshProfileId) return;
    onSubmit(nextPreset);
  };

  return (
    <form className="workspace-form" onSubmit={handleSubmit}>
      <div className="form-row">
        <input
          className="form-input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Tab name"
        />
      </div>
      <div className="form-row form-row-2">
        <select
          className="form-input"
          value={type}
          onChange={(event) => setType(event.target.value as 'local' | 'ssh')}
          aria-label="Workspace tab type"
        >
          <option value="local">Local folder</option>
          <option value="ssh">SSH connection</option>
        </select>
        <select
          className="form-input"
          value={splitDirection}
          onChange={(event) => setSplitDirection(event.target.value as 'horizontal' | 'vertical')}
          aria-label="Split direction"
        >
          <option value="vertical">Vertical splits</option>
          <option value="horizontal">Horizontal splits</option>
        </select>
      </div>
      {type === 'local' ? (
        <div className="form-row">
          <input
            className="form-input"
            value={cwd}
            onChange={(event) => setCwd(event.target.value)}
            placeholder="Directory path (blank = home)"
          />
        </div>
      ) : (
        <div className="form-row">
          <select
            className="form-input"
            value={sshProfileId}
            onChange={(event) => setSshProfileId(event.target.value)}
            aria-label="SSH profile"
          >
            <option value="">Select saved SSH</option>
            {sshProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {sshProfileLabel(profile)}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="workspace-range-row">
        <span>Terminals: {terminalCount}</span>
        <input
          type="range"
          min="1"
          max="8"
          value={terminalCount}
          onChange={(event) => setTerminalCount(parseInt(event.target.value))}
          aria-label="Terminal count"
        />
      </div>
      <button className="connect-btn" type="submit">
        {submitLabel}
      </button>
    </form>
  );
}
