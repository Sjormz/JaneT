import { describe, it, expect, vi } from 'vitest';
import type React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ThemeSwitcher from '../../src/renderer/components/ThemeSwitcher';

function renderThemeSwitcher(overrides?: Partial<React.ComponentProps<typeof ThemeSwitcher>>) {
  return render(
    <ThemeSwitcher
      currentTheme="tokyo-night"
      onThemeChange={vi.fn()}
      fontSize={14}
      onFontSizeChange={vi.fn()}
      sidebarSide="left"
      onSidebarSideChange={vi.fn()}
      {...overrides}
    />,
  );
}

describe('ThemeSwitcher', () => {
  it('renders with current theme selected', () => {
    renderThemeSwitcher({ currentTheme: 'dracula' });

    expect(screen.getByText(/Theme/)).toBeInTheDocument();
    expect(screen.getByText('Tokyo Night')).toBeInTheDocument();
    expect(screen.getByText('Dracula')).toBeInTheDocument();
    expect(screen.getByText('One Dark')).toBeInTheDocument();

    const draculaBtn = screen.getByText('Dracula');
    expect(draculaBtn.classList.contains('active')).toBe(true);

    const tokyoBtn = screen.getByText('Tokyo Night');
    expect(tokyoBtn.classList.contains('active')).toBe(false);
  });

  it('calls onThemeChange when a theme is clicked', () => {
    const onThemeChange = vi.fn();
    renderThemeSwitcher({ onThemeChange });

    fireEvent.click(screen.getByText('Dracula'));
    expect(onThemeChange).toHaveBeenCalledWith('dracula');
  });

  it('displays current font size', () => {
    renderThemeSwitcher({ fontSize: 16 });

    expect(screen.getByText('Font Size: 16px')).toBeInTheDocument();
  });

  it('renders a font size slider with current value', () => {
    renderThemeSwitcher({ fontSize: 15 });

    const slider = screen.getByLabelText('Font size') as HTMLInputElement;
    expect(slider).toBeInTheDocument();
    expect(slider.type).toBe('range');
    expect(slider.value).toBe('15');
    expect(slider.min).toBe('10');
    expect(slider.max).toBe('24');
  });

  it('calls onFontSizeChange when the slider is moved', () => {
    const onFontSizeChange = vi.fn();
    renderThemeSwitcher({ onFontSizeChange });

    const slider = screen.getByLabelText('Font size') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '18' } });
    expect(onFontSizeChange).toHaveBeenCalledWith(18);
  });

  it('changes explorer side from settings', () => {
    const onSidebarSideChange = vi.fn();
    renderThemeSwitcher({ sidebarSide: 'left', onSidebarSideChange });

    fireEvent.click(screen.getByText('Right'));
    expect(onSidebarSideChange).toHaveBeenCalledWith('right');
  });
});
