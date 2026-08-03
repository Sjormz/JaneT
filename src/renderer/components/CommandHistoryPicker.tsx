import React, { useEffect, useMemo, useRef, useState } from 'react';
import { XCloseIcon } from '../icons';
import { useModalFocus } from '../useModalFocus';
import { commandHistoryContextLabel, type CommandHistoryEntry } from '../../shared/commandHistory';
import Tooltip from './Tooltip';

interface Props {
  visible: boolean;
  entries: CommandHistoryEntry[];
  onClose: () => void;
  onSelect: (entry: CommandHistoryEntry) => void;
}

export default function CommandHistoryPicker({ visible, entries, onClose, onSelect }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [context, setContext] = useState('all');
  const [outcome, setOutcome] = useState('all');
  const [selected, setSelected] = useState(0);
  useModalFocus({ open: visible, containerRef: panelRef, initialFocusSelector: '[aria-label="Search command history"]', onClose });
  const filtered = useMemo(() => entries.filter((entry) => {
    const text = `${entry.command} ${commandHistoryContextLabel(entry.context)}`.toLocaleLowerCase();
    const status = entry.exitCode === 0 ? 'success' : entry.exitCode === undefined ? 'unknown' : 'failure';
    return text.includes(query.toLocaleLowerCase())
      && (context === 'all' || entry.context.kind === context)
      && (outcome === 'all' || status === outcome);
  }), [context, entries, outcome, query]);
  useEffect(() => setSelected(0), [query, context, outcome]);
  if (!visible) return null;
  const choose = (entry: CommandHistoryEntry) => { onSelect(entry); onClose(); };
  const keyDown = (event: React.KeyboardEvent) => {
    if (!filtered.length) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); setSelected((selected + 1) % filtered.length); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setSelected((selected - 1 + filtered.length) % filtered.length); }
    else if (event.key === 'Home') { event.preventDefault(); setSelected(0); }
    else if (event.key === 'End') { event.preventDefault(); setSelected(filtered.length - 1); }
    else if (event.key === 'Enter') { event.preventDefault(); choose(filtered[selected]); }
  };
  return <div className="snippet-picker-overlay" role="presentation">
    <div ref={panelRef} className="snippet-picker" role="dialog" aria-modal="true" aria-label="Command history">
      <div className="snippet-picker-heading">
        <h2>Command history</h2>
        <Tooltip label="Close command history" shortcut="Esc" placement="left">
          <button type="button" className="command-history-close" onClick={onClose} aria-label="Close command history"><XCloseIcon size="sm" /></button>
        </Tooltip>
      </div>
      <div className="snippet-search-shell command-history-filters">
        <input className="command-history-search" ref={searchRef} role="combobox" aria-label="Search command history" aria-controls="command-history-list" aria-expanded="true" aria-activedescendant={filtered[selected] ? `command-history-${filtered[selected].id}` : undefined} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={keyDown} />
        <label className="command-history-filter">Context <select value={context} onChange={(e) => setContext(e.target.value)}><option value="all">All</option><option value="local">Local</option><option value="ssh">SSH</option></select></label>
        <label className="command-history-filter">Outcome <select value={outcome} onChange={(e) => setOutcome(e.target.value)}><option value="all">All</option><option value="success">Success</option><option value="failure">Failure</option></select></label>
      </div>
      <div id="command-history-list" className="command-history-list" role="listbox">
        {filtered.map((entry, index) => <button className="command-history-item" id={`command-history-${entry.id}`} role="option" aria-selected={index === selected} key={entry.id} onMouseEnter={() => setSelected(index)} onClick={() => choose(entry)}>
          <span>{entry.command}</span><small>{commandHistoryContextLabel(entry.context)}</small>
        </button>)}
      </div>
    </div>
  </div>;
}
