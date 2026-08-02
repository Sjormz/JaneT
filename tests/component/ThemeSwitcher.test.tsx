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
      notificationsEnabled={false}
      notificationThresholdSeconds={10}
      onNotificationsEnabledChange={vi.fn()}
      onNotificationThresholdSecondsChange={vi.fn()}
      {...overrides}
    />,
  );
}

describe('ThemeSwitcher', () => {
  it('renders with current theme selected', () => {
    renderThemeSwitcher({ currentTheme: 'dracula' });

    expect(screen.getByRole('group', { name: 'Theme' })).toBeInTheDocument();
    expect(screen.getByText('Tokyo Night')).toBeInTheDocument();
    expect(screen.getByText('Dracula')).toBeInTheDocument();
    expect(screen.getByText('One Dark')).toBeInTheDocument();

    const draculaBtn = screen.getByRole('button', { name: 'Dracula' });
    expect(draculaBtn).toHaveAttribute('aria-pressed', 'true');

    const tokyoBtn = screen.getByRole('button', { name: 'Tokyo Night' });
    expect(tokyoBtn).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onThemeChange when a theme is clicked', () => {
    const onThemeChange = vi.fn();
    renderThemeSwitcher({ onThemeChange });

    fireEvent.click(screen.getByText('Dracula'));
    expect(onThemeChange).toHaveBeenCalledWith('dracula');
  });

  it('displays current font size', () => {
    renderThemeSwitcher({ fontSize: 16 });

    expect(screen.getByText('16px')).toBeInTheDocument();
    expect(screen.getByText(/Terminal and editor text size/)).toBeInTheDocument();
  });

  it('renders a font size slider with current value', () => {
    renderThemeSwitcher({ fontSize: 15 });

    const slider = screen.getByLabelText('Terminal and editor text size') as HTMLInputElement;
    expect(slider).toBeInTheDocument();
    expect(slider.type).toBe('range');
    expect(slider.value).toBe('15');
    expect(slider.min).toBe('10');
    expect(slider.max).toBe('24');
  });

  it('calls onFontSizeChange when the slider is moved', () => {
    const onFontSizeChange = vi.fn();
    renderThemeSwitcher({ onFontSizeChange });

    const slider = screen.getByLabelText('Terminal and editor text size') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '18' } });
    expect(onFontSizeChange).toHaveBeenCalledWith(18);
  });

  it('changes explorer side from settings', () => {
    const onSidebarSideChange = vi.fn();
    renderThemeSwitcher({ sidebarSide: 'left', onSidebarSideChange });

    expect(screen.getByRole('group', { name: 'Workspace tools position' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('Right'));
    expect(onSidebarSideChange).toHaveBeenCalledWith('right');
    expect(screen.getByRole('button', { name: 'Right' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('renders accessible bounded notification controls and invokes callbacks', () => {
    const onNotificationsEnabledChange = vi.fn();
    const onNotificationThresholdSecondsChange = vi.fn();
    renderThemeSwitcher({ onNotificationsEnabledChange, onNotificationThresholdSecondsChange });
    const enabled = screen.getByRole('checkbox', { name: 'Notify when long commands finish while JaneT is unfocused' });
    const threshold = screen.getByRole('spinbutton', { name: 'Notification threshold (seconds)' }) as HTMLInputElement;
    expect(enabled).not.toBeChecked();
    expect(threshold).toBeDisabled();
    expect(threshold).toHaveAttribute('min', '1');
    expect(threshold).toHaveAttribute('max', '86400');
    fireEvent.click(enabled);
    expect(onNotificationsEnabledChange).toHaveBeenCalledWith(true);
  });

  it('changes the notification threshold while notifications are enabled', () => {
    const onNotificationThresholdSecondsChange = vi.fn();
    renderThemeSwitcher({ notificationsEnabled: true, onNotificationThresholdSecondsChange });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Notification threshold (seconds)' }), { target: { value: '42' } });
    expect(onNotificationThresholdSecondsChange).toHaveBeenCalledWith(42);
  });
});
