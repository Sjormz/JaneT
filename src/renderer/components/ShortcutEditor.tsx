import React, { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useKeybindings } from '../KeybindingsContext';
import { useModalFocus } from '../useModalFocus';
import {
  KeybindingAction,
  KEYBINDING_LABELS,
  formatShortcut,
  formatShortcutForDisplay,
} from '../keybindings';
import { PencilIcon, XCloseIcon } from '../icons';
import Tooltip from './Tooltip';
import ConfirmationDialog from './ConfirmationDialog';

interface ShortcutEditorProps {
  open: boolean;
  onClose: () => void;
}

export default function ShortcutEditor({ open, onClose }: ShortcutEditorProps) {
  const { bindings, setBinding, resetDefaults } = useKeybindings();
  const [capturing, setCapturing] = useState<KeybindingAction | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const captureInputRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  useModalFocus({
    open,
    containerRef: modalRef,
    onClose,
    initialFocusSelector: '[data-shortcut-close]',
  });

  useEffect(() => {
    if (open) return;
    setCapturing(null);
    setConfirmingReset(false);
  }, [open]);

  useEffect(() => {
    if (capturing && captureInputRef.current) {
      captureInputRef.current.focus();
    }
  }, [capturing]);

  const handleStartCapture = useCallback((action: KeybindingAction) => {
    setCapturing(action);
  }, []);

  const handleCaptureKey = useCallback(
    (action: KeybindingAction) => (e: React.KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Backspace' || e.key === 'Delete') {
        setBinding(action, '');
        setCapturing(null);
        return;
      }
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
      const shortcut = formatShortcut(e.nativeEvent);
      if (!shortcut.includes('+') && !/^F(?:[1-9]|1[0-2])$/.test(shortcut)) return;
      setBinding(action, shortcut);
      setCapturing(null);
    },
    [setBinding],
  );

  const keys = Object.keys(KEYBINDING_LABELS) as KeybindingAction[];
  const platform = navigator.platform.toLowerCase().includes('mac') ? 'darwin' : '';

  if (!open) return null;

  return createPortal(
    <div
      className="workspace-modal-overlay"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={modalRef}
        className="workspace-modal shortcut-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcut-modal-title"
      >
        <div className="workspace-modal-header">
          <h2 id="shortcut-modal-title">Keyboard shortcuts</h2>
          <Tooltip label="Close keyboard shortcuts" shortcut="Esc" placement="left">
            <button type="button" data-shortcut-close onClick={onClose} aria-label="Close keyboard shortcuts">
              <XCloseIcon size="sm" />
            </button>
          </Tooltip>
        </div>
        <div className="shortcut-editor">
      <div className="shortcut-list">
        {keys.map((action) => {
          const shortcut = bindings[action];
          const displayedShortcut = shortcut ? formatShortcutForDisplay(shortcut, platform) : 'unassigned';
          return <div key={action} className="shortcut-row">
            <span className="shortcut-label">{KEYBINDING_LABELS[action]}</span>
            {capturing === action ? (
              <div
                ref={captureInputRef}
                className="shortcut-key capturing"
                tabIndex={0}
                role="textbox"
                aria-label={`Press a shortcut for ${KEYBINDING_LABELS[action]}`}
                onKeyDown={handleCaptureKey(action)}
                onBlur={() => setCapturing(null)}
              >
                <span>Press a shortcut…</span>
                <small>Include a modifier, or press F1–F12</small>
              </div>
            ) : (
              <Tooltip label={`Change shortcut for ${KEYBINDING_LABELS[action]}`} shortcut={displayedShortcut} placement="left">
                <button
                  className="shortcut-key"
                  onClick={() => handleStartCapture(action)}
                  aria-label={`${KEYBINDING_LABELS[action]} (currently ${displayedShortcut})`}
                >
                  <span className="shortcut-keys-text">{displayedShortcut}</span>
                  <PencilIcon size="xs" className="shortcut-edit-icon" />
                </button>
              </Tooltip>
            )}
          </div>;
        })}
      </div>
      <button className="shortcut-reset-btn" onClick={() => setConfirmingReset(true)}>
        Reset shortcuts to defaults
      </button>
      <ConfirmationDialog
        open={confirmingReset}
        title="Reset all keyboard shortcuts?"
        description="This replaces every custom keyboard shortcut with JaneT’s defaults."
        confirmLabel="Reset shortcuts"
        onConfirm={() => {
          setConfirmingReset(false);
          resetDefaults();
        }}
        onCancel={() => setConfirmingReset(false)}
      />
        </div>
      </div>
    </div>,
    document.body,
  );
}
