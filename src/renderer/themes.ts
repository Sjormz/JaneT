import { ITheme } from '@xterm/xterm';
import { ThemeName } from '../main/settings';
export type { ThemeName };

/**
 * CSS variable overrides per theme.
 * Keys are CSS custom property names (without `--` prefix).
 */
export type CssThemeVars = Record<string, string>;

export interface ThemeDefinition {
  name: ThemeName;
  label: string;
  css: CssThemeVars;
  xterm: ITheme;
}

const themes: Record<ThemeName, ThemeDefinition> = {
  'tokyo-night': {
    name: 'tokyo-night',
    label: 'Tokyo Night',
    css: {
      'bg-primary': '#0f0f1a',
      'bg-secondary': '#1a1b2e',
      'bg-tertiary': '#24253b',
      'bg-hover': '#2a2b42',
      'bg-active': '#33467c',
      'text-primary': '#c0caf5',
      'text-secondary': '#a9b1d6',
      'text-muted': '#565f89',
      'text-accent': '#7aa2f7',
      'border-color': '#2a2b42',
      'border-active': '#7aa2f7',
      'red': '#f7768e',
      'green': '#9ece6a',
      'yellow': '#e0af68',
      'blue': '#7aa2f7',
      'magenta': '#bb9af7',
      'cyan': '#7dcfff',
      // Glass system
      'glass-bg': 'rgba(15, 15, 26, 0.78)',
      'glass-bg-light': 'rgba(26, 27, 46, 0.6)',
      'glass-border': 'rgba(255, 255, 255, 0.06)',
      'glass-border-active': 'rgba(122, 162, 247, 0.4)',
    },
    xterm: {
      background: '#0f0f1a',
      foreground: '#c0caf5',
      cursor: '#c0caf5',
      selectionBackground: '#33467c',
      black: '#1d1f2b',
      red: '#f7768e',
      green: '#9ece6a',
      yellow: '#e0af68',
      blue: '#7aa2f7',
      magenta: '#bb9af7',
      cyan: '#7dcfff',
      white: '#a9b1d6',
      brightBlack: '#414868',
      brightRed: '#f7768e',
      brightGreen: '#9ece6a',
      brightYellow: '#e0af68',
      brightBlue: '#7aa2f7',
      brightMagenta: '#bb9af7',
      brightCyan: '#7dcfff',
      brightWhite: '#c0caf5',
    },
  },
  dracula: {
    name: 'dracula',
    label: 'Dracula',
    css: {
      'bg-primary': '#1e1f29',
      'bg-secondary': '#282a36',
      'bg-tertiary': '#343746',
      'bg-hover': '#3c3e51',
      'bg-active': '#44475a',
      'text-primary': '#f8f8f2',
      'text-secondary': '#e0e0e0',
      'text-muted': '#6272a4',
      'text-accent': '#bd93f9',
      'border-color': '#343746',
      'border-active': '#bd93f9',
      'red': '#ff5555',
      'green': '#50fa7b',
      'yellow': '#f1fa8c',
      'blue': '#8be9fd',
      'magenta': '#bd93f9',
      'cyan': '#66d9ef',
      'glass-bg': 'rgba(30, 31, 41, 0.78)',
      'glass-bg-light': 'rgba(40, 42, 54, 0.6)',
      'glass-border': 'rgba(255, 255, 255, 0.06)',
      'glass-border-active': 'rgba(189, 147, 249, 0.4)',
    },
    xterm: {
      background: '#1e1f29',
      foreground: '#f8f8f2',
      cursor: '#f8f8f2',
      selectionBackground: '#44475a',
      black: '#21222c',
      red: '#ff5555',
      green: '#50fa7b',
      yellow: '#f1fa8c',
      blue: '#8be9fd',
      magenta: '#bd93f9',
      cyan: '#66d9ef',
      white: '#f8f8f2',
      brightBlack: '#6272a4',
      brightRed: '#ff6e6e',
      brightGreen: '#69ff94',
      brightYellow: '#ffffa5',
      brightBlue: '#a4ffff',
      brightMagenta: '#d6acff',
      brightCyan: '#80ffea',
      brightWhite: '#ffffff',
    },
  },
  'one-dark': {
    name: 'one-dark',
    label: 'One Dark',
    css: {
      'bg-primary': '#1e2127',
      'bg-secondary': '#282c34',
      'bg-tertiary': '#31363f',
      'bg-hover': '#393e48',
      'bg-active': '#3e4451',
      'text-primary': '#abb2bf',
      'text-secondary': '#9ca0b0',
      'text-muted': '#5c6370',
      'text-accent': '#61afef',
      'border-color': '#3e4451',
      'border-active': '#61afef',
      'red': '#e06c75',
      'green': '#98c379',
      'yellow': '#e5c07b',
      'blue': '#61afef',
      'magenta': '#c678dd',
      'cyan': '#56b6c2',
      'glass-bg': 'rgba(30, 33, 39, 0.78)',
      'glass-bg-light': 'rgba(40, 44, 52, 0.6)',
      'glass-border': 'rgba(255, 255, 255, 0.06)',
      'glass-border-active': 'rgba(97, 175, 239, 0.4)',
    },
    xterm: {
      background: '#1e2127',
      foreground: '#abb2bf',
      cursor: '#abb2bf',
      selectionBackground: '#3e4451',
      black: '#1e2127',
      red: '#e06c75',
      green: '#98c379',
      yellow: '#e5c07b',
      blue: '#61afef',
      magenta: '#c678dd',
      cyan: '#56b6c2',
      white: '#abb2bf',
      brightBlack: '#5c6370',
      brightRed: '#e06c75',
      brightGreen: '#98c379',
      brightYellow: '#e5c07b',
      brightBlue: '#61afef',
      brightMagenta: '#c678dd',
      brightCyan: '#56b6c2',
      brightWhite: '#abb2bf',
    },
  },
  'solarized-light': {
    name: 'solarized-light',
    label: 'Solarized Light',
    css: {
      'bg-primary': '#fdf6e3',
      'bg-secondary': '#eee8d5',
      'bg-tertiary': '#e4ddc5',
      'bg-hover': '#d9d2b8',
      'bg-active': '#cdc5ab',
      'text-primary': '#2f4850',
      'text-secondary': '#40565d',
      'text-muted': '#93a1a1',
      'text-accent': '#0b5d8f',
      'border-color': '#cdc5ab',
      'border-active': '#0b5d8f',
      'red': '#b12220',
      'green': '#4f6f00',
      'yellow': '#735100',
      'blue': '#0b5d8f',
      'magenta': '#a21f65',
      'cyan': '#006b64',
      'glass-bg': 'rgba(253, 246, 227, 0.85)',
      'glass-bg-light': 'rgba(238, 232, 213, 0.7)',
      'glass-border': 'rgba(0, 0, 0, 0.08)',
      'glass-border-active': 'rgba(38, 139, 210, 0.4)',
    },
    xterm: {
      background: '#fdf6e3',
      foreground: '#2f4850',
      cursor: '#073642',
      selectionBackground: '#cdc5ab',
      black: '#073642',
      red: '#dc322f',
      green: '#859900',
      yellow: '#b58900',
      blue: '#268bd2',
      magenta: '#d33682',
      cyan: '#2aa198',
      white: '#eee8d5',
      brightBlack: '#93a1a1',
      brightRed: '#dc322f',
      brightGreen: '#859900',
      brightYellow: '#b58900',
      brightBlue: '#268bd2',
      brightMagenta: '#d33682',
      brightCyan: '#2aa198',
      brightWhite: '#fdf6e3',
    },
  },
  gruvbox: {
    name: 'gruvbox',
    label: 'Gruvbox (Dark)',
    css: {
      'bg-primary': '#1b1b1b',
      'bg-secondary': '#282828',
      'bg-tertiary': '#32302f',
      'bg-hover': '#3c3836',
      'bg-active': '#504945',
      'text-primary': '#ebdbb2',
      'text-secondary': '#d5c4a1',
      'text-muted': '#928374',
      'text-accent': '#d79921',
      'border-color': '#3c3836',
      'border-active': '#d79921',
      'red': '#cc241d',
      'green': '#98971a',
      'yellow': '#d79921',
      'blue': '#458588',
      'magenta': '#b16286',
      'cyan': '#689d6a',
      'glass-bg': 'rgba(27, 27, 27, 0.78)',
      'glass-bg-light': 'rgba(40, 40, 40, 0.6)',
      'glass-border': 'rgba(255, 255, 255, 0.06)',
      'glass-border-active': 'rgba(215, 153, 33, 0.4)',
    },
    xterm: {
      background: '#1b1b1b',
      foreground: '#ebdbb2',
      cursor: '#ebdbb2',
      selectionBackground: '#504945',
      black: '#282828',
      red: '#cc241d',
      green: '#98971a',
      yellow: '#d79921',
      blue: '#458588',
      magenta: '#b16286',
      cyan: '#689d6a',
      white: '#a89984',
      brightBlack: '#928374',
      brightRed: '#fb4934',
      brightGreen: '#b8bb26',
      brightYellow: '#fabd2f',
      brightBlue: '#83a598',
      brightMagenta: '#d3869b',
      brightCyan: '#8ec07c',
      brightWhite: '#ebdbb2',
    },
  },
};

export default themes;

export function getTheme(name: ThemeName): ThemeDefinition {
  return themes[name] || themes['tokyo-night'];
}

export function applyCssTheme(cssVars: CssThemeVars): void {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(cssVars)) {
    root.style.setProperty(`--${key}`, value);
  }
  // Keep shared chrome opaque and theme-owned. Legacy `glass-*` entries in
  // saved theme definitions are deliberately normalized here so light themes
  // never inherit Tokyo Night titlebars, menus, or hover states.
  root.style.setProperty('--glass-bg', cssVars['bg-secondary']);
  root.style.setProperty('--glass-bg-strong', cssVars['bg-tertiary']);
  root.style.setProperty('--glass-bg-light', cssVars['bg-tertiary']);
  root.style.setProperty('--glass-border', cssVars['border-color']);
  root.style.setProperty('--glass-border-active', cssVars['border-active']);
  root.style.setProperty('--text-tertiary', cssVars['text-secondary']);
  root.style.setProperty('--text-disabled', cssVars['text-muted']);
}

export const themeNames = Object.keys(themes) as ThemeName[];
export const themeOptions = themeNames.map((name) => ({
  value: name,
  label: themes[name].label,
}));
