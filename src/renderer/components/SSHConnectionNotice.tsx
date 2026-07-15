import React from 'react';
import { ServerIcon, XCloseIcon, RefreshIcon, AlertIcon } from '../icons';

type SshNoticeKind = 'waiting' | 'stalled' | 'error' | 'reconnecting';

interface SSHConnectionNoticeProps {
  /** The current notice state, or null when the notice should be hidden. */
  state:
    | { kind: 'hidden' }
    | { kind: 'waiting' }
    | { kind: 'stalled' }
    | { kind: 'error'; message: string }
    | { kind: 'reconnecting' };
  /** Host label, e.g. "pckpr@box.local:22". */
  label?: string;
  /** User dismisses the notice (closes it but keeps the shell). */
  onDismiss?: () => void;
  /** User clicks "Retry" — App will re-run ssh:createShell. */
  onRetry?: () => void;
}

const COPY: Record<SshNoticeKind, { title: (label?: string) => string; sub: string }> = {
  waiting: {
    title: (label) => (label ? `Connected to ${label}` : 'SSH session connected'),
    sub: 'Waiting for shell output…',
  },
  stalled: {
    title: () => 'Shell is not responding',
    sub: 'No output from the remote shell for a while. You can wait, dismiss, or reconnect.',
  },
  error: {
    title: () => 'SSH shell failed to open',
    sub: 'See message below. The connection may have dropped — try reconnecting.',
  },
  reconnecting: {
    title: () => 'Reconnecting…',
    sub: 'Re-opening the SSH shell on the existing connection.',
  },
};

export default function SSHConnectionNotice({
  state, label, onDismiss, onRetry,
}: SSHConnectionNoticeProps) {
  if (state.kind === 'hidden') return null;
  const copy = COPY[state.kind];
  const isError = state.kind === 'error';
  const isStalled = state.kind === 'stalled';
  const isBusy = state.kind === 'reconnecting';
  const canRetry = Boolean(onRetry) && (isError || isStalled);

  return (
    <div
      className={`ssh-terminal-notice ${isError ? 'is-error' : ''} ${isStalled ? 'is-stalled' : ''}`}
      data-testid="ssh-terminal-notice"
      data-state={state.kind}
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
    >
      <div className="ssh-terminal-notice-icon">
        {isError ? <AlertIcon size="sm" /> : <ServerIcon size="sm" />}
      </div>
      <div className="ssh-terminal-notice-text">
        <div className="ssh-terminal-notice-title">{copy.title(label)}</div>
        <div className="ssh-terminal-notice-subtitle">{copy.sub}</div>
        {isError && state.kind === 'error' && (
          <div className="ssh-terminal-notice-message">{state.message}</div>
        )}
        <div className="ssh-terminal-notice-actions">
          {canRetry && !isBusy && (
            <button
              type="button"
              className="ssh-notice-action primary"
              onClick={onRetry}
              data-testid="ssh-notice-retry"
            >
              <RefreshIcon size="xs" /> Reconnect
            </button>
          )}
          {onDismiss && !isBusy && (
            <button
              type="button"
              className="ssh-notice-action"
              onClick={onDismiss}
              data-testid="ssh-notice-dismiss"
              aria-label="Dismiss SSH notice"
            >
              <XCloseIcon size="xs" /> Dismiss
            </button>
          )}
        </div>
      </div>
      {onDismiss && !isBusy && (
        <button
          type="button"
          className="ssh-terminal-notice-close"
          onClick={onDismiss}
          aria-label="Close SSH notice"
          title="Close"
        >
          <XCloseIcon size="xs" />
        </button>
      )}
    </div>
  );
}
