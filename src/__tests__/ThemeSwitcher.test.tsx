import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ThemeSwitcher from '../renderer/components/ThemeSwitcher';

describe('ThemeSwitcher', () => {
  it('renders with current theme selected', () => {
    render(
      <ThemeSwitcher
        currentTheme="dracula"
        onThemeChange={vi.fn()}
        fontSize={14}
        onFontSizeChange={vi.fn()}
      />,
    );

    // Should have a Settings header
    expect(screen.getByText('Settings')).toBeInTheDocument();

    // Should have theme buttons
    expect(screen.getByText('Tokyo Night')).toBeInTheDocument();
    expect(screen.getByText('Dracula')).toBeInTheDocument();
    expect(screen.getByText('One Dark')).toBeInTheDocument();

    // Dracula should be active
    const draculaBtn = screen.getByText('Dracula');
    expect(draculaBtn.classList.contains('active')).toBe(true);

    const tokyoBtn = screen.getByText('Tokyo Night');
    expect(tokyoBtn.classList.contains('active')).toBe(false);
  });

  it('calls onThemeChange when a theme is clicked', () => {
    const onThemeChange = vi.fn();
    render(
      <ThemeSwitcher
        currentTheme="tokyo-night"
        onThemeChange={onThemeChange}
        fontSize={14}
        onFontSizeChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('Dracula'));
    expect(onThemeChange).toHaveBeenCalledWith('dracula');
  });

  it('displays current font size', () => {
    render(
      <ThemeSwitcher
        currentTheme="tokyo-night"
        onThemeChange={vi.fn()}
        fontSize={16}
        onFontSizeChange={vi.fn()}
      />,
    );

    expect(screen.getByText('Font Size: 16px')).toBeInTheDocument();
  });

  it('calls onFontSizeChange when +/- buttons are clicked', () => {
    const onFontSizeChange = vi.fn();
    render(
      <ThemeSwitcher
        currentTheme="tokyo-night"
        onThemeChange={vi.fn()}
        fontSize={14}
        onFontSizeChange={onFontSizeChange}
      />,
    );

    const buttons = screen.getAllByRole('button');
    // Find the decrease button (the one with text '−')
    const decreaseBtn = buttons.find((b) => b.textContent === '−');
    const increaseBtn = buttons.find((b) => b.textContent === '+');

    expect(decreaseBtn).toBeTruthy();
    expect(increaseBtn).toBeTruthy();

    fireEvent.click(decreaseBtn!);
    expect(onFontSizeChange).toHaveBeenCalledWith(13);

    fireEvent.click(increaseBtn!);
    expect(onFontSizeChange).toHaveBeenCalledWith(15);
  });

  it('disables decrease button at min font size (10)', () => {
    render(
      <ThemeSwitcher
        currentTheme="tokyo-night"
        onThemeChange={vi.fn()}
        fontSize={10}
        onFontSizeChange={vi.fn()}
      />,
    );

    const buttons = screen.getAllByRole('button');
    const decreaseBtn = buttons.find((b) => b.textContent === '−');
    expect(decreaseBtn).toBeDisabled();
  });

  it('disables increase button at max font size (24)', () => {
    render(
      <ThemeSwitcher
        currentTheme="tokyo-night"
        onThemeChange={vi.fn()}
        fontSize={24}
        onFontSizeChange={vi.fn()}
      />,
    );

    const buttons = screen.getAllByRole('button');
    const increaseBtn = buttons.find((b) => b.textContent === '+');
    expect(increaseBtn).toBeDisabled();
  });
});
