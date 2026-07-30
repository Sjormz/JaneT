import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useModalFocus } from '../useModalFocus';

interface RenameDialogProps {
  open: boolean;
  title: string;
  inputLabel: string;
  initialValue: string;
  onSave: (value: string) => void;
  onCancel: () => void;
  fallbackFocus: () => HTMLElement | null;
}

export default function RenameDialog({
  open,
  title,
  inputLabel,
  initialValue,
  onSave,
  onCancel,
  fallbackFocus,
}: RenameDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();

  useModalFocus({
    open,
    containerRef: dialogRef,
    onClose: onCancel,
    initialFocusSelector: 'input',
    fallbackFocus,
  });

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => inputRef.current?.select());
    return () => cancelAnimationFrame(frame);
  }, [initialValue, open]);

  if (!open) return null;

  return createPortal(
    <div className="confirmation-dialog-overlay" role="presentation">
      <div
        ref={dialogRef}
        className="confirmation-dialog rename-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId} className="confirmation-dialog-title">{title}</h2>
        <label className="form-field">
          <span>{inputLabel}</span>
          <input
            ref={inputRef}
            className="form-input"
            aria-label={inputLabel}
            maxLength={256}
            defaultValue={initialValue}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
              event.preventDefault();
              onSave(event.currentTarget.value);
            }}
          />
        </label>
        <div className="confirmation-dialog-actions">
          <button type="button" className="confirmation-dialog-button cancel" onClick={onCancel}>Cancel</button>
          <button type="button" className="confirmation-dialog-button confirm" onClick={() => onSave(inputRef.current?.value ?? '')}>Save</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
