import React from 'react';
import { themeOptions, ThemeName } from '../themes';
import { PaletteIcon, TypeIcon } from '../icons';

const THEME_SWATCHES: Record<ThemeName, [string, string]> = {
  'tokyo-night': ['#7aa2f7', '#0f0f1a'],
  dracula: ['#bd93f9', '#282a36'],
  'one-dark': ['#61afef', '#282c34'],
  'solarized-light': ['#268bd2', '#fdf6e3'],
  gruvbox: ['#d79921', '#282828'],
};

interface ThemeSwitcherProps {
  currentTheme: ThemeName;
  onThemeChange: (theme: ThemeName) => void;
  fontSize: number;
  onFontSizeChange: (size: number) => void;
  sidebarSide: 'left' | 'right';
  onSidebarSideChange: (side: 'left' | 'right') => void;
}

export default function ThemeSwitcher({
  currentTheme,
  onThemeChange,
  fontSize,
  onFontSizeChange,
  sidebarSide,
  onSidebarSideChange,
}: ThemeSwitcherProps) {
  return (
    <div className="theme-switcher">
      <div className="settings-header">
        <span className="section-title">Settings</span>
      </div>
      <div className="theme-section">
        <label className="theme-label">
          <PaletteIcon size="xs" /> Theme
        </label>
        <div className="theme-options" role="group" aria-label="Theme">
          {themeOptions.map((opt) => (
            <button
              key={opt.value}
              className={`theme-option ${currentTheme === opt.value ? 'active' : ''}`}
              onClick={() => onThemeChange(opt.value as ThemeName)}
              aria-pressed={currentTheme === opt.value}
            >
              <span
                className="theme-swatch"
                aria-hidden="true"
                style={{ '--swatch-accent': THEME_SWATCHES[opt.value as ThemeName][0], '--swatch-surface': THEME_SWATCHES[opt.value as ThemeName][1] } as React.CSSProperties}
              />
              <span>{opt.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="theme-section">
        <label className="theme-label" htmlFor="terminal-text-size">
          <TypeIcon size="xs" /> Terminal text size <span className="theme-value">{fontSize}px</span>
        </label>
        <div className="font-size-controls">
          <input
            type="range"
            id="terminal-text-size"
            min="10"
            max="24"
            value={fontSize}
            onChange={(e) => onFontSizeChange(parseInt(e.target.value))}
            className="font-size-slider"
            aria-label="Terminal text size"
          />
        </div>
      </div>

      <div className="theme-section">
        <span className="theme-label">Sidebar position</span>
        <div className="theme-options" role="group" aria-label="Sidebar position">
          <button
            className={`theme-option ${sidebarSide === 'left' ? 'active' : ''}`}
            onClick={() => onSidebarSideChange('left')}
            aria-pressed={sidebarSide === 'left'}
          >
            Left
          </button>
          <button
            className={`theme-option ${sidebarSide === 'right' ? 'active' : ''}`}
            onClick={() => onSidebarSideChange('right')}
            aria-pressed={sidebarSide === 'right'}
          >
            Right
          </button>
        </div>
      </div>
    </div>
  );
}
