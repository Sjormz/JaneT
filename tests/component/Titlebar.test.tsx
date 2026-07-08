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
};

describe('Titlebar', () => {
  it('does not render the open terminals tab strip', async () => {
    mockPlatform('win32');
    render(<Titlebar {...baseProps} />);

    expect(screen.queryByRole('tablist', { name: /open terminals/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /new terminal/i })).toBeNull();
    expect(screen.getByRole('button', { name: /search/i })).toBeInTheDocument();
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
});
