import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import packageJson from '../../package.json';
import StatusBar from '../../src/renderer/components/StatusBar';

const defaultProps = {
  sshSessions: [],
  activeTerminalsCount: 1,
  cwd: '/Users/pckpr/projects/janet',
};

describe('StatusBar', () => {
  it('renders the app version from package.json', () => {
    render(<StatusBar {...defaultProps} />);

    expect(screen.getByText(`v${packageJson.version}`)).toBeInTheDocument();
  });

  it('renders the cwd and terminal count', () => {
    render(<StatusBar {...defaultProps} activeTerminalsCount={2} cwd="C:/work/barrel-racer" />);

    expect(screen.getByText('2 terminals')).toBeInTheDocument();
    expect(screen.getByText('C:/work/barrel-racer')).toBeInTheDocument();
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

    expect(screen.getByText('build.example.com · remote cwd unavailable')).toBeInTheDocument();
    expect(screen.queryByText('/Users/local-user')).toBeNull();
  });
});
