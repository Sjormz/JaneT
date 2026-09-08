import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import WorkspaceForm from './WorkspaceForm';
import { XCloseIcon } from '../icons';
import { useModalFocus } from '../useModalFocus';
import type { WorkspaceGroup } from '../../shared/workspaceGroups';
import type { WorkspaceTabPreset } from '../types';

export default function AddTerminalsDialog({ group, onSubmit, onClose, inline = false }: {
  inline?: boolean;
  group: WorkspaceGroup;
  onSubmit: (preset: WorkspaceTabPreset) => Promise<void>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const close = () => { if (!busy) onClose(); };
  useModalFocus({ open: !inline, containerRef: ref, onClose: close, initialFocusSelector: 'input[type="number"]' });
  const title = inline ? 'Start session' : 'Add terminals';
  const content = <div ref={ref} className={inline ? 'empty-project-terminals' : 'workspace-modal'} role={inline ? 'region' : 'dialog'} aria-modal={inline ? undefined : true} aria-label={title}>
      <div className="workspace-modal-header"><h2>{title}</h2>{!inline && <button aria-label="Close add terminals" disabled={busy} onClick={close}><XCloseIcon /></button>}</div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <WorkspaceForm terminalsOnly group={group} submitting={busy} submitLabel={busy ? inline ? 'Starting session…' : 'Adding terminals…' : title} onSubmit={async preset => {
        setBusy(true); setError('');
        try { await onSubmit(preset); onClose(); }
        catch (err) { setError(err instanceof Error ? err.message : String(err)); setBusy(false); }
      }} />
    </div>;
  return inline ? content : createPortal(<div className="workspace-modal-overlay" onPointerDown={event => { if (event.target === event.currentTarget) close(); }}>{content}</div>, document.body);
}
