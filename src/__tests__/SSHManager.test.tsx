import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SSHManager from '../renderer/components/SSHManager';
import { SavedSSHProfile, SessionInfo } from '../renderer/types';

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
    fireEvent.click(screen.getByRole('button', { name: /^connect$/i }));

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
    fireEvent.click(screen.getByRole('button', { name: /^connect$/i }));

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

  it('opens saved profile details from the actions dropdown for editing', () => {
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

    fireEvent.change(screen.getByRole('combobox', { name: /actions for pckpr@box.local/i }), {
      target: { value: 'edit' },
    });

    expect(screen.getByPlaceholderText(/host/i)).toHaveValue('box.local');
    expect(screen.getByPlaceholderText(/port/i)).toHaveValue('22');
    expect(screen.getByPlaceholderText(/username/i)).toHaveValue('pckpr');
    expect(screen.getByPlaceholderText(/password/i)).toHaveValue('secret');
  });

  it('deletes saved profiles from the actions dropdown', () => {
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

    fireEvent.change(screen.getByRole('combobox', { name: /actions for pckpr@box.local/i }), {
      target: { value: 'delete' },
    });

    expect(onProfilesChange).toHaveBeenCalledWith([]);
  });

  it('does not render an active SSH section', () => {
    renderSSHManager();
    expect(screen.queryByText('Active')).toBeNull();
  });
});
