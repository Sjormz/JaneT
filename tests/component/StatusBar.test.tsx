import { beforeEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import StatusBar from '../../src/renderer/components/StatusBar';

const defaultProps = {
  cwd: '/Users/pckpr/projects/janet',
};

const checkForUpdates = vi.fn();
const getVersion = vi.fn();

beforeEach(() => {
  checkForUpdates.mockReset().mockResolvedValue(undefined);
  getVersion.mockReset().mockReturnValue(new Promise(() => {}));
  Object.defineProperty(window, 'janet', {
    configurable: true,
    value: {
      getVersion,
      checkForUpdates,
    },
  });
});

describe('StatusBar', () => {
  it('abbreviates the home directory but keeps the full path in the accessible name', () => {
    render(<StatusBar {...defaultProps} cwd="/Users/demo/projects/app" homeDir="/Users/demo" />);
    expect(screen.getByText('~/projects/app')).toBeInTheDocument();
    expect(screen.getByLabelText('Working directory: /Users/demo/projects/app')).toBeInTheDocument();
  });

  it('keeps the status bar focused on live working context', () => {
    render(<StatusBar {...defaultProps} cwd="C:/work/barrel-racer" />);

    expect(screen.getByText('C:/work/barrel-racer')).toBeInTheDocument();
    // Only live context: no static LOCAL or BUILD labels.
    expect(screen.queryByText('LOCAL')).not.toBeInTheDocument();
    expect(screen.queryByText('BUILD')).not.toBeInTheDocument();
    expect(screen.queryByText(/terminal/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/MacIntel|Win32/i)).not.toBeInTheDocument();
  });

  it('marks a Git summary kept after a failed refresh as out of date', () => {
    const summary = {
      repoPath: '/repo', branch: 'main', ahead: 1, behind: 0, changed: 2, staged: 0, conflicted: 0,
    };
    const { rerender } = render(<StatusBar {...defaultProps} gitStatus={summary} />);
    const current = screen.getByLabelText(/^\/repo · main/);
    expect(current).not.toHaveClass('stale');
    expect(current.getAttribute('aria-label')).not.toMatch(/Out of date/);

    rerender(<StatusBar {...defaultProps} gitStatus={{ ...summary, staleReason: 'Git is not installed or is not on PATH.' }} />);
    const stale = screen.getByLabelText(/^\/repo · main/);
    expect(stale).toHaveClass('stale');
    expect(stale.getAttribute('aria-label')).toMatch(/Out of date: Git is not installed or is not on PATH\.$/);
  });

  it('shows the current version and checks for updates when clicked', async () => {
    getVersion.mockResolvedValue('0.6.1');
    render(<StatusBar {...defaultProps} />);

    const version = await screen.findByRole('button', {
      name: 'JaneT version 0.6.1. Check for updates',
    });
    expect(version).toHaveTextContent('v0.6.1');

    fireEvent.click(version);

    expect(checkForUpdates).toHaveBeenCalledOnce();
  });
});
