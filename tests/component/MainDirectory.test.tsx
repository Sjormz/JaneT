import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import MainDirectory from '../../src/renderer/components/MainDirectory';

it('asks for a directory and keeps onboarding open when persistence fails', async () => {
  window.janet = { selectLocalDirectory: vi.fn().mockResolvedValue('C:/JaneT'), workspaceDirectory: vi.fn().mockResolvedValue('C:/JaneT') } as unknown as typeof window.janet;
  const save = vi.fn().mockRejectedValueOnce(new Error('Disk unavailable')).mockResolvedValue(undefined);
  render(<MainDirectory directory={null} onboarding onChange={save} />);
  fireEvent.click(screen.getByRole('button', { name: 'Choose main directory' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Disk unavailable');
  fireEvent.click(screen.getByRole('button', { name: 'Choose main directory' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save).toHaveBeenLastCalledWith('C:/JaneT');
});
