import React from 'react';
import { getTheme, themeOptions, ThemeName } from '../themes';
import { ArrowRightIcon, CopyIcon } from '../icons';
import type { TransparencyPreference } from '../../main/settings';
import { useGlidingSelection } from './motion';

interface ThemeSwitcherProps {
  currentTheme: ThemeName;
  onThemeChange: (theme: ThemeName) => void;
  fontSize: number;
  onFontSizeChange: (size: number) => void;
  sidebarSide: 'left' | 'right';
  onSidebarSideChange: (side: 'left' | 'right') => void;
  transparency: TransparencyPreference;
  systemReducesTransparency: boolean;
  onTransparencyChange: (preference: TransparencyPreference) => void;
  notificationsEnabled: boolean;
  onNotificationsEnabledChange: (enabled: boolean) => void;
  /** Shown as the first Advanced row when provided. */
  onOpenShortcuts?: () => void;
}

const TRANSPARENCY_OPTIONS: Array<{ value: TransparencyPreference; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'reduced', label: 'Reduced' },
  { value: 'off', label: 'Off' },
];

export default function ThemeSwitcher({
  currentTheme,
  onThemeChange,
  fontSize,
  onFontSizeChange,
  sidebarSide,
  onSidebarSideChange,
  transparency,
  systemReducesTransparency,
  onTransparencyChange,
  notificationsEnabled,
  onNotificationsEnabledChange,
  onOpenShortcuts,
}: ThemeSwitcherProps) {
  const [diagnosticsFeedback, setDiagnosticsFeedback] = React.useState('');

  const copyDiagnostics = async () => {
    try {
      setDiagnosticsFeedback(await window.janet.copyDiagnostics()
        ? 'Diagnostics copied'
        : 'Could not copy diagnostics');
    } catch {
      setDiagnosticsFeedback('Could not copy diagnostics');
    }
  };

  const transparencyRef = React.useRef<HTMLDivElement>(null);
  const sideRef = React.useRef<HTMLDivElement>(null);
  useGlidingSelection(transparencyRef, '.segmented-option.active', transparency);
  useGlidingSelection(sideRef, '.segmented-option.active', sidebarSide);

  const statusMessage = (
    <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{diagnosticsFeedback}</span>
  );

  return (
    <div className="theme-switcher">
      <h2 className="settings-title">Settings</h2>

      <section className="settings-group" aria-labelledby="settings-appearance">
        <h3 className="settings-group-title" id="settings-appearance">Appearance</h3>
        <div className="settings-inset">
          <div className="theme-options" role="group" aria-label="Theme">
            {themeOptions.map((opt) => {
              const theme = getTheme(opt.value as ThemeName).css;
              return (
                <button
                  key={opt.value}
                  className={`theme-option ${currentTheme === opt.value ? 'active' : ''}`}
                  onClick={() => onThemeChange(opt.value as ThemeName)}
                  aria-pressed={currentTheme === opt.value}
                >
                  {/* A miniature of the theme drawn from its real colours. */}
                  <span
                    className="theme-preview"
                    aria-hidden="true"
                    style={{
                      '--preview-canvas': theme['bg-primary'],
                      '--preview-chrome': theme['bg-secondary'],
                      '--preview-text': theme['text-primary'],
                      '--preview-ok': theme.green,
                      '--preview-accent': theme.blue,
                    } as React.CSSProperties}
                  >
                    <i /><i /><i />
                  </span>
                  <span className="theme-option-label">{opt.label}</span>
                </button>
              );
            })}
          </div>
          <div className="settings-row stacked">
            <span className="settings-row-text">
              <span id="transparency-label">Transparency</span>
              <small id="transparency-help">
                {transparency === 'system'
                  ? systemReducesTransparency
                    ? 'Your system is set to reduce transparency, so JaneT uses solid glass.'
                    : 'Glass follows your system setting for reduced transparency.'
                  : transparency === 'reduced'
                    ? 'Thicker glass over a solid window. Terminals and editors are always opaque.'
                    : 'Solid surfaces everywhere, with no blur.'}
              </small>
            </span>
            <div className="segmented" ref={transparencyRef} role="group" aria-labelledby="transparency-label" aria-describedby="transparency-help">
              {TRANSPARENCY_OPTIONS.map(({ value, label }) => (
                <button key={value} className={`segmented-option ${transparency === value ? 'active' : ''}`} onClick={() => onTransparencyChange(value)} aria-pressed={transparency === value}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="settings-row">
            <label className="settings-row-text" htmlFor="terminal-text-size">Terminal and editor text size</label>
            <input
              type="range"
              id="terminal-text-size"
              min="10"
              max="24"
              value={fontSize}
              onChange={(e) => onFontSizeChange(parseInt(e.target.value))}
              className="font-size-slider"
              aria-label="Terminal and editor text size"
            />
            <span className="settings-row-value">{fontSize}px</span>
          </div>
        </div>
      </section>

      <section className="settings-group" aria-labelledby="settings-layout">
        <h3 className="settings-group-title" id="settings-layout">Layout</h3>
        <div className="settings-inset">
          <div className="settings-row">
            <span className="settings-row-text">Project tools position</span>
            <div className="segmented" ref={sideRef} role="group" aria-label="Project tools position">
              {(['left', 'right'] as const).map((side) => (
                <button key={side} className={`segmented-option ${sidebarSide === side ? 'active' : ''}`} onClick={() => onSidebarSideChange(side)} aria-pressed={sidebarSide === side}>
                  {side === 'left' ? 'Left' : 'Right'}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="settings-group notification-settings" aria-labelledby="settings-notifications">
        <h3 className="settings-group-title" id="settings-notifications">Notifications</h3>
        <div className="settings-inset">
          <label className="settings-row notification-toggle">
            <span className="settings-row-text">
              <span>Notify when long commands finish</span>
              <small className="workspace-form-help" id="notification-help">JaneT must be unfocused. Commands must run at least 10 seconds.</small>
            </span>
            <input
              type="checkbox"
              className="switch"
              aria-label="Notify when long commands finish"
              aria-describedby="notification-help"
              checked={notificationsEnabled}
              onChange={(event) => onNotificationsEnabledChange(event.currentTarget.checked)}
            />
          </label>
          <button type="button" className="settings-row settings-link" onClick={() => {
            void window.janet.getNotificationStatus().then(message => setDiagnosticsFeedback(message ?? 'Notifications supported. OS Do Not Disturb and permissions can still suppress them.')).catch(() => setDiagnosticsFeedback('Could not check notification status.'));
          }}>Check notification delivery</button>
        </div>
      </section>

      <section className="settings-group" aria-labelledby="settings-advanced">
        <h3 className="settings-group-title" id="settings-advanced">Advanced</h3>
        <div className="settings-inset">
          {onOpenShortcuts && (
            <button type="button" className="settings-row settings-nav" onClick={onOpenShortcuts} aria-label="Keyboard shortcuts" aria-haspopup="dialog">
              <span className="settings-row-text">Keyboard shortcuts<small>Customize app commands and keys</small></span>
              <ArrowRightIcon size="sm" />
            </button>
          )}
          <button type="button" className="settings-row settings-nav" onClick={() => { void copyDiagnostics(); }} aria-label="Copy diagnostics">
            <span className="settings-row-text">Copy diagnostics<small>Copy privacy-safe app and system details</small></span>
            <CopyIcon size="sm" />
          </button>
        </div>
      </section>
      {statusMessage}
    </div>
  );
}
