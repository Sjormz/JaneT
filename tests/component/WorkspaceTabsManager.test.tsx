import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import WorkspaceTabsManager from '../../src/renderer/components/WorkspaceTabsManager';
import { SavedSSHProfile, WorkspaceTabPreset } from '../../src/renderer/types';

const sshProfiles: SavedSSHProfile[] = [{
  id: 'pckpr@box.local:22:password',
  host: 'box.local',
  port: 22,
  username: 'pckpr',
  auth: 'password',
  password: 'secret',
}];

function renderManager(props?: {
  presets?: WorkspaceTabPreset[];
  onChange?: (presets: WorkspaceTabPreset[]) => void;
  onLaunch?: (preset: WorkspaceTabPreset) => void;
}) {
  return render(
    <WorkspaceTabsManager
      presets={props?.presets ?? []}
      sshProfiles={sshProfiles}
      onChange={props?.onChange ?? vi.fn()}
      onLaunch={props?.onLaunch ?? vi.fn()}
    />,
  );
}

describe('WorkspaceTabsManager', () => {
  it('creates a local workspace tab preset', () => {
    const onChange = vi.fn();
    renderManager({ onChange });

    fireEvent.click(screen.getByRole('button', { name: /new workspace tab/i }));
    fireEvent.change(screen.getByPlaceholderText(/tab name/i), { target: { value: 'JaneT' } });
    fireEvent.change(screen.getByPlaceholderText(/directory path/i), {
      target: { value: 'C:/Users/pckpr/projects/JaneT' },
    });
    fireEvent.change(screen.getByLabelText(/terminal count/i), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: /add workspace tab/i }));

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({
        name: 'JaneT',
        type: 'local',
        cwd: 'C:/Users/pckpr/projects/JaneT',
        terminalCount: 3,
        splitDirection: 'vertical',
      }),
    ]);
  });

  it('creates an SSH workspace tab preset from a saved SSH profile', () => {
    const onChange = vi.fn();
    renderManager({ onChange });

    fireEvent.click(screen.getByRole('button', { name: /new workspace tab/i }));
    fireEvent.change(screen.getByPlaceholderText(/tab name/i), { target: { value: 'Remote box' } });
    fireEvent.change(screen.getByLabelText(/workspace tab type/i), { target: { value: 'ssh' } });
    fireEvent.change(screen.getByLabelText(/ssh profile/i), {
      target: { value: 'pckpr@box.local:22:password' },
    });
    fireEvent.change(screen.getByLabelText(/split direction/i), { target: { value: 'horizontal' } });
    fireEvent.click(screen.getByRole('button', { name: /add workspace tab/i }));

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({
        name: 'Remote box',
        type: 'ssh',
        sshProfileId: 'pckpr@box.local:22:password',
        splitDirection: 'horizontal',
      }),
    ]);
  });

  it('launches an existing preset and keeps edit/delete in the actions dropdown', () => {
    const preset: WorkspaceTabPreset = {
      id: 'workspace-tab-1',
      name: 'JaneT',
      type: 'local',
      cwd: 'C:/Users/pckpr/projects/JaneT',
      terminalCount: 2,
      splitDirection: 'vertical',
    };
    const onLaunch = vi.fn();
    const onChange = vi.fn();
    renderManager({ presets: [preset], onLaunch, onChange });

    fireEvent.click(screen.getByRole('button', { name: /open janet/i }));
    expect(onLaunch).toHaveBeenCalledWith(preset);

    fireEvent.change(screen.getByRole('combobox', { name: /actions for janet/i }), {
      target: { value: 'delete' },
    });
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
