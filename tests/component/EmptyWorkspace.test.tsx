import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import EmptyWorkspace from '../../src/renderer/components/EmptyWorkspace';

it('suggests a project based on the chosen destination', () => {
  const onRequest = vi.fn();
  render(<EmptyWorkspace mainDirectory="C:/Work" groups={[{ id: 'mark', name: 'mark' }, { id: 'repo', name: 'JaneT', kind: 'folder' }]} onRequest={onRequest} />);
  fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
  expect(onRequest).toHaveBeenLastCalledWith({ action: 'create', groupId: 'mark' });
  fireEvent.change(screen.getByLabelText('Where do you want to work?'), { target: { value: 'repo' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
  expect(onRequest).toHaveBeenLastCalledWith({ action: 'create', groupId: 'repo' });
  const locationActions = within(screen.getByRole('group', { name: 'Selected location' }));
  expect(locationActions.getAllByRole('button')).toHaveLength(1);
  expect(locationActions.getByRole('button', { name: 'Create project' })).toBeInTheDocument();
  const addLocation = within(screen.getByRole('group', { name: 'Add a location' }));
  fireEvent.click(addLocation.getByRole('button', { name: 'Link another folder' }));
  expect(onRequest).toHaveBeenLastCalledWith({ action: 'link' });
  fireEvent.click(addLocation.getByRole('button', { name: 'Add another workspace' }));
  expect(onRequest).toHaveBeenLastCalledWith({ action: 'create' });
  expect(screen.queryByRole('button', { name: /SSH/ })).not.toBeInTheDocument();
});

it('offers a workspace on a fresh profile, not a project without a parent', () => {
  const onRequest = vi.fn();
  render(<EmptyWorkspace mainDirectory="C:/Work" groups={[]} onRequest={onRequest} />);
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
  expect(onRequest).toHaveBeenCalledWith({ action: 'create', groupId: undefined });
  fireEvent.click(screen.getByRole('button', { name: 'Link folder to Library' }));
  expect(onRequest).toHaveBeenLastCalledWith({ action: 'link' });
});
