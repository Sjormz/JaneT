import React, { useEffect, useRef, useState } from 'react';
import { AlertIcon, CheckIcon, CopyIcon } from '../icons';
import { formatTerminalPathForPaste } from '../terminalPathDrag';

type CopyState = 'idle' | 'copied' | 'error';

interface TerminalPathCopyButtonProps {
  path: string;
  label: string;
  onCopyPath?: (path: string) => Promise<void>;
}

const COPY_FEEDBACK_MS = 1_500;

export default function TerminalPathCopyButton({
  path,
  label,
  onCopyPath,
}: TerminalPathCopyButtonProps) {
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyRequestRef = useRef(0);
  const pathIsSafe = formatTerminalPathForPaste(path) !== null;
  const unavailable = !onCopyPath || !pathIsSafe;

  useEffect(() => () => {
    copyRequestRef.current += 1;
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
  }, []);

  const resetLater = () => {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => {
      resetTimerRef.current = null;
      setCopyState('idle');
    }, COPY_FEEDBACK_MS);
  };

  const handleCopy = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const request = ++copyRequestRef.current;
    if (!pathIsSafe || !onCopyPath) {
      setCopyState('error');
      resetLater();
      return;
    }
    try {
      await onCopyPath(path);
      if (request !== copyRequestRef.current) return;
      setCopyState('copied');
    } catch {
      if (request !== copyRequestRef.current) return;
      setCopyState('error');
    }
    resetLater();
  };

  const feedback = copyState === 'copied'
    ? `Copied path for ${label}`
    : copyState === 'error'
      ? !pathIsSafe
        ? `Path for ${label} cannot be pasted safely`
        : !onCopyPath
          ? `Copy path is unavailable for ${label}`
          : `Couldn't copy path for ${label}`
      : '';
  const title = !pathIsSafe
    ? 'Path cannot be pasted safely'
    : copyState === 'copied'
      ? 'Path copied for terminal'
      : copyState === 'error'
        ? "Couldn't copy path"
        : 'Copy path for terminal';

  return (
    <>
      <button
        type="button"
        className="terminal-path-copy-button"
        data-state={copyState}
        aria-label={`Copy path for ${label}`}
        aria-disabled={unavailable}
        title={title}
        draggable={false}
        onMouseDown={(event) => event.stopPropagation()}
        onDragStart={(event) => event.preventDefault()}
        onClick={handleCopy}
      >
        {copyState === 'copied' ? (
          <CheckIcon size="xs" />
        ) : copyState === 'error' ? (
          <AlertIcon size="xs" />
        ) : (
          <CopyIcon size="xs" />
        )}
      </button>
      <span className="sr-only" role="status" aria-live="polite">{feedback}</span>
    </>
  );
}
