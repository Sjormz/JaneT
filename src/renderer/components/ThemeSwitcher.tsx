import React from 'react';
import { themeOptions, ThemeName } from '../themes';

interface ThemeSwitcherProps {
  currentTheme: ThemeName;
  onThemeChange: (theme: ThemeName) => void;
  fontSize: number;
  onFontSizeChange: (size: number) => void;
}

export default function ThemeSwitcher({
  currentTheme,
  onThemeChange,
  fontSize,
  onFontSizeChange,
}: ThemeSwitcherProps) {
  return (
    <div className="theme-switcher">
      <div className="theme-switcher-header">
        <span className="section-title">Settings</span>
      </div>

      <div className="theme-section">
        <label className="theme-label">Theme</label>
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
          Font Size: {fontSize}px
        </label>
        <div className="font-size-controls">
          <button
            className="icon-btn"
            onClick={() => onFontSizeChange(Math.max(10, fontSize - 1))}
            disabled={fontSize <= 10}
            title="Decrease font size"
          >
            −
          </button>
          <input
            type="range"
            min="10"
            max="24"
            value={fontSize}
            onChange={(e) => onFontSizeChange(parseInt(e.target.value))}
            className="font-size-slider"
          />
          <button
            className="icon-btn"
            onClick={() => onFontSizeChange(Math.min(24, fontSize + 1))}
            disabled={fontSize >= 24}
            title="Increase font size"
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}
