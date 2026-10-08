import { afterEach, describe, it, expect, vi } from 'vitest';
import type React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ThemeSwitcher from '../../src/renderer/components/ThemeSwitcher';

const originalJanet = window.janet;

afterEach(() => {
  window.janet = originalJanet;
});

function renderThemeSwitcher(overrides?: Partial<React.ComponentProps<typeof ThemeSwitcher>>) {
  return render(
    <ThemeSwitcher
      currentTheme="tokyo-night"
      onThemeChange={vi.fn()}
      fontSize={14}
      onFontSizeChange={vi.fn()}
      sidebarSide="left"
      onSidebarSideChange={vi.fn()}
      transparency="system"
      systemReducesTransparency={false}
      onTransparencyChange={vi.fn()}
      notificationsEnabled={false}
      onNotificationsEnabledChange={vi.fn()}
      {...overrides}
    />,
  );
}

describe('ThemeSwitcher', () => {
  it('turns agent activity off and reports what was removed', async () => {
    let finish: (message: string) => void = () => {};
    const onAgentIntegrationsChange = vi.fn(() => new Promise<string>((resolve) => { finish = resolve; }));
    renderThemeSwitcher({ agentIntegrations: true, onAgentIntegrationsChange });
    const toggle = screen.getByRole('checkbox', { name: 'Show agent activity' });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(onAgentIntegrationsChange).toHaveBeenCalledWith(false);
    expect(toggle).toBeDisabled();
    expect(screen.getByText(/Removing JaneT entries/)).toHaveAttribute('role', 'status');
    finish('Agent activity is off for new terminals. Codex: nothing to remove.');
    await waitFor(() => expect(toggle).not.toBeDisabled());
    expect(screen.getByText(/Codex: nothing to remove/)).toBeInTheDocument();
  });

  it('hides the agent section when the app does not provide it', () => {
    renderThemeSwitcher();
    expect(screen.queryByRole('checkbox', { name: 'Show agent activity' })).not.toBeInTheDocument();
  });

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

    expect(screen.getByRole('group', { name: 'Project tools position' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('Right'));
    expect(onSidebarSideChange).toHaveBeenCalledWith('right');
    expect(screen.getByRole('button', { name: 'Right' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('renders accessible bounded notification controls and invokes callbacks', () => {
    const onNotificationsEnabledChange = vi.fn();

    renderThemeSwitcher({ onNotificationsEnabledChange });
    const enabled = screen.getByRole('checkbox', { name: 'Notify when long commands finish' });
    expect(enabled).not.toBeChecked();
    fireEvent.click(enabled);
    expect(onNotificationsEnabledChange).toHaveBeenCalledWith(true);
  });

  it('shows the fixed notification threshold without an adjustment field', () => {
    renderThemeSwitcher({ notificationsEnabled: true });
    expect(screen.queryByRole('spinbutton')).toBeNull();
    expect(screen.getByText('JaneT must be unfocused. Commands must run at least 10 seconds.')).toBeInTheDocument();
  });

  it('copies diagnostics without renderer data and politely confirms success', async () => {
    const copyDiagnostics = vi.fn().mockResolvedValue(true);
    window.janet = { ...originalJanet, copyDiagnostics };
    renderThemeSwitcher();

    const button = screen.getByRole('button', { name: 'Copy diagnostics' });
    expect(button).toHaveAttribute('type', 'button');
    fireEvent.click(button);

    await waitFor(() => expect(copyDiagnostics).toHaveBeenCalledWith());
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveAttribute('aria-atomic', 'true');
    expect(status).toHaveTextContent('Diagnostics copied');
  });

  it('politely reports a failed diagnostics copy', async () => {
    window.janet = { ...originalJanet, copyDiagnostics: vi.fn().mockResolvedValue(false) };
    renderThemeSwitcher();

    fireEvent.click(screen.getByRole('button', { name: 'Copy diagnostics' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Could not copy diagnostics'));
  });

  it('contains diagnostics bridge failures without exposing error details', async () => {
    window.janet = {
      ...originalJanet,
      copyDiagnostics: vi.fn().mockRejectedValue(new Error('C:\\Users\\private\\settings.json')),
    };
    renderThemeSwitcher();

    fireEvent.click(screen.getByRole('button', { name: 'Copy diagnostics' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Could not copy diagnostics'));
    expect(document.body).not.toHaveTextContent('C:\\Users\\private\\settings.json');
  });

  it('offers System, Reduced and Off transparency and reports the choice', () => {
    const onTransparencyChange = vi.fn();
    renderThemeSwitcher({ transparency: 'system', onTransparencyChange });
    const group = screen.getByRole('group', { name: 'Transparency' });
    const options = ['System', 'Reduced', 'Off'].map((name) => screen.getByRole('button', { name, pressed: name === 'System' }));
    expect(options.every((option) => group.contains(option))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Reduced' }));
    expect(onTransparencyChange).toHaveBeenCalledWith('reduced');
  });

  it('explains when the system is reducing transparency', () => {
    renderThemeSwitcher({ transparency: 'system', systemReducesTransparency: true });
    expect(screen.getByText(/system is set to reduce transparency/i)).toBeTruthy();
  });
});
