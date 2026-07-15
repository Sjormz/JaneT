import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import Titlebar, { SidebarSection } from '../../src/renderer/components/Titlebar';

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
  section: 'files' as SidebarSection,
  onSectionChange: vi.fn(),
  sidebarOpen: true,
  onOpenPalette: vi.fn(),
  paletteShortcut: 'Ctrl+K',
};

describe('Titlebar', () => {
  it('does not render the open terminals tab strip', async () => {
    mockPlatform('win32');
    render(<Titlebar {...baseProps} />);

    expect(screen.queryByRole('tablist', { name: /open terminals/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /new terminal/i })).toBeNull();
    expect(screen.getByRole('button', { name: /open command palette \(ctrl\+k\)/i })).toBeInTheDocument();
    expect(screen.getByText('Search commands')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+K')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /minimize/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /maximize/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
    });
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

  it('describes active sidebar navigation as a hide action', () => {
    mockPlatform('win32');
    render(<Titlebar {...baseProps} />);

    expect(screen.getByRole('button', { name: 'Hide Explorer' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Open SSH connections' })).toHaveAttribute('aria-pressed', 'false');
  });
});
