import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  it('shows a download failure returned by the main process', async () => {
    downloadUpdate.mockResolvedValue({ success: false, error: 'Download service unavailable' });
    render(<UpdateBanner />);

    act(() => handlers.available?.({ version: '0.3.0' }));
    fireEvent.click(screen.getByRole('button', { name: 'Download update' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(
      'Update failed: Download service unavailable',
    ));
  });

  it('ignores a stale download failure after a newer update becomes available', async () => {
    let resolveDownload!: (result: { success: false; error: string }) => void;
    downloadUpdate.mockReturnValue(new Promise((resolve) => { resolveDownload = resolve; }));
    render(<UpdateBanner />);

    act(() => handlers.available?.({ version: '0.3.0' }));
    fireEvent.click(screen.getByRole('button', { name: 'Download update' }));
    act(() => handlers.available?.({ version: '0.4.0' }));
    await act(async () => resolveDownload({ success: false, error: 'Old download failed' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('JaneT v0.4.0 is available');
  });

  it('ignores a stale check failure after a newer update becomes available', async () => {
    let resolveCheck!: (result: { success: false; error: string }) => void;
    checkForUpdates.mockReturnValue(new Promise((resolve) => { resolveCheck = resolve; }));
    render(<UpdateBanner />);

    act(() => handlers.error?.({ message: 'Earlier failure' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    act(() => handlers.available?.({ version: '0.4.0' }));
    await act(async () => resolveCheck({ success: false, error: 'Old check failed' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('JaneT v0.4.0 is available');
  });

  it('ignores a stale install failure after a newer update becomes available', async () => {
    let resolveInstall!: (result: { success: false; error: string }) => void;
    installUpdate.mockReturnValue(new Promise((resolve) => { resolveInstall = resolve; }));
    render(<UpdateBanner />);

    act(() => handlers.downloaded?.({ version: '0.3.0' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restart to install' }));
    act(() => handlers.available?.({ version: '0.4.0' }));
    await act(async () => resolveInstall({ success: false, error: 'Old install failed' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('JaneT v0.4.0 is available');
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

  it('does not let an old auto-dismiss timer hide a newer update', () => {
    vi.useFakeTimers();
    try {
      render(<UpdateBanner />);

      act(() => handlers.notAvailable?.());
      act(() => vi.advanceTimersByTime(2_000));
      act(() => handlers.available?.({ version: '0.4.0' }));
      act(() => vi.advanceTimersByTime(1_000));

      expect(screen.getByRole('status')).toHaveTextContent('JaneT v0.4.0 is available');
    } finally {
      vi.useRealTimers();
    }
  });
});
