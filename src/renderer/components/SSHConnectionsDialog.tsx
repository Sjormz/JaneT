import React, { useRef } from 'react';
import { createPortal } from 'react-dom';
import SSHManager from './SSHManager';
import { useModalFocus } from '../useModalFocus';
import { XCloseIcon } from '../icons';

export default function SSHConnectionsDialog({ onClose, ...props }: React.ComponentProps<typeof SSHManager> & { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useModalFocus({ open: true, containerRef: ref, onClose });
  return createPortal(<div className="workspace-modal-overlay" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={ref} className="workspace-modal" role="dialog" aria-modal="true" aria-label="SSH connections">
      <div className="workspace-modal-header"><h2>SSH connections</h2><button onClick={onClose} aria-label="Close SSH connections"><XCloseIcon /></button></div>
      <SSHManager {...props} />
    </div>
  </div>, document.body);
}
