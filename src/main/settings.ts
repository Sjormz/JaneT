import * as fs from 'fs';
import * as path from 'path';
import { app, safeStorage } from 'electron';

// Mirrors `SavedSession` in src/renderer/sessionRestore.ts. Duplicated as a
// type-only contract because the main process cannot import the renderer
// (it would pull in React, xterm, etc.). Keep in sync — both files are
// exercised by the SettingsManager round-trip tests.
export interface SavedPaneLeaf {
  type: 'leaf';
  title?: string;
}

export interface SavedPaneSplit {
  type: 'split';
  direction: 'horizontal' | 'vertical';
  sizes: number[];
  children: SavedPaneNode[];
}

export type SavedPaneNode = SavedPaneLeaf | SavedPaneSplit;

export interface SavedTab {
  id: string;
  title: string;
  type: 'local' | 'ssh';
  cwd?: string;
  sshProfileId?: string;
  root: SavedPaneNode;
}

export interface SavedSession {
  tabs: SavedTab[];
  activeTabId: string | null;
  sidebarOpen: boolean;
  tabsOpen: boolean;
  sidebarSection: 'files' | 'ssh' | 'git' | 'settings';
}

export type ThemeName = 'tokyo-night' | 'dracula' | 'one-dark' | 'solarized-light' | 'gruvbox';

export type KeybindingAction =
  | 'search-toggle'
  | 'palette-toggle'
  | 'new-terminal'
  | 'close-tab'
  | 'toggle-sidebar'
  | 'font-increase'
  | 'font-decrease'
  | 'split-right'
  | 'split-down'
  | 'close-pane';

export const DEFAULT_KEYBINDINGS: Record<KeybindingAction, string> = {
  'search-toggle': 'Ctrl+F',
  'palette-toggle': 'Ctrl+K',
  'new-terminal': 'Ctrl+N',
  'close-tab': 'Ctrl+W',
  'toggle-sidebar': 'Ctrl+B',
  'font-increase': 'Ctrl+Plus',
  'font-decrease': 'Ctrl+-',
  'split-right': 'Ctrl+\\',
  'split-down': 'Ctrl+Shift+\\',
  'close-pane': 'Ctrl+Shift+W',
};

export interface AppSettings {
  theme: ThemeName;
  fontSize: number;
  fontFamily: string;
  sidebarSide: 'left' | 'right';
  keybindings: Record<string, string>;
  sshProfiles: Array<{
    id: string;
    host: string;
    port: number;
    username?: string;
    auth: 'password' | 'key';
    password?: string;
    privateKey?: string;
  }>;
  workspaceTabs: Array<{
    id: string;
    name: string;
    type: 'local' | 'ssh';
    cwd?: string;
    sshProfileId?: string;
    terminalCount: number;
    splitDirection: 'horizontal' | 'vertical';
  }>;
  /** Last-known open workspace. Restored on next launch. */
  session: SavedSession;
}

type StoredSSHProfile = AppSettings['sshProfiles'][number] & {
  passwordEncrypted?: string;
  privateKeyEncrypted?: string;
};

const EMPTY_SESSION: SavedSession = {
  tabs: [],
  activeTabId: null,
  sidebarOpen: true,
  tabsOpen: true,
  sidebarSection: 'files',
};

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'tokyo-night',
  fontSize: 14,
  fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace",
  sidebarSide: 'left',
  keybindings: { ...DEFAULT_KEYBINDINGS },
  sshProfiles: [],
  workspaceTabs: [],
  session: EMPTY_SESSION,
};

export class SettingsManager {
  private filePath: string;
  private cache: AppSettings;

  constructor() {
    const userDataPath = app.getPath('userData');
    this.filePath = path.join(userDataPath, 'settings.json');
    this.cache = this.load();
  }

  get(): AppSettings {
    return { ...this.cache };
  }

  set(updates: Partial<AppSettings>): AppSettings {
    this.cache = { ...this.cache, ...updates };
    this.save();
    return this.get();
  }

  private load(): AppSettings {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      return this.deserialize({ ...DEFAULT_SETTINGS, ...parsed });
    } catch {
      return { ...DEFAULT_SETTINGS, session: { ...EMPTY_SESSION } };
    }
  }

  private save(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.serialize(this.cache), null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  }

  private serialize(settings: AppSettings): AppSettings {
    return {
      ...settings,
      sshProfiles: settings.sshProfiles.map((profile) => {
        const stored: StoredSSHProfile = { ...profile };
        if (profile.password) stored.passwordEncrypted = encryptSecret(profile.password);
        if (profile.privateKey) stored.privateKeyEncrypted = encryptSecret(profile.privateKey);
        delete stored.password;
        delete stored.privateKey;
        return stored;
      }),
    } as AppSettings;
  }

  private deserialize(settings: AppSettings): AppSettings {
    return {
      ...settings,
      sshProfiles: settings.sshProfiles.map((profile: StoredSSHProfile) => ({
        id: profile.id,
        host: profile.host,
        port: profile.port,
        username: profile.username,
        auth: profile.auth,
        password: profile.password ?? decryptSecret(profile.passwordEncrypted),
        privateKey: profile.privateKey ?? decryptSecret(profile.privateKeyEncrypted),
      })),
      session: {
        ...EMPTY_SESSION,
        ...(settings.session ?? {}),
        tabs: Array.isArray((settings as any).session?.tabs) ? (settings as any).session.tabs : [],
      },
    };
  }
}

function encryptSecret(secret: string): string {
  if (!safeStorage?.isEncryptionAvailable()) return secret;
  return Buffer.from(safeStorage.encryptString(secret)).toString('base64');
}

function decryptSecret(secret: string | undefined): string | undefined {
  if (!secret) return undefined;
  if (!safeStorage?.isEncryptionAvailable()) return secret;
  try {
    return safeStorage.decryptString(Buffer.from(secret, 'base64'));
  } catch {
    return undefined;
  }
}
