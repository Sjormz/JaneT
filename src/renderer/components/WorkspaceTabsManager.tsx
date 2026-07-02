import React, { useState } from 'react';
import { WorkspaceTabPreset, SavedSSHProfile } from '../types';
import { PlusIcon, XCloseIcon, TerminalTabIcon, PlugIcon } from '../icons';

function sshProfileLabel(profile: SavedSSHProfile) {
  return `${profile.username ? `${profile.username}@` : ''}${profile.host}:${profile.port}`;
}

interface WorkspaceTabsManagerProps {
  presets: WorkspaceTabPreset[];
  sshProfiles: SavedSSHProfile[];
  onChange: (presets: WorkspaceTabPreset[]) => void;
  onLaunch: (preset: WorkspaceTabPreset) => void;
}

function newPresetId() {
  return `workspace-tab-${Date.now()}`;
}

export default function WorkspaceTabsManager({
  presets,
  sshProfiles,
  onChange,
  onLaunch,
}: WorkspaceTabsManagerProps) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<'local' | 'ssh'>('local');
  const [cwd, setCwd] = useState('');
  const [sshProfileId, setSshProfileId] = useState('');
  const [terminalCount, setTerminalCount] = useState(1);
  const [splitDirection, setSplitDirection] = useState<'horizontal' | 'vertical'>('vertical');

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setType('local');
    setCwd('');
    setSshProfileId('');
    setTerminalCount(1);
    setSplitDirection('vertical');
  };

  const openNewForm = () => {
    resetForm();
    setShowForm((visible) => !visible);
  };

  const editPreset = (preset: WorkspaceTabPreset) => {
    setEditingId(preset.id);
    setName(preset.name);
    setType(preset.type);
    setCwd(preset.cwd ?? '');
    setSshProfileId(preset.sshProfileId ?? '');
    setTerminalCount(preset.terminalCount);
    setSplitDirection(preset.splitDirection);
    setShowForm(true);
  };

  const deletePreset = (id: string) => {
    onChange(presets.filter((preset) => preset.id !== id));
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    const preset: WorkspaceTabPreset = {
      id: editingId ?? newPresetId(),
      name: name.trim() || (type === 'ssh' ? 'SSH workspace' : 'Local workspace'),
      type,
      cwd: type === 'local' ? cwd.trim() || undefined : undefined,
      sshProfileId: type === 'ssh' ? sshProfileId || undefined : undefined,
      terminalCount: Math.max(1, Math.min(8, terminalCount || 1)),
      splitDirection,
    };

    if (preset.type === 'ssh' && !preset.sshProfileId) return;

    const next = editingId
      ? presets.map((existing) => (existing.id === editingId ? preset : existing))
      : [...presets, preset];
    onChange(next);
    setShowForm(false);
    resetForm();
  };

  return (
    <div className="workspace-tabs-manager">
      <div className="workspace-header">
        <label className="theme-label">
          <TerminalTabIcon size="xs" /> Workspace Tabs
        </label>
        <button
          className="icon-btn"
          onClick={openNewForm}
          title={showForm ? 'Close workspace tab form' : 'New workspace tab'}
          aria-label={showForm ? 'Close workspace tab form' : 'New workspace tab'}
        >
          {showForm ? <XCloseIcon size="sm" /> : <PlusIcon size="sm" />}
        </button>
      </div>

      {showForm && (
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
            {editingId ? 'Save Workspace Tab' : 'Add Workspace Tab'}
          </button>
        </form>
      )}

      <div className="workspace-list">
        {presets.length === 0 ? (
          <div className="workspace-empty">No workspace tabs saved</div>
        ) : presets.map((preset) => {
          const sshProfile = sshProfiles.find((profile) => profile.id === preset.sshProfileId);
          const subtitle = preset.type === 'ssh'
            ? sshProfile ? sshProfileLabel(sshProfile) : 'Missing SSH profile'
            : preset.cwd || 'Home directory';

          return (
            <div className="workspace-item" key={preset.id}>
              <div className="workspace-item-main">
                <TerminalTabIcon size="md" className="workspace-item-icon" />
                <div className="workspace-item-text">
                  <span className="workspace-item-name">{preset.name}</span>
                  <span className="workspace-item-sub">
                    {subtitle} · {preset.terminalCount} {preset.splitDirection === 'vertical' ? 'vertical' : 'horizontal'}
                  </span>
                </div>
              </div>
              <div className="session-actions">
                <button
                  className="session-action-btn"
                  onClick={() => onLaunch(preset)}
                  title="Open workspace tab"
                  aria-label={`Open ${preset.name}`}
                >
                  <PlugIcon size="sm" />
                </button>
                <select
                  className="session-action-select"
                  value=""
                  aria-label={`Actions for ${preset.name}`}
                  onChange={(event) => {
                    if (event.target.value === 'edit') editPreset(preset);
                    if (event.target.value === 'delete') deletePreset(preset.id);
                    event.currentTarget.value = '';
                  }}
                >
                  <option value="" disabled>More</option>
                  <option value="edit">Edit</option>
                  <option value="delete">Delete</option>
                </select>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
