import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import Titlebar from '../../src/renderer/components/Titlebar';

function mockPlatform(platform: string) {
  Object.defineProperty(window, 'janet', {
    configurable: true,
    value: {
      getPlatform: vi.fn().mockResolvedValue(platform),
      windowIsMaximized: vi.fn().mockResolvedValue(false),
      windowMinimize: vi.fn(),
      windowMaximize: vi.fn().mockResolvedValue(undefined),
      windowClose: vi.fn(),
    },
  });
}

const baseProps = {
  settingsOpen: false,
  onSettingsToggle: vi.fn(),
  onSettingsClose: vi.fn(),
  settingsContent: <div>Settings content</div>,
  onOpenPalette: vi.fn(),
  paletteShortcut: 'Ctrl+K',
};

function renderControlledTitlebar() {
  const onSettingsClose = vi.fn();

  function Harness() {
    const [settingsOpen, setSettingsOpen] = useState(false);
    return (
      <>
        <Titlebar
          {...baseProps}
          settingsOpen={settingsOpen}
          onSettingsToggle={() => setSettingsOpen((open) => !open)}
          onSettingsClose={() => {
            onSettingsClose();
            setSettingsOpen(false);
          }}
          settingsContent={<div>Theme and shortcuts</div>}
        />
        <button type="button">Outside target</button>
      </>
    );
  }

  render(<Harness />);
  return { onSettingsClose };
}

describe('Titlebar', () => {
  it('keeps palette and platform controls without the former sidebar navigation', async () => {
    mockPlatform('win32');
    render(<Titlebar {...baseProps} />);

    expect(screen.queryByRole('navigation', { name: /sidebar section/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /explorer/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ssh connections/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /source control/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open command palette \(ctrl\+k\)/i })).toBeInTheDocument();
    expect(screen.getByText('Search commands')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+K')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /minimize/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /maximize/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
    });
  });

  it('toggles Settings in the right cluster and renders its supplied content', () => {
    mockPlatform('win32');
    renderControlledTitlebar();

    const settingsButton = screen.getByRole('button', { name: 'Open settings' });
    expect(settingsButton.closest('.titlebar-right')).not.toBeNull();
    expect(settingsButton).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(settingsButton);

    expect(screen.getByRole('dialog', { name: 'Settings' })).toHaveTextContent('Theme and shortcuts');
    expect(screen.getByRole('button', { name: 'Hide settings' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('closes Settings with Escape and restores focus to its trigger', async () => {
    mockPlatform('win32');
    const { onSettingsClose } = renderControlledTitlebar();
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));

    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Settings' }), { key: 'Escape' });

    expect(onSettingsClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open settings' })).toHaveFocus());
  });

  it('closes Settings on an outside pointer press and restores trigger focus', async () => {
    mockPlatform('win32');
    const { onSettingsClose } = renderControlledTitlebar();
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside target' }));

    expect(onSettingsClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open settings' })).toHaveFocus());
  });

  it('uses native traffic lights on mac instead of drawing duplicate controls', async () => {
    mockPlatform('darwin');
    render(<Titlebar {...baseProps} />);

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /minimize/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /maximize/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /close/i })).toBeNull();
    });
  });

  it('uses the navigator platform on the first macOS frame', () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(navigator, 'platform');
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'MacIntel' });
    mockPlatform('darwin');
    (window.janet.getPlatform as any).mockReturnValue(new Promise(() => {}));
    try {
      const { container } = render(<Titlebar {...baseProps} />);
      expect(container.querySelector('.titlebar')).toHaveClass('is-mac');
      expect(screen.queryByRole('button', { name: /minimize window/i })).toBeNull();
    } finally {
      if (originalPlatform) Object.defineProperty(navigator, 'platform', originalPlatform);
      else delete (navigator as any).platform;
    }
  });
});
