import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertIcon,
  ArrowDownIcon,
  CheckIcon,
  RefreshIcon,
  SpinnerIcon,
  XCloseIcon,
} from '../icons';
import Tooltip from './Tooltip';

type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available'; version: string }
  | { status: 'downloading'; percent: number }
  | { status: 'downloaded'; version: string }
  | { status: 'not-available' }
  | { status: 'error'; message: string };

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

export default function UpdateBanner() {
  const [state, setState] = useState<UpdateState>({ status: 'idle' });

  useEffect(() => {
    const unsubs: (() => void)[] = [];

    unsubs.push(window.janet.onUpdateChecking(() => setState({ status: 'checking' })));
    unsubs.push(window.janet.onUpdateAvailable((info) => {
      setState({ status: 'available', version: info.version });
    }));
    unsubs.push(window.janet.onUpdateNotAvailable(() => {
      setState({ status: 'not-available' });
      const timer = setTimeout(() => setState({ status: 'idle' }), 3000);
      unsubs.push(() => clearTimeout(timer));
    }));
    unsubs.push(window.janet.onUpdateDownloadProgress((progress) => {
      setState({ status: 'downloading', percent: progress.percent });
    }));
    unsubs.push(window.janet.onUpdateDownloaded((info) => {
      setState({ status: 'downloaded', version: info.version });
    }));
    unsubs.push(window.janet.onUpdateError((error) => {
      setState({ status: 'error', message: error.message });
      const timer = setTimeout(() => setState({ status: 'idle' }), 10000);
      unsubs.push(() => clearTimeout(timer));
    }));

    return () => unsubs.forEach((unsubscribe) => unsubscribe());
  }, []);

  const handleDownload = useCallback(() => {
    void window.janet.downloadUpdate().catch((error) => {
      setState({ status: 'error', message: errorMessage(error, 'The download could not start.') });
    });
  }, []);

  const handleInstall = useCallback(() => {
    void window.janet.installUpdate().catch((error) => {
      setState({ status: 'error', message: errorMessage(error, 'JaneT could not restart to install the update.') });
    });
  }, []);

  const handleForceCheck = useCallback(() => {
    setState({ status: 'checking' });
    void window.janet.checkForUpdates().catch((error) => {
      setState({ status: 'error', message: errorMessage(error, 'JaneT could not check for updates.') });
    });
  }, []);

  if (state.status === 'idle') return null;

  const dismiss = (
    <Tooltip label="Dismiss update notification" placement="left">
      <button
        type="button"
        className="update-banner-dismiss"
        onClick={() => setState({ status: 'idle' })}
        aria-label="Dismiss update notification"
      >
        <XCloseIcon size="sm" />
      </button>
    </Tooltip>
  );

  switch (state.status) {
    case 'checking':
      return (
        <aside className="update-banner" role="status" aria-live="polite">
          <SpinnerIcon size="md" className="update-banner-spin" />
          <span className="update-banner-message">Checking for updates…</span>
        </aside>
      );

    case 'available':
      return (
        <aside className="update-banner" role="status" aria-live="polite">
          <ArrowDownIcon size="md" className="update-banner-icon" />
          <strong className="update-banner-message">JaneT v{state.version} is available</strong>
          <button type="button" className="update-banner-action primary" onClick={handleDownload}>
            Download update
          </button>
          {dismiss}
        </aside>
      );

    case 'downloading': {
      const percent = Math.max(0, Math.min(100, Math.round(state.percent)));
      return (
        <aside className="update-banner update-banner-progress-state" role="status" aria-live="polite">
          <ArrowDownIcon size="md" className="update-banner-icon" />
          <span className="update-banner-message">Downloading JaneT</span>
          <div
            className="update-banner-progress"
            role="progressbar"
            aria-label="Downloading JaneT update"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <span style={{ width: `${percent}%` }} />
          </div>
          <span className="update-banner-percent">{percent}%</span>
        </aside>
      );
    }

    case 'downloaded':
      return (
        <aside className="update-banner is-success" role="status" aria-live="polite">
          <CheckIcon size="md" className="update-banner-icon" />
          <strong className="update-banner-message">JaneT v{state.version} is ready to install</strong>
          <button type="button" className="update-banner-action primary" onClick={handleInstall}>
            Restart to install
          </button>
          {dismiss}
        </aside>
      );

    case 'not-available':
      return (
        <aside className="update-banner is-success" role="status" aria-live="polite">
          <CheckIcon size="md" className="update-banner-icon" />
          <span className="update-banner-message">JaneT is up to date</span>
        </aside>
      );

    case 'error':
      return (
        <aside className="update-banner is-error" role="alert">
          <AlertIcon size="md" className="update-banner-icon" />
          <span className="update-banner-message">Update failed: {state.message}</span>
          <button type="button" className="update-banner-action" onClick={handleForceCheck}>
            <RefreshIcon size="xs" /> Retry
          </button>
          {dismiss}
        </aside>
      );

    default:
      return null;
  }
}
