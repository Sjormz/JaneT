import * as fs from 'fs';
import * as path from 'path';
import { app, safeStorage } from 'electron';
import { DEFAULT_TERMINAL_FONT_FAMILY, normalizeTerminalFontFamily } from '../shared/typography';
import type { StartupShellDialect } from '../shared/startupCommands';
import {
  isStartupShellDialect,
  MAX_STARTUP_COMMAND_LENGTH,
  MAX_STARTUP_COMMAND_TOTAL_LENGTH,
  MAX_STARTUP_COMMANDS,
  sanitizeStartupCommands,
} from '../shared/startupCommands';
import { normalizeSnippets, type Snippet } from '../shared/snippets';

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
  | 'snippets-toggle'
  | 'split-right'
  | 'split-down'
  | 'close-pane'
  | 'rename-pane'
  | 'rename-tab';

export const DEFAULT_KEYBINDINGS: Record<KeybindingAction, string> = {
  'search-toggle': 'Ctrl+F',
  'palette-toggle': 'Ctrl+K',
  'new-terminal': 'Ctrl+N',
  'close-tab': 'Ctrl+W',
  'toggle-sidebar': 'Ctrl+B',
  'font-increase': 'Ctrl+Plus',
  'font-decrease': 'Ctrl+-',
  'snippets-toggle': 'Ctrl+Shift+P',
  'split-right': 'Ctrl+\\',
  'split-down': 'Ctrl+Shift+\\',
  'close-pane': 'Ctrl+Shift+W',
  'rename-pane': 'F2',
  'rename-tab': 'Ctrl+F2',
};

export interface AppSettings {
  theme: ThemeName;
  fontSize: number;
  fontFamily: string;
  sidebarSide: 'left' | 'right';
  keybindings: Record<string, string>;
  snippets: Snippet[];
  sshProfiles: Array<{
    id: string;
    host: string;
    port: number;
    username?: string;
    auth: 'password' | 'key';
    password?: string;
    privateKey?: string;
    jumpHostProfileId?: string;
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
const MAX_SAVED_SESSION_TABS = 64;
const MAX_SAVED_SESSION_TERMINALS = 64;
const MAX_SAVED_PANE_DEPTH = 64;
const MAX_SAVED_PANE_NODES = 128;
const MAX_SAVED_PANE_LEAVES = 64;
const MAX_SAVED_TITLE_LENGTH = 256;
const MAX_WORKSPACE_STRING_LENGTH = 8_192;
const MAX_SETTINGS_COLLECTION_ITEMS = 256;
const MAX_KEYBINDINGS = 64;
const MAX_SSH_SECRET_LENGTH = 100_000;
const MAX_SSH_SECRET_CIPHERTEXT_LENGTH = 512 * 1024;
const WORKSPACE_PRESET_KEYS = new Set([
  'id', 'name', 'type', 'cwd', 'sshProfileId', 'root', 'terminalCount', 'splitDirection',
]);
const SAVED_PANE_LEAF_KEYS = new Set([
  'type', 'title', 'terminalType', 'cwd', 'sshProfileId', 'startupCommands', 'startupShellDialect',
]);
const SAVED_PANE_SPLIT_KEYS = new Set(['type', 'direction', 'sizes', 'children']);
const SSH_PROFILE_KEYS = new Set([
  'id', 'host', 'port', 'username', 'auth', 'password', 'privateKey', 'jumpHostProfileId',
]);
const SAVED_SESSION_KEYS = new Set([
  'tabs', 'activeTabId', 'sidebarOpen', 'tabsOpen', 'sidebarSection',
]);
const SAVED_TAB_KEYS = new Set([
  'id', 'title', 'type', 'cwd', 'sshProfileId', 'root',
]);

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'tokyo-night',
  fontSize: 14,
  fontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
  sidebarSide: 'right',
  keybindings: { ...DEFAULT_KEYBINDINGS },
  snippets: [],
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
      keybindings: { ...this.cache.keybindings },
      snippets: this.cache.snippets.map((snippet) => ({ ...snippet })),
      sshProfiles: this.cache.sshProfiles.map((profile) => ({ ...profile })),
      workspaceTabs: this.cache.workspaceTabs
        .map(cloneWorkspaceTabPreset)
        .filter((preset): preset is AppSettings['workspaceTabs'][number] => Boolean(preset)),
      sshHostKeys: { ...this.cache.sshHostKeys },
      session: cloneSavedSession(this.cache.session),
    };
  }

  set(updates: Partial<AppSettings>): AppSettings {
    if (!isValidSettingsUpdate(updates)) throw new Error('Invalid settings update');
    const previous = this.cache;
    this.cache = {
      ...this.cache,
      ...updates,
      keybindings: updates.keybindings === undefined ? this.cache.keybindings : { ...updates.keybindings },
      snippets: updates.snippets === undefined ? this.cache.snippets : normalizeSnippets(updates.snippets),
      sshProfiles: updates.sshProfiles === undefined
        ? this.cache.sshProfiles
        : updates.sshProfiles.map(({ password, privateKey, ...profile }) => profile.auth === 'password'
          ? { ...profile, ...(password === undefined ? {} : { password }) }
          : { ...profile, ...(privateKey === undefined ? {} : { privateKey }) }),
      workspaceTabs: updates.workspaceTabs === undefined
        ? this.cache.workspaceTabs
        : updates.workspaceTabs.map(cloneWorkspaceTabPreset)
          .filter((preset): preset is AppSettings['workspaceTabs'][number] => Boolean(preset)),
      sshHostKeys: updates.sshHostKeys === undefined ? this.cache.sshHostKeys : { ...updates.sshHostKeys },
      session: updates.session === undefined ? this.cache.session : cloneSavedSession(updates.session),
    };
    if (!this.save(previous.sshProfiles)) {
      this.cache = previous;
      throw new Error('Could not persist settings');
    }
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
      const stored = {
        ...DEFAULT_SETTINGS,
        ...parsed,
        sshProfiles: normalizeStoredSshProfiles(parsed.sshProfiles),
      } as StoredAppSettings;
      this.captureStoredSecrets(stored.sshProfiles);
      return this.deserialize(stored);
    } catch {
      return { ...DEFAULT_SETTINGS, session: { ...EMPTY_SESSION } };
    }
  }

  private save(previousSshProfiles = this.cache.sshProfiles): boolean {
    const tempPath = `${this.filePath}.tmp`;
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const serialized = this.serialize(this.cache, previousSshProfiles);
      fs.writeFileSync(tempPath, JSON.stringify(serialized, null, 2), 'utf-8');
      fs.renameSync(tempPath, this.filePath);
      this.captureStoredSecrets(serialized.sshProfiles);
      return true;
    } catch (err) {
      try { fs.rmSync(tempPath, { force: true }); } catch {}
      console.error('Failed to save settings:', err);
      return false;
    }
  }

  private serialize(
    settings: AppSettings,
    previousSshProfiles: AppSettings['sshProfiles'],
  ): StoredAppSettings {
    const previousProfiles = new Map(previousSshProfiles.map((profile) => [profile.id, profile]));
    return {
      ...settings,
      sshProfiles: settings.sshProfiles.map((profile) => {
        const { password, privateKey, ...publicProfile } = profile;
        const stored: StoredSSHProfile = { ...publicProfile };
        const previous = this.storedSshSecrets.get(profile.id);
        const previousProfile = previousProfiles.get(profile.id);
        const passwordSecret = password
          ? (password === previousProfile?.password && previous?.passwordSecret) || protectSecret(password)
          : undefined;
        const privateKeySecret = privateKey
          ? (privateKey === previousProfile?.privateKey && previous?.privateKeySecret) || protectSecret(privateKey)
          : undefined;
        if (password && !passwordSecret) throw new Error('Could not protect SSH password');
        if (privateKey && !privateKeySecret) throw new Error('Could not protect SSH private key');
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
      snippets: normalizeSnippets(settings.snippets),
      sshHostKeys: isStringRecord(settings.sshHostKeys) ? { ...settings.sshHostKeys } : {},
      sshProfiles: profiles.map((profile) => ({
        id: profile.id,
        host: profile.host,
        port: normalizeStoredSshPort(profile.port),
        username: profile.username,
        auth: profile.auth,
        ...(profile.jumpHostProfileId ? { jumpHostProfileId: profile.jumpHostProfileId } : {}),
        ...(profile.auth === 'password'
          ? { password: profile.password ?? unprotectSecret(profile.passwordSecret) ?? decryptLegacySecret(profile.passwordEncrypted) }
          : { privateKey: profile.privateKey ?? unprotectSecret(profile.privateKeySecret) ?? decryptLegacySecret(profile.privateKeyEncrypted) }),
      })),
      workspaceTabs: (Array.isArray(settings.workspaceTabs) ? settings.workspaceTabs : [])
        .map(cloneWorkspaceTabPreset)
        .filter((preset): preset is AppSettings['workspaceTabs'][number] => Boolean(preset))
        .filter(uniqueIdFilter()),
      session: cloneSavedSession(settings.session),
    };
  }

  private captureStoredSecrets(profiles: StoredSSHProfile[]): void {
    this.storedSshSecrets.clear();
    if (!Array.isArray(profiles)) return;
    for (const profile of profiles) {
      this.storedSshSecrets.set(profile.id, profile.auth === 'password'
        ? { passwordSecret: profile.passwordSecret, passwordEncrypted: profile.passwordEncrypted }
        : { privateKeySecret: profile.privateKeySecret, privateKeyEncrypted: profile.privateKeyEncrypted });
    }
  }
}

function cloneWorkspaceTabPreset(value: unknown): AppSettings['workspaceTabs'][number] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const preset = value as Record<string, unknown>;
  if (
    typeof preset.id !== 'string'
    || typeof preset.name !== 'string'
    || (preset.type !== 'local' && preset.type !== 'ssh')
  ) return undefined;
  const root = cloneSavedPaneNode(preset.root);
  const terminalCount = Number.isFinite(preset.terminalCount)
    ? Math.max(1, Math.min(MAX_SAVED_PANE_LEAVES, Math.floor(Number(preset.terminalCount))))
    : 1;
  return {
    id: preset.id,
    name: preset.name,
    type: preset.type,
    ...(typeof preset.cwd === 'string' ? { cwd: preset.cwd } : {}),
    ...(typeof preset.sshProfileId === 'string' ? { sshProfileId: preset.sshProfileId } : {}),
    ...(root ? { root } : {}),
    terminalCount,
    splitDirection: preset.splitDirection === 'horizontal' ? 'horizontal' : 'vertical',
  };
}

function normalizeStoredSshPort(port: unknown): number {
  return Number.isInteger(port) && Number(port) > 0 && Number(port) <= 65_535 ? Number(port) : 22;
}

function normalizeStoredSshProfiles(value: unknown): StoredSSHProfile[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  const profiles: StoredSSHProfile[] = [];
  for (const candidate of value.slice(0, MAX_SETTINGS_COLLECTION_ITEMS)) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const profile = candidate as Partial<StoredSSHProfile>;
    if (
      typeof profile.id !== 'string' || !profile.id || profile.id.length > 256
      || ids.has(profile.id)
      || typeof profile.host !== 'string' || !profile.host || profile.host.length > 255
      || (profile.auth !== 'password' && profile.auth !== 'key')
    ) continue;
    ids.add(profile.id);
    profiles.push({
      id: profile.id,
      host: profile.host,
      port: normalizeStoredSshPort(profile.port),
      auth: profile.auth,
      ...(typeof profile.username === 'string' && profile.username.length <= 256
        ? { username: profile.username }
        : {}),
      ...(typeof profile.jumpHostProfileId === 'string' && profile.jumpHostProfileId.length <= 256
        ? { jumpHostProfileId: profile.jumpHostProfileId }
        : {}),
      ...(typeof profile.password === 'string' && profile.password.length <= MAX_SSH_SECRET_LENGTH
        ? { password: profile.password }
        : {}),
      ...(typeof profile.privateKey === 'string' && profile.privateKey.length <= MAX_SSH_SECRET_LENGTH
        ? { privateKey: profile.privateKey }
        : {}),
      ...(isStoredSecret(profile.passwordSecret) ? { passwordSecret: profile.passwordSecret } : {}),
      ...(isStoredSecret(profile.privateKeySecret) ? { privateKeySecret: profile.privateKeySecret } : {}),
      ...(isBoundedCiphertext(profile.passwordEncrypted) ? { passwordEncrypted: profile.passwordEncrypted } : {}),
      ...(isBoundedCiphertext(profile.privateKeyEncrypted) ? { privateKeyEncrypted: profile.privateKeyEncrypted } : {}),
    });
  }
  const validIds = new Set(profiles.map(({ id }) => id));
  const validProfiles = profiles.map((profile) => profile.jumpHostProfileId === profile.id || !validIds.has(profile.jumpHostProfileId ?? '')
    ? (({ jumpHostProfileId: _invalid, ...rest }) => rest)(profile)
    : profile);
  const cyclicIds = findCyclicJumpHostProfiles(validProfiles);
  return validProfiles.map((profile) => {
    if (!cyclicIds.has(profile.id)) return profile;
    const sanitized: StoredSSHProfile = { ...profile };
    delete sanitized.jumpHostProfileId;
    return sanitized;
  });
}

function isStoredSecret(value: unknown): value is StoredSecretV1 {
  return Boolean(value)
    && typeof value === 'object'
    && (value as Partial<StoredSecretV1>).version === 1
    && (value as Partial<StoredSecretV1>).scheme === 'electron-safe-storage'
    && isBoundedCiphertext((value as Partial<StoredSecretV1>).ciphertext);
}

function isBoundedCiphertext(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_SSH_SECRET_CIPHERTEXT_LENGTH;
}

function cloneSavedTab(value: unknown): SavedTab | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const tab = value as Partial<SavedTab>;
  const root = cloneSavedPaneNode(tab.root);
  if (
    !root
    || typeof tab.id !== 'string'
    || typeof tab.title !== 'string'
    || tab.title.length > MAX_SAVED_TITLE_LENGTH
    || (tab.type !== 'local' && tab.type !== 'ssh')
  ) return undefined;
  return {
    id: tab.id,
    title: tab.title,
    type: tab.type,
    ...(typeof tab.cwd === 'string' ? { cwd: tab.cwd } : {}),
    ...(typeof tab.sshProfileId === 'string' ? { sshProfileId: tab.sshProfileId } : {}),
    root,
  };
}

function cloneSavedSession(value: unknown): SavedSession {
  const session = value && typeof value === 'object' ? value as Partial<SavedSession> : {};
  const tabs: SavedTab[] = [];
  let terminalCount = 0;
  if (Array.isArray(session.tabs)) {
    for (const value of session.tabs.slice(0, MAX_SAVED_SESSION_TABS)) {
      const tab = cloneSavedTab(value);
      if (!tab) continue;
      const leaves = countSavedPaneLeaves(tab.root, MAX_SAVED_SESSION_TERMINALS - terminalCount);
      if (leaves === null) continue;
      terminalCount += leaves;
      tabs.push(tab);
    }
  }
  return {
    tabs,
    activeTabId: typeof session.activeTabId === 'string' ? session.activeTabId : null,
    sidebarOpen: typeof session.sidebarOpen === 'boolean' ? session.sidebarOpen : EMPTY_SESSION.sidebarOpen,
    tabsOpen: typeof session.tabsOpen === 'boolean' ? session.tabsOpen : EMPTY_SESSION.tabsOpen,
    sidebarSection: session.sidebarSection === 'ssh'
      || session.sidebarSection === 'git'
      || session.sidebarSection === 'settings'
      ? session.sidebarSection
      : 'files',
  };
}

function countSavedPaneLeaves(root: SavedPaneNode, limit: number): number | null {
  const pending: SavedPaneNode[] = [root];
  let leaves = 0;
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (node.type === 'leaf') {
      leaves += 1;
      if (leaves > limit) return null;
    } else {
      pending.push(...node.children);
    }
  }
  return leaves;
}

function isValidRuntimeSession(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const session = value as Partial<SavedSession>;
  if (
    Object.keys(value).some((key) => !SAVED_SESSION_KEYS.has(key))
    || !Array.isArray(session.tabs)
    || session.tabs.length > MAX_SAVED_SESSION_TABS
    || !hasUniqueIds(session.tabs)
    || (session.activeTabId !== null
      && (typeof session.activeTabId !== 'string' || session.activeTabId.length > 256))
    || typeof session.sidebarOpen !== 'boolean'
    || typeof session.tabsOpen !== 'boolean'
    || !['files', 'ssh', 'git', 'settings'].includes(session.sidebarSection as string)
  ) return false;
  let terminalCount = 0;
  for (const value of session.tabs) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const tab = value as Partial<SavedTab>;
    if (
      Object.keys(value).some((key) => !SAVED_TAB_KEYS.has(key))
      || typeof tab.id !== 'string'
      || tab.id.length > 256
      || typeof tab.title !== 'string'
      || tab.title.length > 256
      || (tab.type !== 'local' && tab.type !== 'ssh')
      || (tab.cwd !== undefined
        && (typeof tab.cwd !== 'string' || tab.cwd.length > MAX_WORKSPACE_STRING_LENGTH))
      || (tab.sshProfileId !== undefined
        && (typeof tab.sshProfileId !== 'string' || tab.sshProfileId.length > 256))
    ) return false;
    const leaves = validateRuntimePaneTree(tab.root, MAX_SAVED_SESSION_TERMINALS - terminalCount);
    if (leaves === null) return false;
    terminalCount += leaves;
  }
  return true;
}

function validateRuntimePaneTree(root: unknown, leafLimit: number): number | null {
  const pending = [{ node: root, depth: 0 }];
  let nodes = 0;
  let leaves = 0;
  while (pending.length > 0) {
    const { node, depth } = pending.pop()!;
    if (!node || typeof node !== 'object' || Array.isArray(node) || depth > MAX_SAVED_PANE_DEPTH) return null;
    nodes += 1;
    if (nodes > MAX_SAVED_PANE_NODES) return null;
    const candidate = node as Record<string, unknown>;
    if (candidate.type === 'leaf') {
      if (
        Object.keys(candidate).some((key) => !SAVED_PANE_LEAF_KEYS.has(key))
        ||
        (candidate.title !== undefined
          && (typeof candidate.title !== 'string' || candidate.title.length > 256))
        || (candidate.terminalType !== undefined && candidate.terminalType !== 'local' && candidate.terminalType !== 'ssh')
        || (candidate.cwd !== undefined
          && (typeof candidate.cwd !== 'string' || candidate.cwd.length > MAX_WORKSPACE_STRING_LENGTH))
        || (candidate.sshProfileId !== undefined
          && (typeof candidate.sshProfileId !== 'string' || candidate.sshProfileId.length > 256))
        || (candidate.startupCommands !== undefined
          && !isValidRuntimeStartupCommands(candidate.startupCommands))
        || (candidate.startupShellDialect !== undefined && !isStartupShellDialect(candidate.startupShellDialect))
      ) return null;
      leaves += 1;
      if (leaves > leafLimit || leaves > MAX_SAVED_PANE_LEAVES) return null;
      continue;
    }
    if (
      candidate.type !== 'split'
      || Object.keys(candidate).some((key) => !SAVED_PANE_SPLIT_KEYS.has(key))
      || (candidate.direction !== 'horizontal' && candidate.direction !== 'vertical')
      || !Array.isArray(candidate.children)
      || candidate.children.length === 0
      || candidate.children.length > MAX_SAVED_PANE_NODES - nodes
      || !Array.isArray(candidate.sizes)
      || candidate.sizes.length !== candidate.children.length
      || !candidate.sizes.every((size) => typeof size === 'number' && Number.isFinite(size) && size > 0)
    ) return null;
    for (const child of candidate.children) pending.push({ node: child, depth: depth + 1 });
  }
  return leaves;
}

function cloneSavedPaneNode(node: unknown): SavedPaneNode | undefined {
  const budget = { nodesRemaining: MAX_SAVED_PANE_NODES, leavesRemaining: MAX_SAVED_PANE_LEAVES, exceeded: false };
  const cloned = cloneSavedPaneNodeWithinBudget(node, 0, budget);
  return budget.exceeded ? undefined : cloned;
}

function cloneSavedPaneNodeWithinBudget(
  node: unknown,
  depth: number,
  budget: { nodesRemaining: number; leavesRemaining: number; exceeded: boolean },
): SavedPaneNode | undefined {
  if (depth > MAX_SAVED_PANE_DEPTH || budget.nodesRemaining <= 0) {
    budget.exceeded = true;
    return undefined;
  }
  if (!node || typeof node !== 'object') return undefined;
  budget.nodesRemaining -= 1;
  const candidate = node as Record<string, unknown>;
  if (candidate.type === 'split') {
    const children: SavedPaneNode[] = [];
    for (const child of Array.isArray(candidate.children) ? candidate.children : []) {
      const cloned = cloneSavedPaneNodeWithinBudget(child, depth + 1, budget);
      if (cloned) children.push(cloned);
      if (budget.exceeded) break;
    }
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
  if (budget.leavesRemaining <= 0) {
    budget.exceeded = true;
    return undefined;
  }
  budget.leavesRemaining -= 1;
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
    ...(typeof candidate.title === 'string'
      && candidate.title.length <= MAX_SAVED_TITLE_LENGTH
      && candidate.title
      ? { title: candidate.title }
      : {}),
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
    const decrypted = safeStorage.decryptString(Buffer.from(secret.ciphertext, 'base64'));
    return decrypted.length <= MAX_SSH_SECRET_LENGTH ? decrypted : undefined;
  } catch {
    return undefined;
  }
}

function decryptLegacySecret(secret: string | undefined): string | undefined {
  if (!secret || !safeStorage?.isEncryptionAvailable()) return undefined;
  try {
    const decrypted = safeStorage.decryptString(Buffer.from(secret, 'base64'));
    return decrypted.length <= MAX_SSH_SECRET_LENGTH ? decrypted : undefined;
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

function isBoundedStringRecord(
  value: unknown,
  maxEntries: number,
  maxKeyLength: number,
  maxValueLength: number,
): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.length <= maxEntries && entries.every(([key, entry]) => (
    key.length <= maxKeyLength && typeof entry === 'string' && entry.length <= maxValueLength
  ));
}

function isValidRuntimeStartupCommands(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > MAX_STARTUP_COMMANDS) return false;
  let totalLength = 0;
  return value.every((command) => {
    if (
      typeof command !== 'string'
      || command.length > MAX_STARTUP_COMMAND_LENGTH
      || /[\u0000-\u001f\u007f-\u009f]/.test(command)
    ) return false;
    totalLength += command.trim().length;
    return totalLength <= MAX_STARTUP_COMMAND_TOTAL_LENGTH;
  });
}

function hasUniqueIds(values: readonly unknown[]): boolean {
  const ids = new Set<string>();
  return values.every((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const id = (value as Record<string, unknown>).id;
    if (typeof id !== 'string' || ids.has(id)) return false;
    ids.add(id);
    return true;
  });
}

function uniqueIdFilter(): (value: { id: string }) => boolean {
  const ids = new Set<string>();
  return (value) => {
    if (ids.has(value.id)) return false;
    ids.add(value.id);
    return true;
  };
}

function hasUniqueSnippetIdentities(values: readonly unknown[]): boolean {
  const ids = new Set<string>();
  const names = new Set<string>();
  return values.every((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const snippet = value as Record<string, unknown>;
    if (typeof snippet.id !== 'string' || typeof snippet.name !== 'string') return false;
    const id = snippet.id.trim();
    const name = snippet.name.trim().toLocaleLowerCase();
    if (ids.has(id) || names.has(name)) return false;
    ids.add(id);
    names.add(name);
    return true;
  });
}

function isValidSettingsUpdate(value: unknown): value is Partial<AppSettings> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const allowedKeys = new Set<keyof AppSettings>([
    'theme', 'fontSize', 'fontFamily', 'sidebarSide', 'keybindings', 'snippets',
    'sshProfiles', 'workspaceTabs', 'gitWorktreeBaseDir',
    'gitWorktreeNameTemplate', 'session',
  ]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key as keyof AppSettings))) return false;
  if (Object.values(value).some((entry) => entry === undefined)) return false;
  const updates = value as Partial<AppSettings>;
  return (updates.theme === undefined || ['tokyo-night', 'dracula', 'one-dark', 'solarized-light', 'gruvbox'].includes(updates.theme))
    && (updates.fontSize === undefined
      || (Number.isInteger(updates.fontSize) && updates.fontSize >= 10 && updates.fontSize <= 24))
    && (updates.fontFamily === undefined
      || (typeof updates.fontFamily === 'string' && updates.fontFamily.length <= MAX_WORKSPACE_STRING_LENGTH))
    && (updates.sidebarSide === undefined || updates.sidebarSide === 'left' || updates.sidebarSide === 'right')
    && (updates.keybindings === undefined
      || isBoundedStringRecord(updates.keybindings, MAX_KEYBINDINGS, 256, 256))
    && (updates.snippets === undefined || (Array.isArray(updates.snippets)
      && updates.snippets.length <= MAX_SETTINGS_COLLECTION_ITEMS
      && updates.snippets.every(isValidRuntimeSnippet)
      && hasUniqueSnippetIdentities(updates.snippets)))
    && (updates.sshProfiles === undefined || (Array.isArray(updates.sshProfiles)
      && updates.sshProfiles.length <= MAX_SETTINGS_COLLECTION_ITEMS
      && updates.sshProfiles.every(isValidSshProfile)
      && hasValidJumpHostReferences(updates.sshProfiles)
      && hasUniqueIds(updates.sshProfiles)))
    && (updates.workspaceTabs === undefined || (Array.isArray(updates.workspaceTabs)
      && updates.workspaceTabs.length <= MAX_SAVED_SESSION_TABS
      && updates.workspaceTabs.every(isValidRuntimeWorkspacePreset)
      && hasUniqueIds(updates.workspaceTabs)))

    && (updates.gitWorktreeBaseDir === undefined
      || (typeof updates.gitWorktreeBaseDir === 'string'
        && updates.gitWorktreeBaseDir.length <= MAX_WORKSPACE_STRING_LENGTH))
    && (updates.gitWorktreeNameTemplate === undefined
      || (typeof updates.gitWorktreeNameTemplate === 'string'
        && updates.gitWorktreeNameTemplate.length <= MAX_WORKSPACE_STRING_LENGTH))
    && (updates.session === undefined || isValidRuntimeSession(updates.session));
}

function isValidRuntimeSnippet(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (Object.keys(value).some((key) => !['id', 'name', 'content'].includes(key))) return false;
  return normalizeSnippets([value]).length === 1;
}

function isValidRuntimeWorkspacePreset(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const preset = value as Record<string, unknown>;
  if (
    Object.keys(preset).some((key) => !WORKSPACE_PRESET_KEYS.has(key))
    || typeof preset.id !== 'string' || !preset.id || preset.id.length > 256
    || typeof preset.name !== 'string' || !preset.name.trim() || preset.name.length > 256
    || (preset.type !== 'local' && preset.type !== 'ssh')
    || !Number.isInteger(preset.terminalCount)
    || Number(preset.terminalCount) < 1
    || Number(preset.terminalCount) > MAX_SAVED_PANE_LEAVES
    || (preset.splitDirection !== 'horizontal' && preset.splitDirection !== 'vertical')
    || (preset.cwd !== undefined && (typeof preset.cwd !== 'string' || preset.cwd.length > MAX_WORKSPACE_STRING_LENGTH))
    || (preset.sshProfileId !== undefined
      && (typeof preset.sshProfileId !== 'string' || preset.sshProfileId.length > 256))
  ) return false;
  return preset.root === undefined
    || validateRuntimePaneTree(preset.root, MAX_SAVED_PANE_LEAVES) !== null;
}

function isValidSshProfile(value: unknown): value is AppSettings['sshProfiles'][number] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const profile = value as Partial<AppSettings['sshProfiles'][number]>;
  return !Object.keys(value).some((key) => !SSH_PROFILE_KEYS.has(key))
    && typeof profile.id === 'string' && profile.id.length <= 256
    && typeof profile.host === 'string' && profile.host.length <= 255
    && Number.isInteger(profile.port)
    && Number(profile.port) > 0
    && Number(profile.port) <= 65_535
    && (profile.auth === 'password' || profile.auth === 'key')
    && (profile.username === undefined
      || (typeof profile.username === 'string' && profile.username.length <= 256))
    && (profile.password === undefined
      || (typeof profile.password === 'string' && profile.password.length <= MAX_SSH_SECRET_LENGTH))
    && (profile.privateKey === undefined
      || (typeof profile.privateKey === 'string' && profile.privateKey.length <= MAX_SSH_SECRET_LENGTH))
    && (profile.jumpHostProfileId === undefined
      || (typeof profile.jumpHostProfileId === 'string' && profile.jumpHostProfileId.length <= 256));
}

function findCyclicJumpHostProfiles(profiles: ReadonlyArray<{ id: string; jumpHostProfileId?: string }>): Set<string> {
  const next = new Map(profiles.map(({ id, jumpHostProfileId }) => [id, jumpHostProfileId]));
  const cyclic = new Set<string>();
  for (const { id } of profiles) {
    const path: string[] = [];
    const seen = new Map<string, number>();
    let current: string | undefined = id;
    while (current !== undefined && next.has(current) && !cyclic.has(current)) {
      const start = seen.get(current);
      if (start !== undefined) {
        for (const cycleId of path.slice(start)) cyclic.add(cycleId);
        break;
      }
      seen.set(current, path.length);
      path.push(current);
      current = next.get(current);
    }
  }
  return cyclic;
}

function hasValidJumpHostReferences(profiles: AppSettings['sshProfiles']): boolean {
  const ids = new Set(profiles.map(({ id }) => id));
  return profiles.every(({ id, jumpHostProfileId }) => jumpHostProfileId === undefined
    || (jumpHostProfileId !== id && ids.has(jumpHostProfileId)))
    && findCyclicJumpHostProfiles(profiles).size === 0;
}
