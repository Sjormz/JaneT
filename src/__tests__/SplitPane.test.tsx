import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../renderer/App';

const mountedTermIds: string[] = [];

vi.mock('../renderer/components/Titlebar', () => ({
  default: () => <div data-testid="titlebar" />,
}));
vi.mock('../renderer/components/VerticalTabBar', () => ({
  default: () => <div data-testid="vertical-tab-bar" />,
}));
vi.mock('../renderer/components/Sidebar', () => ({
  default: () => <div data-testid="sidebar" />,
}));
vi.mock('../renderer/components/StatusBar', () => ({
  default: () => <div data-testid="statusbar" />,
}));
vi.mock('../renderer/components/CommandPalette', () => ({
  default: () => null,
}));
vi.mock('../renderer/components/ShortcutEditor', () => ({
  default: () => null,
}));
vi.mock('../renderer/components/ShellIntegrationHint', () => ({
  default: () => null,
}));
vi.mock('../renderer/components/UpdateBanner', () => ({
  default: () => null,
}));
vi.mock('../renderer/components/TerminalPane', async () => {
  const React = await import('react');

  function MockTerminalPane({
    termId,
    hasSession,
    onReady,
    onRemoved,
  }: {
    termId: string;
    hasSession?: boolean;
    onReady?: (id: string) => void;
    onRemoved?: (id: string) => void;
  }) {
    React.useEffect(() => {
      mountedTermIds.push(termId);
      if (!hasSession) {
        window.janet.terminalCreate({ id: termId });
      }
      onReady?.(termId);
      return () => {
        onRemoved?.(termId);
      };
    }, []);

    return <div data-testid={`terminal-${termId}`}>{termId}</div>;
  }

  return { default: MockTerminalPane };
});

beforeEach(() => {
  mountedTermIds.length = 0;
  (window as any).janet = {
    fsGetHome: vi.fn().mockResolvedValue('/home/test'),
    getSettings: vi.fn().mockResolvedValue({ keybindings: {} }),
    setSettings: vi.fn().mockResolvedValue(undefined),
    terminalCreate: vi.fn().mockResolvedValue(undefined),
    terminalDestroy: vi.fn().mockResolvedValue(undefined),
    terminalWrite: vi.fn(),
    terminalResize: vi.fn(),
    onTerminalData: vi.fn(() => ({ dispose: vi.fn() })),
    sshCreateShell: vi.fn().mockResolvedValue(undefined),
    sshWriteShell: vi.fn(),
    sshResizeShell: vi.fn(),
    checkForUpdates: vi.fn().mockResolvedValue(undefined),
  };
});

describe('split panes in the app', () => {
  it('keeps existing terminals alive when splitting deeper panes', async () => {
    render(<App />);

    const splitButton = await screen.findByRole('button', { name: /split right/i });
    expect(mountedTermIds).toHaveLength(1);
    expect(window.janet.terminalCreate).toHaveBeenCalledTimes(1);

    fireEvent.click(splitButton);

    await waitFor(() => {
      expect(screen.getAllByTestId(/terminal-/)).toHaveLength(2);
      expect(mountedTermIds).toHaveLength(2);
      expect(window.janet.terminalCreate).toHaveBeenCalledTimes(2);
      expect(window.janet.terminalDestroy).not.toHaveBeenCalled();
    });

    const splitButtons = screen.getAllByRole('button', { name: /split right/i });
    fireEvent.click(splitButtons[1]);

    await waitFor(() => {
      expect(screen.getAllByTestId(/terminal-/)).toHaveLength(3);
      expect(mountedTermIds).toHaveLength(3);
      expect(window.janet.terminalCreate).toHaveBeenCalledTimes(3);
      expect(window.janet.terminalDestroy).not.toHaveBeenCalled();
    });

    expect(new Set(mountedTermIds).size).toBe(3);
  });
});
