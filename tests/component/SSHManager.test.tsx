import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SSHManager from '../../src/renderer/components/SSHManager';
import { SavedSSHProfile, SessionInfo } from '../../src/renderer/types';

const sshConnect = vi.fn();
const sshDisconnect = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  sshConnect.mockResolvedValue({ connected: true });
  sshDisconnect.mockResolvedValue(undefined);
  Object.defineProperty(window, 'janet', {
    configurable: true,
    value: {
      sshConnect,
      sshDisconnect,
    },
  });
});

function renderSSHManager(props?: {
  profiles?: SavedSSHProfile[];
  onConnected?: (session: SessionInfo) => void;
  onProfilesChange?: (profiles: SavedSSHProfile[]) => void;
}) {
  return render(
    <SSHManager
      sshProfiles={props?.profiles ?? []}
      onConnected={props?.onConnected ?? vi.fn()}
      onProfilesChange={props?.onProfilesChange ?? vi.fn()}
    />,
  );
}

describe('SSHManager', () => {
  it('saves SSH profile details for one-click reconnect after connecting', async () => {
    const onConnected = vi.fn();
    const onProfilesChange = vi.fn();
    renderSSHManager({ onConnected, onProfilesChange });

    fireEvent.click(screen.getByRole('button', { name: /new connection/i }));
    fireEvent.change(screen.getByPlaceholderText(/host/i), { target: { value: 'box.local' } });
    fireEvent.change(screen.getByPlaceholderText(/username/i), { target: { value: 'pckpr' } });
    fireEvent.change(screen.getByPlaceholderText(/password/i), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: /connect & save/i }));

    await waitFor(() => {
      expect(sshConnect).toHaveBeenCalledWith(expect.objectContaining({
        host: 'box.local',
        port: 22,
        username: 'pckpr',
        auth: 'password',
        password: 'secret',
      }));
      expect(onConnected).toHaveBeenCalledWith(expect.objectContaining({
        host: 'box.local',
        port: 22,
        username: 'pckpr',
        sshProfileId: 'pckpr@box.local:22:password',
      }));
      expect(onProfilesChange).toHaveBeenCalledWith([
        {
          id: 'pckpr@box.local:22:password',
          host: 'box.local',
          port: 22,
          username: 'pckpr',
          auth: 'password',
          password: 'secret',
          privateKey: undefined,
        },
      ]);
    });
  });

  it('allows host-only SSH connections like ssh terminal.shop', async () => {
    const onConnected = vi.fn();
    const onProfilesChange = vi.fn();
    renderSSHManager({ onConnected, onProfilesChange });

    fireEvent.click(screen.getByRole('button', { name: /new connection/i }));
    fireEvent.change(screen.getByPlaceholderText(/host/i), { target: { value: 'terminal.shop' } });
    fireEvent.click(screen.getByRole('button', { name: /connect & save/i }));

    await waitFor(() => {
      expect(sshConnect).toHaveBeenCalledWith(expect.objectContaining({
        host: 'terminal.shop',
        port: 22,
        auth: 'password',
      }));
      expect(sshConnect.mock.calls[0][0]).not.toHaveProperty('username');
      expect(onConnected).toHaveBeenCalledWith(expect.objectContaining({
        host: 'terminal.shop',
        port: 22,
        sshProfileId: 'terminal.shop:22:password',
      }));
      expect(onConnected.mock.calls[0][0]).not.toHaveProperty('username');
      expect(onProfilesChange).toHaveBeenCalledWith([
        {
          id: 'terminal.shop:22:password',
          host: 'terminal.shop',
          port: 22,
          username: undefined,
          auth: 'password',
          password: undefined,
          privateKey: undefined,
        },
      ]);
    });
  });

  it('connects saved profiles in one click', async () => {
    const onConnected = vi.fn();
    renderSSHManager({
      onConnected,
      profiles: [{
        id: 'pckpr@box.local:22:password',
        host: 'box.local',
        port: 22,
        username: 'pckpr',
        auth: 'password',
        password: 'secret',
      }],
    });

    fireEvent.click(screen.getByRole('button', { name: /connect to pckpr@box.local/i }));

    await waitFor(() => {
      expect(sshConnect).toHaveBeenCalledWith(expect.objectContaining({
        host: 'box.local',
        port: 22,
        username: 'pckpr',
        auth: 'password',
        password: 'secret',
      }));
      expect(onConnected).toHaveBeenCalledWith(expect.objectContaining({
        host: 'box.local',
        port: 22,
        username: 'pckpr',
        sshProfileId: 'pckpr@box.local:22:password',
      }));
    });
  });

  it('identifies the saved profile while connecting and keeps failures visible with the form closed', async () => {
    let rejectConnection: (error: Error) => void = () => {};
    sshConnect.mockImplementationOnce(() => new Promise((_, reject) => { rejectConnection = reject; }));
    renderSSHManager({
      profiles: [{
        id: 'pckpr@box.local:22:password',
        host: 'box.local',
        port: 22,
        username: 'pckpr',
        auth: 'password',
      }],
    });

    fireEvent.click(screen.getByRole('button', { name: /connect to pckpr@box.local/i }));

    expect(screen.getByRole('status')).toHaveTextContent('Connecting to pckpr@box.local:22…');
    expect(screen.getByRole('button', { name: /connecting to pckpr@box.local/i })).toBeDisabled();

    rejectConnection(new Error('Authentication failed'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Couldn’t connect to pckpr@box.local:22: Authentication failed',
      );
    });
    expect(screen.queryByPlaceholderText(/host/i)).toBeNull();
  });

  it('renders and reconnects saved host-only profiles', async () => {
    const onConnected = vi.fn();
    renderSSHManager({
      onConnected,
      profiles: [{
        id: 'terminal.shop:22:password',
        host: 'terminal.shop',
        port: 22,
        username: undefined,
        auth: 'password',
      }],
    });

    fireEvent.click(screen.getByRole('button', { name: /connect to terminal\.shop/i }));

    await waitFor(() => {
      expect(sshConnect).toHaveBeenCalledWith(expect.objectContaining({
        host: 'terminal.shop',
        port: 22,
        auth: 'password',
      }));
      expect(sshConnect.mock.calls[0][0]).not.toHaveProperty('username');
      expect(onConnected).toHaveBeenCalledWith(expect.objectContaining({
        host: 'terminal.shop',
        port: 22,
        sshProfileId: 'terminal.shop:22:password',
      }));
      expect(onConnected.mock.calls[0][0]).not.toHaveProperty('username');
    });
  });

  it('opens saved profile details from the edit action', () => {
    renderSSHManager({
      profiles: [{
        id: 'pckpr@box.local:22:password',
        host: 'box.local',
        port: 22,
        username: 'pckpr',
        auth: 'password',
        password: 'secret',
      }],
    });

    fireEvent.click(screen.getByRole('button', { name: /edit pckpr@box.local:22/i }));

    expect(screen.getByPlaceholderText(/host/i)).toHaveValue('box.local');
    expect(screen.getByPlaceholderText(/port/i)).toHaveValue('22');
    expect(screen.getByPlaceholderText(/username/i)).toHaveValue('pckpr');
    expect(screen.getByPlaceholderText(/password/i)).toHaveValue('secret');
  });

  it('focuses and requires Host, exposes auth selection, and disables empty submission', () => {
    renderSSHManager();

    fireEvent.click(screen.getByRole('button', { name: /new connection/i }));

    const host = screen.getByRole('textbox', { name: 'Host' });
    const submit = screen.getByRole('button', { name: /connect & save/i });
    const passwordAuth = screen.getByRole('button', { name: 'Password' });
    const keyAuth = screen.getByRole('button', { name: 'Key' });

    expect(host).toHaveFocus();
    expect(host).toBeRequired();
    expect(screen.getByRole('textbox', { name: 'Port' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Username' })).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Authentication method' })).toBeInTheDocument();
    expect(submit).toBeDisabled();
    expect(passwordAuth).toHaveAttribute('aria-pressed', 'true');
    expect(keyAuth).toHaveAttribute('aria-pressed', 'false');

    fireEvent.change(host, { target: { value: 'box.local' } });
    expect(submit).toBeEnabled();
    fireEvent.click(keyAuth);
    expect(passwordAuth).toHaveAttribute('aria-pressed', 'false');
    expect(keyAuth).toHaveAttribute('aria-pressed', 'true');
  });

  it('announces new-connection failures as an alert', async () => {
    sshConnect.mockRejectedValueOnce(new Error('Host key mismatch'));
    renderSSHManager();

    fireEvent.click(screen.getByRole('button', { name: /new connection/i }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Host' }), { target: { value: 'box.local' } });
    fireEvent.click(screen.getByRole('button', { name: /connect & save/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Host key mismatch');
  });

  it('deletes saved profiles from the delete action', () => {
    const onProfilesChange = vi.fn();
    renderSSHManager({
      onProfilesChange,
      profiles: [{
        id: 'pckpr@box.local:22:password',
        host: 'box.local',
        port: 22,
        username: 'pckpr',
        auth: 'password',
      }],
    });

    fireEvent.click(screen.getByRole('button', { name: /delete pckpr@box.local:22/i }));

    expect(onProfilesChange).toHaveBeenCalledWith([]);
  });

  it('does not render an active SSH section', () => {
    renderSSHManager();
    expect(screen.queryByText('Active')).toBeNull();
  });
});
