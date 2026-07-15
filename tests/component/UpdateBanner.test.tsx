import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import UpdateBanner from '../../src/renderer/components/UpdateBanner';

type UpdateHandlers = {
  checking?: () => void;
  available?: (info: { version: string }) => void;
  progress?: (progress: { percent: number }) => void;
  downloaded?: (info: { version: string }) => void;
  notAvailable?: () => void;
  error?: (error: { message: string }) => void;
};

const handlers: UpdateHandlers = {};
const downloadUpdate = vi.fn();
const installUpdate = vi.fn();
const checkForUpdates = vi.fn();

beforeEach(() => {
  Object.keys(handlers).forEach((key) => delete handlers[key as keyof UpdateHandlers]);
  downloadUpdate.mockReset().mockResolvedValue(undefined);
  installUpdate.mockReset().mockResolvedValue(undefined);
  checkForUpdates.mockReset().mockResolvedValue(undefined);
  (window as any).janet = {
    onUpdateChecking: vi.fn((handler) => { handlers.checking = handler; return vi.fn(); }),
    onUpdateAvailable: vi.fn((handler) => { handlers.available = handler; return vi.fn(); }),
    onUpdateDownloadProgress: vi.fn((handler) => { handlers.progress = handler; return vi.fn(); }),
    onUpdateDownloaded: vi.fn((handler) => { handlers.downloaded = handler; return vi.fn(); }),
    onUpdateNotAvailable: vi.fn((handler) => { handlers.notAvailable = handler; return vi.fn(); }),
    onUpdateError: vi.fn((handler) => { handlers.error = handler; return vi.fn(); }),
    downloadUpdate,
    installUpdate,
    checkForUpdates,
  };
});

describe('UpdateBanner', () => {
  it('uses direct update language and starts the download', () => {
    render(<UpdateBanner />);

    act(() => handlers.available?.({ version: '0.3.0' }));
    expect(screen.getByRole('status')).toHaveTextContent('JaneT v0.3.0 is available');
    fireEvent.click(screen.getByRole('button', { name: 'Download update' }));
    expect(downloadUpdate).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Dismiss update notification' })).toBeInTheDocument();
  });

  it('exposes labeled download progress and install readiness', () => {
    render(<UpdateBanner />);

    act(() => handlers.progress?.({ percent: 42.4 }));
    expect(screen.getByRole('progressbar', { name: 'Downloading JaneT update' }))
      .toHaveAttribute('aria-valuenow', '42');
    expect(screen.getByText('42%')).toBeInTheDocument();

    act(() => handlers.downloaded?.({ version: '0.3.0' }));
    expect(screen.getByRole('status')).toHaveTextContent('JaneT v0.3.0 is ready to install');
    fireEvent.click(screen.getByRole('button', { name: 'Restart to install' }));
    expect(installUpdate).toHaveBeenCalledOnce();
  });

  it('keeps updater errors visible and offers a retry', () => {
    render(<UpdateBanner />);

    act(() => handlers.error?.({ message: 'Signature verification failed' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Update failed: Signature verification failed',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(checkForUpdates).toHaveBeenCalledOnce();
    expect(screen.getByRole('status')).toHaveTextContent('Checking for updates…');
  });
});
