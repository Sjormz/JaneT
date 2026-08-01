import React, { useCallback, useEffect, useRef, useState } from 'react';
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

function updateFailureMessage(result: unknown, fallback: string): string | null {
  if (!result || typeof result !== 'object') return null;
  const { success, error, cancelled } = result as Record<string, unknown>;
  if (success !== false || cancelled === true) return null;
  return typeof error === 'string' && error.trim() ? error : fallback;
}

export default function UpdateBanner() {
  const [state, setState] = useState<UpdateState>({ status: 'idle' });
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestEpochRef = useRef(0);
  const setUpdateState = useCallback((next: UpdateState) => {
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = null;
    setState(next);
  }, []);

  useEffect(() => {
    const unsubs: (() => void)[] = [];

    unsubs.push(window.janet.onUpdateChecking(() => setUpdateState({ status: 'checking' })));
    unsubs.push(window.janet.onUpdateAvailable((info) => {
      requestEpochRef.current += 1;
      setUpdateState({ status: 'available', version: info.version });
    }));
    unsubs.push(window.janet.onUpdateNotAvailable(() => {
      requestEpochRef.current += 1;
      setUpdateState({ status: 'not-available' });
      dismissTimerRef.current = setTimeout(() => {
        dismissTimerRef.current = null;
        setState({ status: 'idle' });
      }, 3000);
    }));
    unsubs.push(window.janet.onUpdateDownloadProgress((progress) => {
      setUpdateState({ status: 'downloading', percent: progress.percent });
    }));
    unsubs.push(window.janet.onUpdateDownloaded((info) => {
      requestEpochRef.current += 1;
      setUpdateState({ status: 'downloaded', version: info.version });
    }));
    unsubs.push(window.janet.onUpdateError((error) => {
      requestEpochRef.current += 1;
      setUpdateState({ status: 'error', message: error.message });
      dismissTimerRef.current = setTimeout(() => {
        dismissTimerRef.current = null;
        setState({ status: 'idle' });
      }, 10000);
    }));

    return () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
      unsubs.forEach((unsubscribe) => unsubscribe());
    };
  }, [setUpdateState]);

  const handleDownload = useCallback(() => {
    const requestEpoch = requestEpochRef.current;
    const fallback = 'The download could not start.';
    void window.janet.downloadUpdate()
      .then((result) => {
        const message = updateFailureMessage(result, fallback);
        if (message && requestEpochRef.current === requestEpoch) {
          setUpdateState({ status: 'error', message });
        }
      })
      .catch((error) => {
        if (requestEpochRef.current === requestEpoch) {
          setUpdateState({ status: 'error', message: errorMessage(error, fallback) });
        }
      });
  }, [setUpdateState]);

  const handleInstall = useCallback(() => {
    const requestEpoch = requestEpochRef.current;
    const fallback = 'JaneT could not restart to install the update.';
    void window.janet.installUpdate()
      .then((result) => {
        const message = updateFailureMessage(result, fallback);
        if (message && requestEpochRef.current === requestEpoch) {
          setUpdateState({ status: 'error', message });
        }
      })
      .catch((error) => {
        if (requestEpochRef.current === requestEpoch) {
          setUpdateState({ status: 'error', message: errorMessage(error, fallback) });
        }
      });
  }, [setUpdateState]);

  const handleForceCheck = useCallback(() => {
    const requestEpoch = requestEpochRef.current + 1;
    requestEpochRef.current = requestEpoch;
    setUpdateState({ status: 'checking' });
    const fallback = 'JaneT could not check for updates.';
    void window.janet.checkForUpdates()
      .then((result) => {
        const message = updateFailureMessage(result, fallback);
        if (message && requestEpochRef.current === requestEpoch) {
          setUpdateState({ status: 'error', message });
        }
      })
      .catch((error) => {
        if (requestEpochRef.current === requestEpoch) {
          setUpdateState({ status: 'error', message: errorMessage(error, fallback) });
        }
      });
  }, [setUpdateState]);

  if (state.status === 'idle') return null;

  const dismiss = (
    <Tooltip label="Dismiss update notification" placement="left">
      <button
        type="button"
        className="update-banner-dismiss"
        onClick={() => {
          requestEpochRef.current += 1;
          setUpdateState({ status: 'idle' });
        }}
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
