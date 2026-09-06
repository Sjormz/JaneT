import React, { useId, useState } from 'react';
import { SavedSSHProfile, WorkspaceTabPreset, createWorkspaceRoot, genId } from '../types';
import { serializePaneTree } from '../sessionRestore';
import { MinusIcon, PlusIcon, TerminalTabIcon } from '../icons';
import { MAX_STARTUP_COMMAND_LENGTH, sanitizeStartupCommands } from '../../shared/startupCommands';
import { type WorkspaceGroup } from '../../shared/workspaceGroups';

export function sshProfileLabel(profile: SavedSSHProfile) {
  return `${profile.username ? `${profile.username}@` : ''}${profile.host}:${profile.port}`;
}

const launchers = ['codex', 'hermes', 'claude', 'custom'] as const;
const launcherLabels = { codex: 'Codex', hermes: 'Hermes', claude: 'Claude', custom: 'Custom' };

interface WorkspaceFormProps {
  groups: WorkspaceGroup[];
  defaultGroupId?: string;
  folder?: WorkspaceGroup;
  submitting?: boolean;
  submitLabel: string;
  onSubmit: (workspace: WorkspaceTabPreset, group: WorkspaceGroup) => void;
}

export default function WorkspaceForm({ groups, defaultGroupId, folder, submitting, submitLabel, onSubmit }: WorkspaceFormProps) {
  const formId = useId();
  const [name, setName] = useState('');
  const [groupId, setGroupId] = useState(defaultGroupId ?? groups[0]?.id ?? 'new');
  const [terminalCount, setTerminalCount] = useState('1');
  const [launcher, setLauncher] = useState<typeof launchers[number]>('codex');
  const [customCommand, setCustomCommand] = useState('');
  const count = Number(terminalCount);
  const validCount = Number.isInteger(count) && count >= 1 && count <= 16;
  const startupCommands = sanitizeStartupCommands([launcher === 'custom' ? customCommand : launcher === 'hermes' ? 'hermes --tui' : launcher]);
  const selectedGroup = folder ?? groups.find((group) => group.id === groupId);
  const canSubmit = !submitting && Boolean(selectedGroup) && (Boolean(folder) || Boolean(name.trim()))
    && validCount && startupCommands.length === 1;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit || !selectedGroup) return;
    const terminals = Array.from({ length: count }, () => ({ type: 'local' as const, startupCommands }));
    const root = serializePaneTree(createWorkspaceRoot(terminals), {}, { includeStartupCommands: true });
    onSubmit({
      id: genId('workspace'), name: name.trim() || 'Session', type: 'local', root,
      terminalCount: count,
      splitDirection: root.type === 'split' ? root.direction : 'vertical',
    }, selectedGroup);
  };

  return (
    <form className="workspace-form" onSubmit={handleSubmit}>
      <fieldset className="workspace-creation-fields" disabled={submitting}>
        {folder ? <p className="main-directory-path">{folder.directory}</p> : (
          <label className="form-field"><span>Workspace</span>
            <select className="form-input" value={groupId} onChange={(event) => setGroupId(event.target.value)}>
              {groups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}
            </select>
          </label>
        )}
        <label className="form-field">
          <span>{folder ? 'Session name (optional)' : 'Project name'}</span>
          <input className="form-input" value={name} onChange={(event) => setName(event.target.value)} placeholder={folder ? 'e.g. Development' : 'My development setup'} maxLength={128} required={!folder} />
        </label>
        <div className="workspace-count-row">
          <div>
            <label htmlFor={`${formId}-count`}>Initial terminals</label>
            <p className="workspace-form-help">Local terminals, one shared command.</p>
          </div>
          <div className="workspace-count-picker">
            <button type="button" aria-label="Fewer terminals" disabled={!validCount || count <= 1} onClick={() => setTerminalCount(String(count - 1))}><MinusIcon /></button>
            <input id={`${formId}-count`} type="number" min={1} max={16} step={1} required value={terminalCount} onChange={(event) => setTerminalCount(event.target.value)} aria-invalid={!validCount} />
            <button type="button" aria-label="More terminals" disabled={!validCount || count >= 16} onClick={() => setTerminalCount(String(count + 1))}><PlusIcon /></button>
          </div>
        </div>
        <fieldset className="workspace-launcher-field">
          <legend>Run in every terminal</legend>
          <div className="workspace-launcher-options">
            {launchers.map((choice) => (
              <label className="workspace-launcher-option" key={choice}>
                <input type="radio" name={`${formId}-launcher`} value={choice} checked={launcher === choice} onChange={() => setLauncher(choice)} />
                <span className="workspace-launcher-card">
                  {choice === 'custom' ? <TerminalTabIcon size="xl" /> : <span aria-hidden="true" className={`workspace-launcher-icon is-${choice}`} />}
                  <span>{launcherLabels[choice]}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {launcher === 'custom' && (
          <label className="form-field">
            <span>Custom command</span>
            <input aria-label="Custom command" className="form-input workspace-custom-command" value={customCommand} onChange={(event) => setCustomCommand(event.target.value)} placeholder="e.g. npm run dev" maxLength={MAX_STARTUP_COMMAND_LENGTH} required aria-describedby={`${formId}-command-help`} />
            <span id={`${formId}-command-help`} className="workspace-form-help">Runs in all terminals. Saved with this {folder ? 'session' : 'project'}; avoid passwords or tokens.</span>
          </label>
        )}
        <p className="workspace-form-help">Every terminal opens in {folder ? 'this folder' : 'the new project folder'}. Your layout restores automatically.</p>
      </fieldset>
      <button className="connect-btn" type="submit" disabled={!canSubmit}>{submitLabel}</button>
    </form>
  );
}
