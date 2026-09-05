import React, { useId, useState } from 'react';
import {
  SavedSSHProfile,
  WorkspaceTabPreset,
  WorkspaceTerminal,
  createWorkspaceRoot,
  genId,
} from '../types';
import { serializePaneTree } from '../sessionRestore';
import {
  ArrowDownIcon, ArrowUpIcon, ChevronDownIcon, ChevronRightIcon, PlusIcon, XCloseIcon,
} from '../icons';
import Tooltip from './Tooltip';
import type { StartupShellDialect } from '../../shared/startupCommands';
import {
  MAX_STARTUP_COMMAND_LENGTH,
  MAX_STARTUP_COMMANDS,
  MAX_STARTUP_COMMAND_TOTAL_LENGTH,
  sanitizeStartupCommands,
} from '../../shared/startupCommands';
import ConfirmationDialog from './ConfirmationDialog';

import { type WorkspaceGroup } from '../../shared/workspaceGroups';

type PendingRemoval =
  | { kind: 'count'; count: number }
  | { kind: 'terminal'; terminalIndex: number }
  | { kind: 'command'; terminalIndex: number; commandIndex: number };

export function sshProfileLabel(profile: SavedSSHProfile) {
  return `${profile.username ? `${profile.username}@` : ''}${profile.host}:${profile.port}`;
}

function selectedSshProfileLabel(terminal: WorkspaceTerminal, sshProfiles: SavedSSHProfile[]) {
  if (!terminal.sshProfileId) return 'Choose a saved connection';
  const profile = sshProfiles.find((candidate) => candidate.id === terminal.sshProfileId);
  return profile ? sshProfileLabel(profile) : 'Missing saved connection';
}

interface WorkspaceFormProps {
  sshProfiles: SavedSSHProfile[];
  groups: WorkspaceGroup[];
  defaultGroupId?: string;
  folder?: WorkspaceGroup;
  submitting?: boolean;
  submitLabel: string;
  onSubmit: (workspace: WorkspaceTabPreset, group: WorkspaceGroup) => void;
}

export default function WorkspaceForm({ sshProfiles, groups, defaultGroupId, folder, submitting, submitLabel, onSubmit }: WorkspaceFormProps) {
  const formId = useId();
  const [name, setName] = useState('');
  const [groupId, setGroupId] = useState(defaultGroupId ?? groups[0]?.id ?? 'new');
  const [terminals, setTerminals] = useState<WorkspaceTerminal[]>([{ type: 'local' }]);
  const [openProfileIndex, setOpenProfileIndex] = useState<number | null>(null);
  const [openStartupIndices, setOpenStartupIndices] = useState<Set<number>>(new Set());
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(null);
  const missingSshProfileIndex = terminals.findIndex((terminal) => (
    terminal.type === 'ssh'
    && (!terminal.sshProfileId || !sshProfiles.some((profile) => profile.id === terminal.sshProfileId))
  ));
  const oversizedStartupIndex = terminals.findIndex((terminal) => (
    (terminal.startupCommands ?? []).reduce((total, command) => total + command.length, 0)
      > MAX_STARTUP_COMMAND_TOTAL_LENGTH
  ));
  const selectedGroup = folder ?? groups.find((group) => group.id === groupId);
  const canSubmit = !submitting && Boolean(selectedGroup) && (Boolean(folder) || Boolean(name.trim())) && missingSshProfileIndex === -1 && oversizedStartupIndex === -1;

  const updateTerminal = (index: number, next: WorkspaceTerminal) => {
    setTerminals((current) => current.map((terminal, i) => i === index ? next : terminal));
  };

  const toggleStartupCommands = (index: number) => {
    setOpenStartupIndices((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const updateStartupCommand = (terminalIndex: number, commandIndex: number, command: string) => {
    setTerminals((current) => current.map((terminal, index) => index === terminalIndex
      ? {
          ...terminal,
          startupCommands: (terminal.startupCommands ?? []).map((existing, currentIndex) => (
            currentIndex === commandIndex ? command : existing
          )),
        }
      : terminal));
  };

  const addStartupCommand = (terminalIndex: number) => {
    const terminal = terminals[terminalIndex];
    if (!terminal || (terminal.startupCommands?.length ?? 0) >= MAX_STARTUP_COMMANDS) return;
    const commandIndex = terminal.startupCommands?.length ?? 0;
    setOpenStartupIndices((current) => new Set(current).add(terminalIndex));
    updateTerminal(terminalIndex, {
      ...terminal,
      startupCommands: [...(terminal.startupCommands ?? []), ''],
      ...(terminal.type === 'ssh' ? { startupShellDialect: terminal.startupShellDialect ?? 'posix' } : {}),
    });
    requestAnimationFrame(() => {
      document.getElementById(`${formId}-terminal-${terminalIndex}-command-${commandIndex}`)?.focus();
    });
  };

  const removeStartupCommand = (terminalIndex: number, commandIndex: number) => {
    const terminal = terminals[terminalIndex];
    if (!terminal) return;
    const startupCommands = (terminal.startupCommands ?? []).filter((_, index) => index !== commandIndex);
    updateTerminal(terminalIndex, {
      ...terminal,
      startupCommands,
    });
    requestAnimationFrame(() => {
      const nextCommandIndex = Math.min(commandIndex, startupCommands.length - 1);
      const targetId = nextCommandIndex >= 0
        ? `${formId}-terminal-${terminalIndex}-command-${nextCommandIndex}`
        : `${formId}-terminal-${terminalIndex}-add-command`;
      document.getElementById(targetId)?.focus();
    });
  };

  const removeTerminal = (terminalIndex: number) => {
    const remainingTerminals = terminals.filter((_, index) => index !== terminalIndex);
    setTerminals(remainingTerminals);
    setOpenStartupIndices((current) => new Set(Array.from(current).flatMap((index) => (
      index === terminalIndex ? [] : [index > terminalIndex ? index - 1 : index]
    ))));
    setOpenProfileIndex((current) => {
      if (current === null || current < terminalIndex) return current;
      return current === terminalIndex ? null : current - 1;
    });
    requestAnimationFrame(() => {
      const nextTerminalIndex = Math.min(terminalIndex, remainingTerminals.length - 1);
      const nextTerminal = remainingTerminals[nextTerminalIndex];
      const targetId = nextTerminal
        ? `${formId}-terminal-${nextTerminalIndex}-type-${nextTerminal.type}`
        : `${formId}-add-terminal`;
      document.getElementById(targetId)?.focus();
    });
  };

  const confirmRemoval = () => {
    const removal = pendingRemoval;
    if (!removal) return;
    setPendingRemoval(null);
    if (removal.kind === 'count') {
      setTerminals((current) => current.slice(0, removal.count));
      setOpenProfileIndex(null);
      setOpenStartupIndices((current) => new Set([...current].filter((index) => index < removal.count)));
      return;
    }
    if (removal.kind === 'terminal') {
      removeTerminal(removal.terminalIndex);
      return;
    }
    removeStartupCommand(removal.terminalIndex, removal.commandIndex);
  };

  const moveStartupCommand = (terminalIndex: number, commandIndex: number, offset: -1 | 1) => {
    const terminal = terminals[terminalIndex];
    const commands = [...(terminal?.startupCommands ?? [])];
    const targetIndex = commandIndex + offset;
    if (!terminal || targetIndex < 0 || targetIndex >= commands.length) return;
    [commands[commandIndex], commands[targetIndex]] = [commands[targetIndex], commands[commandIndex]];
    updateTerminal(terminalIndex, { ...terminal, startupCommands: commands });
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit || !selectedGroup) return;
    const normalizedTerminals = terminals.map((terminal) => {
      const startupCommands = sanitizeStartupCommands(terminal.startupCommands);
      const title = terminal.title?.trim();
      return {
        ...terminal,
        title: title || undefined,
        startupCommands,
        startupShellDialect: terminal.type === 'ssh' && startupCommands.length > 0
          ? terminal.startupShellDialect ?? 'posix'
          : undefined,
      };
    });
    const root = serializePaneTree(createWorkspaceRoot(normalizedTerminals), {}, { includeStartupCommands: true });
    onSubmit({
      id: genId('workspace'), name: name.trim() || 'Session', type: 'local', root,
      terminalCount: normalizedTerminals.length,
      splitDirection: root.type === 'split' ? root.direction : 'vertical',
    }, selectedGroup);
  };

  return (
    <>
    <form className="workspace-form" onSubmit={handleSubmit}>
      <fieldset className="workspace-creation-fields" disabled={submitting}>
      {folder ? <p className="main-directory-path">{folder.directory}</p> : <label className="form-field"><span>Workspace</span><select className="form-input" aria-label="Workspace" value={groupId} onChange={(event) => setGroupId(event.target.value)}>{groups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}</select></label>}
      <label className="form-field">
        <span>{folder ? 'Session name (optional)' : 'Project name'}</span>
        <input className="form-input" value={name} onChange={(event) => setName(event.target.value)} placeholder={folder ? 'e.g. Development' : 'My development setup'} aria-label={folder ? 'Session name (optional)' : 'Project name'} maxLength={128} required={!folder} />
      </label>
      <label className="form-field"><span>Initial terminals</span><select className="form-input" aria-label="Initial terminals" value={terminals.length} onChange={(event) => {
        const count = Number(event.target.value);
        if (count < terminals.length) setPendingRemoval({ kind: 'count', count });
        else setTerminals((current) => [...current, ...Array.from({ length: count - current.length }, (): WorkspaceTerminal => ({ type: 'local' }))]);
      }}>{Array.from({ length: 16 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1} {index === 0 ? 'terminal' : 'terminals'}</option>)}</select></label>
      <p className="workspace-form-help">Choose local or SSH for each terminal. Your {folder ? 'session' : 'project'} and layout restore automatically when JaneT reopens.</p>
      <div className="workspace-terminal-list">
        {terminals.map((terminal, index) => (
          <div className="workspace-terminal-entry" key={index} role="group" aria-label={`Terminal ${index + 1} configuration`}>
            <div className="workspace-terminal-label-row">
              <span className="workspace-terminal-label">Terminal {index + 1}</span>
              {terminals.length > 1 && (
                <Tooltip label={`Remove terminal ${index + 1}`} placement="left">
                  <button type="button" className="workspace-terminal-remove" aria-label={`Remove terminal ${index + 1}`} onClick={() => setPendingRemoval({ kind: 'terminal', terminalIndex: index })}>
                    <XCloseIcon size="xs" />
                  </button>
                </Tooltip>
              )}
            </div>
            <input
              className="form-input"
              value={terminal.title ?? ''}
              maxLength={256}
              onChange={(event) => updateTerminal(index, { ...terminal, title: event.target.value || undefined })}
              placeholder="Name (optional)"
              aria-label={`Terminal ${index + 1} name (optional)`}
            />
            <div className="workspace-terminal-type" role="group" aria-label={`Terminal ${index + 1} type`}>
              <button id={`${formId}-terminal-${index}-type-local`} type="button" aria-pressed={terminal.type === 'local'} className={terminal.type === 'local' ? 'active' : ''} onClick={() => updateTerminal(index, { ...terminal, type: 'local', cwd: terminal.type === 'local' ? terminal.cwd : undefined, sshProfileId: undefined })}>Local terminal</button>
              <button id={`${formId}-terminal-${index}-type-ssh`} type="button" aria-pressed={terminal.type === 'ssh'} className={terminal.type === 'ssh' ? 'active' : ''} onClick={() => updateTerminal(index, { ...terminal, type: 'ssh', cwd: undefined, sshProfileId: terminal.type === 'ssh' ? terminal.sshProfileId : undefined, startupShellDialect: terminal.startupShellDialect ?? 'posix' })}>SSH connection</button>
            </div>
            {terminal.type === 'local' ? (
              <input className="form-input" value={terminal.cwd ?? ''} onChange={(event) => updateTerminal(index, { ...terminal, cwd: event.target.value || undefined })} placeholder={folder ? 'Directory override (blank = linked folder)' : 'Directory override (blank = workspace folder)'} aria-label={`Terminal ${index + 1} directory`} />
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
            <div className="workspace-startup">
              <button
                type="button"
                className="workspace-startup-toggle"
                aria-expanded={openStartupIndices.has(index)}
                aria-controls={`${formId}-terminal-${index}-startup`}
                onClick={() => toggleStartupCommands(index)}
              >
                <span>{openStartupIndices.has(index) ? <ChevronDownIcon size="xs" /> : <ChevronRightIcon size="xs" />} Startup commands</span>
                <span className="workspace-startup-count">
                  {sanitizeStartupCommands(terminal.startupCommands).length > 0
                    ? sanitizeStartupCommands(terminal.startupCommands).length
                    : 'Optional'}
                </span>
              </button>
              {openStartupIndices.has(index) && (
                <div className="workspace-startup-editor" id={`${formId}-terminal-${index}-startup`}>
                  {terminal.type === 'ssh' && (
                    <label className="workspace-startup-dialect">
                      <span>Remote shell syntax</span>
                      <select
                        className="form-input"
                        aria-label={`Terminal ${index + 1} remote shell syntax`}
                        value={terminal.startupShellDialect ?? 'posix'}
                        onChange={(event) => updateTerminal(index, {
                          ...terminal,
                          startupShellDialect: event.target.value as StartupShellDialect,
                        })}
                      >
                        <option value="posix">POSIX (sh, bash, zsh)</option>
                        <option value="fish">Fish</option>
                        <option value="powershell">PowerShell</option>
                      </select>
                    </label>
                  )}
                  {(terminal.startupCommands?.length ?? 0) > 0 && (
                    <ol className="workspace-startup-list">
                      {(terminal.startupCommands ?? []).map((command, commandIndex) => (
                        <li className="workspace-startup-row" key={commandIndex}>
                          <input
                            id={`${formId}-terminal-${index}-command-${commandIndex}`}
                            className="form-input workspace-startup-command"
                            value={command}
                            maxLength={MAX_STARTUP_COMMAND_LENGTH}
                            onChange={(event) => updateStartupCommand(index, commandIndex, event.target.value)}
                            placeholder={commandIndex === 0 ? 'e.g. hermes doctor' : 'Next command'}
                            aria-label={`Terminal ${index + 1} startup command ${commandIndex + 1}`}
                          />
                          <div className="workspace-startup-actions">
                            <Tooltip label={`Move startup command ${commandIndex + 1} up`} placement="top">
                              <button type="button" disabled={commandIndex === 0} aria-label={`Move startup command ${commandIndex + 1} up`} onClick={() => moveStartupCommand(index, commandIndex, -1)}><ArrowUpIcon size="xs" /></button>
                            </Tooltip>
                            <Tooltip label={`Move startup command ${commandIndex + 1} down`} placement="top">
                              <button type="button" disabled={commandIndex === (terminal.startupCommands?.length ?? 0) - 1} aria-label={`Move startup command ${commandIndex + 1} down`} onClick={() => moveStartupCommand(index, commandIndex, 1)}><ArrowDownIcon size="xs" /></button>
                            </Tooltip>
                            <Tooltip label={`Remove startup command ${commandIndex + 1}`} placement="top">
                              <button type="button" className="danger" aria-label={`Remove startup command ${commandIndex + 1}`} onClick={() => setPendingRemoval({ kind: 'command', terminalIndex: index, commandIndex })}><XCloseIcon size="xs" /></button>
                            </Tooltip>
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                  <button
                    id={`${formId}-terminal-${index}-add-command`}
                    type="button"
                    className="workspace-startup-add"
                    disabled={(terminal.startupCommands?.length ?? 0) >= MAX_STARTUP_COMMANDS}
                    onClick={() => addStartupCommand(index)}
                  >
                    <PlusIcon size="xs" /> Add command
                  </button>
                  <p className="workspace-form-help">Commands run in order and stop if one fails. Local commands wait for a detected prompt when supported; other recognized shells use a short fallback delay. Submitting an answer to a local profile prompt cancels the pane's automation. SSH begins when its shell channel opens. Put interactive commands last.</p>
                  {terminal.type === 'ssh' && <p className="workspace-form-help">Typing before the remote channel opens cancels automation. Avoid remote login scripts that prompt for input.</p>}
                  <p className="workspace-form-help workspace-startup-warning">Commands are stored with this workspace and may appear in shell history. Don’t include passwords or tokens.</p>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      {missingSshProfileIndex >= 0 && (
        <div className="workspace-form-help is-error" role="alert">
          Terminal {missingSshProfileIndex + 1} needs a saved SSH connection.
        </div>
      )}
      {oversizedStartupIndex >= 0 && (
        <div className="workspace-form-help is-error" role="alert">
          Terminal {oversizedStartupIndex + 1} startup commands exceed {MAX_STARTUP_COMMAND_TOTAL_LENGTH.toLocaleString()} characters.
        </div>
      )}
      <button id={`${formId}-add-terminal`} className="workspace-add-btn" type="button" disabled={terminals.length >= 16} onClick={() => setTerminals((current) => [...current, { type: 'local' }])}><PlusIcon size="xs" /> Add terminal</button>
      </fieldset>
      <button className="connect-btn" type="submit" disabled={!canSubmit}>{submitLabel}</button>
    </form>
    <ConfirmationDialog
      open={pendingRemoval !== null}
      title={pendingRemoval?.kind === 'terminal'
        ? `Remove terminal ${pendingRemoval.terminalIndex + 1}?`
        : pendingRemoval?.kind === 'command'
          ? `Remove startup command ${pendingRemoval.commandIndex + 1}?`
          : 'Reduce initial terminals?'}
      description={pendingRemoval?.kind === 'terminal'
        ? 'Remove this terminal and its startup commands from the new workspace draft?'
        : pendingRemoval?.kind === 'count' ? `Keep the first ${pendingRemoval.count} terminals? Configuration for the remaining terminals will be removed from this draft.` : 'Remove this startup command from the new workspace draft?'}
      confirmLabel={pendingRemoval?.kind === 'count' ? 'Reduce terminals' : pendingRemoval?.kind === 'terminal' ? 'Remove terminal' : 'Remove command'}
      onCancel={() => setPendingRemoval(null)}
      onConfirm={confirmRemoval}
    />
    </>
  );
}
