import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatusBar from '../../src/renderer/components/StatusBar';

const defaultProps = {
  sshSessions: [],
  cwd: '/Users/pckpr/projects/janet',
};

describe('StatusBar', () => {
  it('keeps the status bar focused on live working context', () => {
    render(<StatusBar {...defaultProps} cwd="C:/work/barrel-racer" />);

    expect(screen.getByText('C:/work/barrel-racer')).toBeInTheDocument();
    expect(screen.queryByText(/terminal/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/MacIntel|Win32/i)).not.toBeInTheDocument();
  });

  it('does not mislabel a local fallback path as the remote cwd', () => {
    render(
      <StatusBar
        {...defaultProps}
        cwd="/Users/local-user"
        isRemote
        remoteHost="build.example.com"
      />,
    );

    expect(screen.getByText('SSH · build.example.com')).toBeInTheDocument();
    expect(screen.queryByText('/Users/local-user')).toBeNull();
  });

  it('describes active SSH connections in plain language', () => {
    render(<StatusBar {...defaultProps} sshSessions={[{ id: 'one', host: 'one.example.com', port: 22 }, { id: 'two', host: 'two.example.com', port: 22 }]} />);

    expect(screen.getByText('2 SSH connections')).toBeInTheDocument();
  });
});
