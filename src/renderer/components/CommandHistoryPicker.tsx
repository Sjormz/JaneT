import React, { useEffect, useMemo, useRef, useState } from 'react';
import { TrashIcon, XCloseIcon } from '../icons';
import { useModalFocus } from '../useModalFocus';
import { commandHistoryContextLabel, type CommandHistoryEntry } from '../../shared/commandHistory';
import Tooltip from './Tooltip';

interface Props {
  visible: boolean;
  entries: CommandHistoryEntry[];
  runningIds?: ReadonlySet<string>;
  onClose: () => void;
  onSelect: (entry: CommandHistoryEntry) => void;
  onRemove?: (entry: CommandHistoryEntry) => void;
}

export default function CommandHistoryPicker({ visible, entries, runningIds, onClose, onSelect, onRemove }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const removeRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  useModalFocus({ open: visible, containerRef: panelRef, initialFocusSelector: '[aria-label="Search command history"]', onClose });
  const filtered = useMemo(() => entries.filter((entry) => {
    const text = `${entry.command} ${entry.context.kind === 'ssh' ? commandHistoryContextLabel(entry.context) : ''}`.toLocaleLowerCase();
    return text.includes(query.toLocaleLowerCase());
  }), [entries, query]);
  useEffect(() => setSelected(0), [query, entries]);
  if (!visible) return null;
  const choose = (entry: CommandHistoryEntry) => { onSelect(entry); onClose(); };
  const focusOption = (index: number) => {
    setSelected(index);
    optionRefs.current[index]?.focus();
  };
  const keyDown = (event: React.KeyboardEvent) => {
    if (!filtered.length) return;
    if (event.key === 'Tab' && !event.shiftKey && event.currentTarget === searchRef.current) { event.preventDefault(); optionRefs.current[selected]?.focus(); }
    else if (event.key === 'Tab' && !event.shiftKey) { event.preventDefault(); (onRemove ? removeRefs.current[selected] : closeRef.current)?.focus(); }
    else if (event.key === 'Tab' && event.shiftKey && event.currentTarget !== searchRef.current) { event.preventDefault(); searchRef.current?.focus(); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); focusOption((selected + 1) % filtered.length); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); focusOption((selected - 1 + filtered.length) % filtered.length); }
    else if (event.key === 'Home') { event.preventDefault(); focusOption(0); }
    else if (event.key === 'End') { event.preventDefault(); focusOption(filtered.length - 1); }
    else if (event.key === 'Enter') { event.preventDefault(); choose(filtered[selected]); }
  };
  return <div className="snippet-picker-overlay" role="presentation">
    <div ref={panelRef} className="snippet-picker" role="dialog" aria-modal="true" aria-label="Command history">
      <div className="snippet-picker-heading">
        <h2>Command history</h2>
        <Tooltip label="Close command history" shortcut="Esc" placement="left">
          <button ref={closeRef} type="button" className="command-history-close" onKeyDown={(event) => { if (event.key === 'Tab' && event.shiftKey) { event.preventDefault(); ((onRemove ? removeRefs.current[selected] : optionRefs.current[selected]) ?? searchRef.current)?.focus(); } }} onClick={onClose} aria-label="Close command history"><XCloseIcon size="sm" /></button>
        </Tooltip>
      </div>
      <div className="snippet-search-shell">
        <input className="command-history-search" ref={searchRef} role="combobox" aria-label="Search command history" aria-controls="command-history-list" aria-expanded="true" aria-activedescendant={filtered[selected] ? `command-history-${filtered[selected].id}` : undefined} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={keyDown} />
      </div>
      <div id="command-history-list" className="command-history-list" role="listbox">
        {filtered.map((entry, index) => <div className="command-history-row" role="presentation" key={entry.id}>
          <button ref={(element) => { optionRefs.current[index] = element; }} className="command-history-item" id={`command-history-${entry.id}`} role="option" aria-selected={index === selected} tabIndex={index === selected ? 0 : -1} onFocus={() => setSelected(index)} onMouseEnter={() => setSelected(index)} onKeyDown={keyDown} onClick={() => choose(entry)}>
            <span>{entry.command}</span>
            {(entry.context.kind === 'ssh' || runningIds?.has(entry.id)) && <small>{[
              entry.context.kind === 'ssh' ? commandHistoryContextLabel(entry.context) : null,
              runningIds?.has(entry.id) ? 'Running' : null,
            ].filter(Boolean).join(' · ')}</small>}
          </button>
          {onRemove && <Tooltip label={`Remove ${entry.command} from command history`} placement="left">
            <button ref={(element) => { removeRefs.current[index] = element; }} type="button" className="command-history-remove" tabIndex={-1} aria-label={`Remove ${entry.command} from command history`} onKeyDown={(event) => {
              if (event.key === 'Tab') { event.preventDefault(); (event.shiftKey ? optionRefs.current[index] : closeRef.current)?.focus(); }
            }} onClick={() => { onRemove(entry); searchRef.current?.focus(); }}><TrashIcon size="xs" /></button>
          </Tooltip>}
        </div>)}
      </div>
    </div>
  </div>;
}
