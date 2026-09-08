import React, { useId, useState } from 'react';
import { SavedSSHProfile, WorkspaceTabPreset, createWorkspaceRoot, genId } from '../types';
import { serializePaneTree } from '../sessionRestore';
import { MinusIcon, PlusIcon, TerminalTabIcon, CodeIcon } from '../icons';
import { MAX_STARTUP_COMMAND_LENGTH, sanitizeStartupCommands } from '../../shared/startupCommands';
import { type WorkspaceGroup } from '../../shared/workspaceGroups';

export function sshProfileLabel(profile: SavedSSHProfile) {
  return `${profile.username ? `${profile.username}@` : ''}${profile.host}:${profile.port}`;
}

const launchers = ['default', 'codex', 'hermes', 'claude', 'custom'] as const;
const launcherLabels = { default: 'Terminal', codex: 'Codex', hermes: 'Hermes', claude: 'Claude', custom: 'Custom' };

interface WorkspaceFormProps {
  terminalsOnly?: boolean;
  group: WorkspaceGroup | undefined;
  submitting?: boolean;
  submitLabel: string;
  onSubmit: (workspace: WorkspaceTabPreset, group: WorkspaceGroup) => void;
}

export default function WorkspaceForm({ terminalsOnly = false, group, submitting, submitLabel, onSubmit }: WorkspaceFormProps) {
  const formId = useId();
  const [name, setName] = useState('');
  const [terminalCount, setTerminalCount] = useState('1');
  const [openTerminals, setOpenTerminals] = useState(false);
  const withTerminals = terminalsOnly || openTerminals;
  const [launcher, setLauncher] = useState<typeof launchers[number]>(terminalsOnly ? 'default' : 'codex');
  const [customCommand, setCustomCommand] = useState('');
  const count = Number(terminalCount);
  const validCount = Number.isInteger(count) && count >= 1 && count <= 16;
  const startupCommands = sanitizeStartupCommands([launcher === 'default' ? '' : launcher === 'custom' ? customCommand : launcher === 'hermes' ? 'hermes --tui' : launcher]);
  const canSubmit = !submitting && Boolean(group) && (terminalsOnly || Boolean(name.trim()))
    && (!withTerminals || (validCount && (launcher === 'default' || startupCommands.length === 1)));

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit || !group) return;
    const terminals = Array.from({ length: count }, () => ({ type: 'local' as const, startupCommands }));
    const root = withTerminals ? serializePaneTree(createWorkspaceRoot(terminals), {}, { includeStartupCommands: true })
      : { type: 'split' as const, direction: 'vertical' as const, children: [], sizes: [] };
    onSubmit({
      id: genId('workspace'), name: name.trim() || 'Session', type: 'local', root,
      terminalCount: withTerminals ? count : 0,
      createProject: !terminalsOnly,
      splitDirection: root.type === 'split' ? root.direction : 'vertical',
    }, group);
  };

  return (
    <form className="workspace-form" onSubmit={handleSubmit}>
      <fieldset className="workspace-creation-fields" disabled={submitting}>
        {!terminalsOnly && <label className="form-field">
          <span>Project name</span>
          <input className="form-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="My development setup" maxLength={128} required />
        </label>}
        {!terminalsOnly && <button type="button" className="workspace-optional-terminals" aria-expanded={openTerminals} onClick={() => setOpenTerminals(!openTerminals)}>
          {openTerminals ? <MinusIcon /> : <PlusIcon />}
          <span>{openTerminals ? 'Remove terminals' : 'Add terminals'}</span>
          {!openTerminals && <span className="workspace-form-help">Optional</span>}
        </button>}
        {withTerminals && <>
        <div className="workspace-count-row">
          <div>
            <label htmlFor={`${formId}-count`}>{terminalsOnly ? 'Number of terminals' : 'Initial terminals'}</label>
            <p className="workspace-form-help">The same startup choice applies to all.</p>
          </div>
          <div className="workspace-count-picker">
            <button type="button" aria-label="Fewer terminals" disabled={!validCount || count <= 1} onClick={() => setTerminalCount(String(count - 1))}><MinusIcon /></button>
            <input id={`${formId}-count`} type="number" min={1} max={16} step={1} required value={terminalCount} onChange={(event) => setTerminalCount(event.target.value)} aria-invalid={!validCount} />
            <button type="button" aria-label="More terminals" disabled={!validCount || count >= 16} onClick={() => setTerminalCount(String(count + 1))}><PlusIcon /></button>
          </div>
        </div>
        <fieldset className="workspace-launcher-field">
          <legend>Start terminals with</legend>
          <div className="workspace-launcher-options">
            {launchers.map((choice) => (
              <label className="workspace-launcher-option" key={choice}>
                <input type="radio" name={`${formId}-launcher`} value={choice} checked={launcher === choice} onChange={() => setLauncher(choice)} />
                <span className="workspace-launcher-card">
                  {choice === 'custom' ? <CodeIcon size="xl" /> : choice === 'default' ? <TerminalTabIcon size="xl" /> : <span aria-hidden="true" className={`workspace-launcher-icon is-${choice}`} />}
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
            <span id={`${formId}-command-help`} className="workspace-form-help">Runs in all terminals. Saved with this {terminalsOnly ? 'session' : 'project'}; avoid passwords or tokens.</span>
          </label>
        )}
        <p className="workspace-form-help">Every terminal opens in {terminalsOnly ? 'this folder' : 'the new project folder'}. Your layout restores automatically.</p>
        </>}
        {!withTerminals && <p className="workspace-form-help">Create the project folder now. Add terminals whenever you’re ready.</p>}
      </fieldset>
      <button className="connect-btn" type="submit" disabled={!canSubmit}>{submitLabel}</button>
    </form>
  );
}
