import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import SSHConnectionNotice from '../../src/renderer/components/SSHConnectionNotice';

describe('SSHConnectionNotice', () => {
  it('renders nothing when state is hidden', () => {
    const { container } = render(<SSHConnectionNotice state={{ kind: 'hidden' }} />);
    expect(container.querySelector('[data-testid="ssh-terminal-notice"]')).toBeNull();
  });

  it('renders the "waiting" banner with the host label', () => {
    render(
      <SSHConnectionNotice
        state={{ kind: 'waiting' }}
        label="test.example.com"
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByTestId('ssh-terminal-notice')).toBeInTheDocument();
    expect(screen.getByText('Opening remote shell')).toBeInTheDocument();
    expect(screen.getByText('Connected to test.example.com. Waiting for first output.')).toBeInTheDocument();
    expect(screen.queryByTestId('ssh-notice-retry')).toBeNull();
  });

  it('renders the "stalled" banner with a retry button', () => {
    const onRetry = vi.fn();
    render(<SSHConnectionNotice state={{ kind: 'stalled' }} onRetry={onRetry} />);

    expect(screen.getByTestId('ssh-terminal-notice')).toHaveAttribute('data-state', 'stalled');
    expect(screen.getByText('No response from remote shell')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('ssh-notice-retry'));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('renders the "error" banner with the error message', () => {
    render(
      <SSHConnectionNotice
        state={{ kind: 'error', message: 'connect ECONNREFUSED' }}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByTestId('ssh-terminal-notice')).toHaveAttribute('data-state', 'error');
    expect(screen.getByText('Couldn’t open remote shell')).toBeInTheDocument();
    expect(screen.getByText('connect ECONNREFUSED')).toBeInTheDocument();
  });

  it('renders the "reconnecting" banner without retry/dismiss buttons', () => {
    render(
      <SSHConnectionNotice
        state={{ kind: 'reconnecting' }}
        onRetry={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByTestId('ssh-terminal-notice')).toHaveAttribute('data-state', 'reconnecting');
    expect(screen.getByText('Reconnecting to remote shell')).toBeInTheDocument();
    expect(screen.queryByTestId('ssh-notice-retry')).toBeNull();
    expect(screen.queryByTestId('ssh-notice-dismiss')).toBeNull();
  });

  it('hides the notice when the user clicks Dismiss', () => {
    const onDismiss = vi.fn();
    render(<SSHConnectionNotice state={{ kind: 'waiting' }} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByTestId('ssh-notice-dismiss'));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('describes a closed connection separately from a shell-open failure', () => {
    render(<SSHConnectionNotice state={{ kind: 'closed' }} onRetry={vi.fn()} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Connection closed');
    expect(screen.getByText('Reconnect to open a new remote shell.')).toBeInTheDocument();
    expect(screen.getByTestId('ssh-notice-retry')).toBeInTheDocument();
  });
});
