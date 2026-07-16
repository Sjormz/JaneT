import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useKeybindings } from '../KeybindingsContext';
import {
  KeybindingAction,
  KEYBINDING_LABELS,
  formatShortcut,
  formatShortcutForDisplay,
} from '../keybindings';
import { PencilIcon } from '../icons';
import Tooltip from './Tooltip';
import ConfirmationDialog from './ConfirmationDialog';

export default function ShortcutEditor() {
  const { bindings, setBinding, resetDefaults } = useKeybindings();
  const [capturing, setCapturing] = useState<KeybindingAction | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const captureInputRef = useRef<HTMLDivElement>(null);

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
      const shortcut = formatShortcut(e.nativeEvent);
      // Require at least one modifier key
      if (!shortcut.includes('+')) return;
      setBinding(action, shortcut);
      setCapturing(null);
    },
    [setBinding],
  );

  const keys = Object.keys(KEYBINDING_LABELS) as KeybindingAction[];
  const platform = navigator.platform.toLowerCase().includes('mac') ? 'darwin' : '';

  return (
    <div className="shortcut-editor">
      <div className="shortcut-editor-header">
        <span className="section-title">Keyboard Shortcuts</span>
      </div>
      <div className="shortcut-list">
        {keys.map((action) => (
          <div key={action} className="shortcut-row">
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
                <small>Include Ctrl, Alt, Shift, or Command</small>
              </div>
            ) : (
              <Tooltip label={`Change shortcut for ${KEYBINDING_LABELS[action]}`} shortcut={formatShortcutForDisplay(bindings[action], platform)} placement="left">
                <button
                  className="shortcut-key"
                  onClick={() => handleStartCapture(action)}
                  aria-label={`Change shortcut for ${KEYBINDING_LABELS[action]} (currently ${bindings[action]})`}
                >
                  <span className="shortcut-keys-text">{formatShortcutForDisplay(bindings[action], platform)}</span>
                  <PencilIcon size="xs" className="shortcut-edit-icon" />
                </button>
              </Tooltip>
            )}
          </div>
        ))}
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
  );
}
