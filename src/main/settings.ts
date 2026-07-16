import * as fs from 'fs';
import * as path from 'path';
import { app, safeStorage } from 'electron';
import { DEFAULT_TERMINAL_FONT_FAMILY, normalizeTerminalFontFamily } from '../shared/typography';
import type { StartupShellDialect } from '../shared/startupCommands';
import { isStartupShellDialect, sanitizeStartupCommands } from '../shared/startupCommands';

// Mirrors `SavedSession` in src/renderer/sessionRestore.ts. Duplicated as a
// type-only contract because the main process cannot import the renderer
// (it would pull in React, xterm, etc.). Keep in sync — both files are
// exercised by the SettingsManager round-trip tests.
export interface SavedPaneLeaf {
  type: 'leaf';
  title?: string;
  terminalType?: 'local' | 'ssh';
  cwd?: string;
  sshProfileId?: string;
  startupCommands?: string[];
  startupShellDialect?: StartupShellDialect;
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
    root?: SavedPaneNode;
    terminalCount: number;
    splitDirection: 'horizontal' | 'vertical';
  }>;
  /** SHA-256 SSH host-key fingerprints, keyed by normalized host and port. */
  sshHostKeys: Record<string, string>;
  gitWorktreeBaseDir: string;
  gitWorktreeNameTemplate: string;
  /** Last-known open workspace. Restored on next launch. */
  session: SavedSession;
}

interface StoredSecretV1 {
  version: 1;
  scheme: 'electron-safe-storage';
  ciphertext: string;
}

type StoredSSHProfile = Omit<AppSettings['sshProfiles'][number], 'password' | 'privateKey'> & {
  passwordSecret?: StoredSecretV1;
  privateKeySecret?: StoredSecretV1;
  /** Legacy pre-v1 field. It is decrypted only when safeStorage is available. */
  passwordEncrypted?: string;
  /** Legacy pre-v1 field. It is decrypted only when safeStorage is available. */
  privateKeyEncrypted?: string;
  /** Legacy plaintext fields are read once and migrated on the next save. */
  password?: string;
  privateKey?: string;
};

type StoredSSHSecrets = Pick<StoredSSHProfile,
  'passwordSecret' | 'privateKeySecret' | 'passwordEncrypted' | 'privateKeyEncrypted'>;

type StoredAppSettings = Omit<AppSettings, 'sshProfiles'> & {
  sshProfiles: StoredSSHProfile[];
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
  fontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
  sidebarSide: 'right',
  keybindings: { ...DEFAULT_KEYBINDINGS },
  sshProfiles: [],
  workspaceTabs: [],
  sshHostKeys: {},
  gitWorktreeBaseDir: '../',
  gitWorktreeNameTemplate: '{repo}-{branch}',
  session: EMPTY_SESSION,
};

export class SettingsManager {
  private filePath: string;
  private cache: AppSettings;
  private storedSshSecrets = new Map<string, StoredSSHSecrets>();

  constructor() {
    const userDataPath = app.getPath('userData');
    this.filePath = path.join(userDataPath, 'settings.json');
    this.cache = this.load();
  }

  get(): AppSettings {
    return {
      ...this.cache,
      sshProfiles: this.cache.sshProfiles.map((profile) => ({ ...profile })),
      workspaceTabs: this.cache.workspaceTabs
        .map(cloneWorkspaceTabPreset)
        .filter((preset): preset is AppSettings['workspaceTabs'][number] => Boolean(preset)),
      sshHostKeys: { ...this.cache.sshHostKeys },
      session: { ...this.cache.session, tabs: [...this.cache.session.tabs] },
    };
  }

  set(updates: Partial<AppSettings>): AppSettings {
    this.cache = { ...this.cache, ...updates };
    this.save();
    return this.get();
  }

  getSshHostKey(host: string, port: number): string | undefined {
    return this.cache.sshHostKeys[sshHostKeyId(host, port)];
  }

  rememberSshHostKey(host: string, port: number, fingerprint: string): void {
    const key = sshHostKeyId(host, port);
    const existing = this.cache.sshHostKeys[key];
    if (existing && existing !== fingerprint) {
      throw new Error(`SSH host key changed for ${host}:${port}`);
    }
    if (existing === fingerprint) return;
    const previousHostKeys = this.cache.sshHostKeys;
    this.cache = {
      ...this.cache,
      sshHostKeys: { ...this.cache.sshHostKeys, [key]: fingerprint },
    };
    if (!this.save()) {
      this.cache = { ...this.cache, sshHostKeys: previousHostKeys };
      throw new Error(`Could not persist SSH host key for ${host}:${port}`);
    }
  }

  migrateSshHostKey(
    host: string,
    port: number,
    expectedFingerprint: string,
    fingerprint: string,
  ): void {
    const key = sshHostKeyId(host, port);
    const existing = this.cache.sshHostKeys[key];
    if (existing === fingerprint) return;
    if (existing !== expectedFingerprint) {
      throw new Error(`SSH host key changed for ${host}:${port}`);
    }

    const previousHostKeys = this.cache.sshHostKeys;
    this.cache = {
      ...this.cache,
      sshHostKeys: { ...this.cache.sshHostKeys, [key]: fingerprint },
    };
    if (!this.save()) {
      this.cache = { ...this.cache, sshHostKeys: previousHostKeys };
      throw new Error(`Could not migrate SSH host key for ${host}:${port}`);
    }
  }

  private load(): AppSettings {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<StoredAppSettings>;
      const stored = { ...DEFAULT_SETTINGS, ...parsed } as StoredAppSettings;
      this.captureStoredSecrets(stored.sshProfiles);
      return this.deserialize(stored);
    } catch {
      return { ...DEFAULT_SETTINGS, session: { ...EMPTY_SESSION } };
    }
  }

  private save(): boolean {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const serialized = this.serialize(this.cache);
      fs.writeFileSync(this.filePath, JSON.stringify(serialized, null, 2), 'utf-8');
      this.captureStoredSecrets(serialized.sshProfiles);
      return true;
    } catch (err) {
      console.error('Failed to save settings:', err);
      return false;
    }
  }

  private serialize(settings: AppSettings): StoredAppSettings {
    return {
      ...settings,
      sshProfiles: settings.sshProfiles.map((profile) => {
        const { password, privateKey, ...publicProfile } = profile;
        const stored: StoredSSHProfile = { ...publicProfile };
        const previous = this.storedSshSecrets.get(profile.id);
        const passwordSecret = password ? protectSecret(password) : undefined;
        const privateKeySecret = privateKey ? protectSecret(privateKey) : undefined;
        if (passwordSecret) stored.passwordSecret = passwordSecret;
        else if (password === undefined && profile.auth === 'password') {
          if (previous?.passwordSecret) stored.passwordSecret = previous.passwordSecret;
          else if (previous?.passwordEncrypted) stored.passwordEncrypted = previous.passwordEncrypted;
        }
        if (privateKeySecret) stored.privateKeySecret = privateKeySecret;
        else if (privateKey === undefined && profile.auth === 'key') {
          if (previous?.privateKeySecret) stored.privateKeySecret = previous.privateKeySecret;
          else if (previous?.privateKeyEncrypted) stored.privateKeyEncrypted = previous.privateKeyEncrypted;
        }
        return stored;
      }),
    };
  }

  private deserialize(settings: StoredAppSettings): AppSettings {
    const profiles = Array.isArray(settings.sshProfiles) ? settings.sshProfiles : [];
    return {
      ...settings,
      fontFamily: normalizeTerminalFontFamily(settings.fontFamily),
      sshHostKeys: isStringRecord(settings.sshHostKeys) ? { ...settings.sshHostKeys } : {},
      sshProfiles: profiles.map((profile) => ({
        id: profile.id,
        host: profile.host,
        port: profile.port,
        username: profile.username,
        auth: profile.auth,
        password: profile.password ?? unprotectSecret(profile.passwordSecret) ?? decryptLegacySecret(profile.passwordEncrypted),
        privateKey: profile.privateKey ?? unprotectSecret(profile.privateKeySecret) ?? decryptLegacySecret(profile.privateKeyEncrypted),
      })),
      workspaceTabs: (Array.isArray(settings.workspaceTabs) ? settings.workspaceTabs : [])
        .map(cloneWorkspaceTabPreset)
        .filter((preset): preset is AppSettings['workspaceTabs'][number] => Boolean(preset)),
      session: {
        ...EMPTY_SESSION,
        ...(settings.session ?? {}),
        tabs: Array.isArray((settings as any).session?.tabs) ? (settings as any).session.tabs : [],
      },
    };
  }

  private captureStoredSecrets(profiles: StoredSSHProfile[]): void {
    this.storedSshSecrets.clear();
    if (!Array.isArray(profiles)) return;
    for (const profile of profiles) {
      this.storedSshSecrets.set(profile.id, {
        passwordSecret: profile.passwordSecret,
        privateKeySecret: profile.privateKeySecret,
        passwordEncrypted: profile.passwordEncrypted,
        privateKeyEncrypted: profile.privateKeyEncrypted,
      });
    }
  }
}

function cloneWorkspaceTabPreset(value: unknown): AppSettings['workspaceTabs'][number] | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { root: rawRoot, ...preset } = value as Record<string, unknown>;
  const root = cloneSavedPaneNode(rawRoot);
  return {
    ...preset,
    ...(root ? { root } : {}),
  } as AppSettings['workspaceTabs'][number];
}

function cloneSavedPaneNode(node: unknown): SavedPaneNode | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const candidate = node as Record<string, unknown>;
  if (candidate.type === 'split') {
    const children = (Array.isArray(candidate.children) ? candidate.children : [])
      .map(cloneSavedPaneNode)
      .filter((child): child is SavedPaneNode => Boolean(child));
    if (children.length === 0) return undefined;
    const sizes = Array.isArray(candidate.sizes)
      && candidate.sizes.length === children.length
      && candidate.sizes.every((size) => typeof size === 'number' && Number.isFinite(size))
      ? [...candidate.sizes] as number[]
      : new Array<number>(children.length).fill(1);
    return {
      type: 'split',
      direction: candidate.direction === 'horizontal' ? 'horizontal' : 'vertical',
      sizes,
      children,
    };
  }
  if (candidate.type !== 'leaf') return undefined;
  const terminalType = candidate.terminalType === 'ssh' || candidate.terminalType === 'local'
    ? candidate.terminalType
    : undefined;
  const hasExplicitStartupDialect = candidate.startupShellDialect !== undefined
    && candidate.startupShellDialect !== null
    && candidate.startupShellDialect !== '';
  const startupShellDialect = isStartupShellDialect(candidate.startupShellDialect)
    ? candidate.startupShellDialect
    : undefined;
  const validStartupDialect = startupShellDialect !== undefined;
  const startupCommands = terminalType === 'ssh'
    && hasExplicitStartupDialect
    && !validStartupDialect
    ? []
    : sanitizeStartupCommands(candidate.startupCommands);
  return {
    type: 'leaf',
    ...(typeof candidate.title === 'string' && candidate.title ? { title: candidate.title } : {}),
    ...(terminalType ? { terminalType } : {}),
    ...(typeof candidate.cwd === 'string' && candidate.cwd ? { cwd: candidate.cwd } : {}),
    ...(typeof candidate.sshProfileId === 'string' && candidate.sshProfileId
      ? { sshProfileId: candidate.sshProfileId }
      : {}),
    ...(startupCommands.length > 0 ? { startupCommands } : {}),
    ...(startupCommands.length > 0 && terminalType === 'ssh'
      ? { startupShellDialect: validStartupDialect ? startupShellDialect : 'posix' }
      : startupCommands.length > 0 && validStartupDialect
        ? { startupShellDialect }
      : {}),
  };
}

function protectSecret(secret: string): StoredSecretV1 | undefined {
  if (!safeStorage?.isEncryptionAvailable()) {
    console.warn('[settings] safeStorage unavailable; SSH credential was not persisted');
    return undefined;
  }
  try {
    return {
      version: 1,
      scheme: 'electron-safe-storage',
      ciphertext: Buffer.from(safeStorage.encryptString(secret)).toString('base64'),
    };
  } catch (error) {
    console.warn('[settings] safeStorage encryption failed; SSH credential was not persisted', error);
    return undefined;
  }
}

function unprotectSecret(secret: StoredSecretV1 | undefined): string | undefined {
  if (!secret || secret.version !== 1 || secret.scheme !== 'electron-safe-storage' || !secret.ciphertext) {
    return undefined;
  }
  if (!safeStorage?.isEncryptionAvailable()) return undefined;
  try {
    return safeStorage.decryptString(Buffer.from(secret.ciphertext, 'base64'));
  } catch {
    return undefined;
  }
}

function decryptLegacySecret(secret: string | undefined): string | undefined {
  if (!secret || !safeStorage?.isEncryptionAvailable()) return undefined;
  try {
    return safeStorage.decryptString(Buffer.from(secret, 'base64'));
  } catch {
    return undefined;
  }
}

function sshHostKeyId(host: string, port: number): string {
  return `${host.trim().toLowerCase()}:${port}`;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) &&
    Object.values(value as Record<string, unknown>).every((entry) => typeof entry === 'string');
}
