import React from 'react';
import { ServerIcon, XCloseIcon, RefreshIcon, AlertIcon, UnplugIcon } from '../icons';
import Tooltip from './Tooltip';

type SshNoticeKind = 'waiting' | 'stalled' | 'closed' | 'error' | 'reconnecting';

interface SSHConnectionNoticeProps {
  /** The current notice state, or null when the notice should be hidden. */
  state:
    | { kind: 'hidden' }
    | { kind: 'waiting' }
    | { kind: 'stalled' }
    | { kind: 'closed' }
    | { kind: 'error'; message: string }
    | { kind: 'reconnecting' };
  /** Host label, e.g. "pckpr@box.local:22". */
  label?: string;
  /** User dismisses the notice (closes it but keeps the shell). */
  onDismiss?: () => void;
  /** User clicks "Retry" — App will re-run ssh:createShell. */
  onRetry?: () => void;
}

const COPY: Record<SshNoticeKind, { title: string; sub: (label?: string) => string }> = {
  waiting: {
    title: 'Opening remote shell',
    sub: (label) => (label ? `Connected to ${label}. Waiting for first output.` : 'Waiting for first output.'),
  },
  stalled: {
    title: 'No response from remote shell',
    sub: () => 'No output has arrived. You can keep waiting or reconnect.',
  },
  closed: {
    title: 'Connection closed',
    sub: () => 'Reconnect to open a new remote shell.',
  },
  error: {
    title: 'Couldn’t open remote shell',
    sub: () => 'Reconnect to try again.',
  },
  reconnecting: {
    title: 'Reconnecting to remote shell',
    sub: () => 'Opening a new shell on the SSH connection.',
  },
};

export default function SSHConnectionNotice({
  state, label, onDismiss, onRetry,
}: SSHConnectionNoticeProps) {
  if (state.kind === 'hidden') return null;
  const copy = COPY[state.kind];
  const isError = state.kind === 'error' || state.kind === 'closed';
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
        {state.kind === 'closed'
          ? <UnplugIcon size="sm" />
          : state.kind === 'error' || isStalled
            ? <AlertIcon size="sm" />
            : state.kind === 'reconnecting'
              ? <RefreshIcon size="sm" className="ssh-notice-spin" />
              : <ServerIcon size="sm" />}
      </div>
      <div className="ssh-terminal-notice-text">
        <div className="ssh-terminal-notice-title">{copy.title}</div>
        <div className="ssh-terminal-notice-subtitle">{copy.sub(label)}</div>
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
        </div>
      </div>
      {onDismiss && !isBusy && (
        <Tooltip label="Dismiss connection notice" placement="left">
          <button
            type="button"
            className="ssh-terminal-notice-close"
            onClick={onDismiss}
            data-testid="ssh-notice-dismiss"
            aria-label="Dismiss connection notice"
          >
            <XCloseIcon size="xs" />
          </button>
        </Tooltip>
      )}
    </div>
  );
}
