import React, { ReactNode, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useModalFocus } from '../useModalFocus';

interface ConfirmationDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  cancelLabel?: string;
  secondaryLabel?: string;
  onSecondary?: () => void;
  destructive?: boolean;
  busy?: boolean;
  fallbackFocus?: () => HTMLElement | null;
}

export default function ConfirmationDialog({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
  cancelLabel = 'Cancel',
  secondaryLabel,
  onSecondary,
  destructive = true,
  busy = false,
  fallbackFocus,
}: ConfirmationDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const requestCancel = () => {
    if (!busy) onCancel();
  };
  const requestConfirm = () => {
    if (busy) return;
    const focusAfterClose = fallbackFocus;
    onConfirm();
    requestAnimationFrame(() => {
      if (!dialogRef.current?.isConnected) focusAfterClose?.()?.focus();
    });
  };

  useModalFocus({
    open,
    containerRef: dialogRef,
    onClose: requestCancel,
    initialFocusSelector: '[data-confirmation-cancel]',
    fallbackFocus,
  });

  if (!open) return null;

  return createPortal(
    <div
      className="confirmation-dialog-overlay"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) requestCancel();
      }}
    >
      <div
        ref={dialogRef}
        className="confirmation-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={busy || undefined}
      >
        <h2 id={titleId} className="confirmation-dialog-title">{title}</h2>
        <div id={descriptionId} className="confirmation-dialog-description">{description}</div>
        <div className="confirmation-dialog-actions">
          <button
            type="button"
            className="confirmation-dialog-button cancel"
            data-confirmation-cancel
            disabled={busy}
            onClick={requestCancel}
          >
            {cancelLabel}
          </button>
          {secondaryLabel && onSecondary && (
            <button
              type="button"
              className="confirmation-dialog-button secondary"
              disabled={busy}
              onClick={onSecondary}
            >
              {secondaryLabel}
            </button>
          )}
          <button
            type="button"
            className={`confirmation-dialog-button confirm${destructive ? ' danger' : ''}`}
            disabled={busy}
            onClick={requestConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
