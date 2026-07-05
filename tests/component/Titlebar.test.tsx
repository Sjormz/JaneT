import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import Titlebar, { SidebarSection } from '../../src/renderer/components/Titlebar';

const baseProps = {
  section: 'files' as SidebarSection,
  onSectionChange: vi.fn(),
  sidebarOpen: true,
  onOpenPalette: vi.fn(),
};

describe('Titlebar', () => {
  it('does not render the open terminals tab strip', () => {
    render(<Titlebar {...baseProps} />);

    expect(screen.queryByRole('tablist', { name: /open terminals/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /new terminal/i })).toBeNull();
    expect(screen.getByRole('button', { name: /search/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /minimize/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /maximize/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
  });
});
