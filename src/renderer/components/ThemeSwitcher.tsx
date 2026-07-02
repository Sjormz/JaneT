import React from 'react';
import { themeOptions, ThemeName } from '../themes';
import { PaletteIcon, TypeIcon } from '../icons';

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
      <div className="theme-section">
        <label className="theme-label">
          <PaletteIcon size="xs" /> Theme
        </label>
        <div className="theme-options">
          {themeOptions.map((opt) => (
            <button
              key={opt.value}
              className={`theme-option ${currentTheme === opt.value ? 'active' : ''}`}
              onClick={() => onThemeChange(opt.value as ThemeName)}
              title={opt.label}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="theme-section">
        <label className="theme-label">
          <TypeIcon size="xs" /> Font Size: {fontSize}px
        </label>
        <div className="font-size-controls">
          <input
            type="range"
            min="10"
            max="24"
            value={fontSize}
            onChange={(e) => onFontSizeChange(parseInt(e.target.value))}
            className="font-size-slider"
            aria-label="Font size"
          />
        </div>
      </div>

      <div className="theme-section">
        <label className="theme-label">Explorer Side</label>
        <div className="theme-options">
          <button
            className={`theme-option ${sidebarSide === 'left' ? 'active' : ''}`}
            onClick={() => onSidebarSideChange('left')}
          >
            Left
          </button>
          <button
            className={`theme-option ${sidebarSide === 'right' ? 'active' : ''}`}
            onClick={() => onSidebarSideChange('right')}
          >
            Right
          </button>
        </div>
      </div>
    </div>
  );
}
