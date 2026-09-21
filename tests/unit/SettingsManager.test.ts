import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';

const LEGACY_KEYBINDINGS = {
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
  'previous-command': 'Ctrl+Shift+ArrowUp',
  'next-command': 'Ctrl+Shift+ArrowDown',
  'copy-command': 'Ctrl+Alt+C',
  'copy-command-output': 'Ctrl+Alt+O',
  'rerun-command': 'Ctrl+Alt+R',
};

async function loadKeybindings(
  platformName: 'win32' | 'darwin',
  storedForDefaults: (defaults: Record<string, string>) => Record<string, string>,
): Promise<{ actual: Record<string, string>; defaults: Record<string, string> }> {
  const fsMock = await import('fs');
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { ...platform, value: platformName });
  vi.resetModules();
  try {
    const { SettingsManager } = await import('../../src/main/settings');
    const defaults = new SettingsManager().get().keybindings;
    const storedKeybindings = storedForDefaults(defaults);
    (fsMock.readFileSync as any).mockImplementationOnce(() => JSON.stringify({ keybindings: storedKeybindings }));
    return { actual: new SettingsManager().get().keybindings, defaults };
  } finally {
    Object.defineProperty(process, 'platform', platform);
    vi.resetModules();
  }
}

// Mock electron's app module
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/user-data'),
  },
}));

// Mock fs to prevent real file I/O
vi.mock('fs', () => ({
  default: {
    readFileSync: vi.fn(() => {
      throw Object.assign(new Error('File not found'), { code: 'ENOENT' });
    }),
    writeFileSync: vi.fn(),
    renameSync: vi.fn(),
    openSync: vi.fn(() => 17),
    fsyncSync: vi.fn(),
    closeSync: vi.fn(),
    rmSync: vi.fn(),
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
  },
  readFileSync: vi.fn(() => {
    throw Object.assign(new Error('File not found'), { code: 'ENOENT' });
  }),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  openSync: vi.fn(() => 17),
  fsyncSync: vi.fn(),
  closeSync: vi.fn(),
  rmSync: vi.fn(),
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
}));

describe('SettingsManager', () => {
  it('drops legacy remote settings and panes without running their commands locally', async () => {
    const { SettingsManager } = await import('../../src/main/settings');
    const remoteLeaf = { type: 'leaf', terminalType: 'ssh', sshProfileId: 'old', startupCommands: ['echo remote-only'] };
    const localLeaf = { type: 'leaf', terminalType: 'local', title: 'Local', cwd: 'C:/repo', startupCommands: ['echo local-only'] };
    const mixedRoot = { type: 'split', direction: 'vertical', children: [localLeaf, remoteLeaf, { ...localLeaf, title: 'Last' }], sizes: [2, 3, 4] };
    const localHistory = { id: 'local', command: 'echo local-only', startedAt: 1, durationMs: 2, context: { kind: 'local', cwd: 'C:/repo' } };
    vi.mocked(fs.readFileSync).mockReturnValueOnce(JSON.stringify({
      theme: 'dracula',
      sshProfiles: [{ id: 'old', passwordSecret: 'old-secret' }],
      sshHostKeys: { 'old:22': 'old-key' },
      commandHistory: [localHistory, { ...localHistory, id: 'remote', command: 'echo remote-only', context: { kind: 'ssh', label: 'Old' } }],
      workspaceTabs: [
        { id: 'remote', name: 'Remote', type: 'ssh', root: remoteLeaf },
        { id: 'remote-panes', name: 'Remote panes', type: 'local', root: remoteLeaf },
        { id: 'mixed', name: 'Mixed', type: 'local', root: mixedRoot },
      ],
      session: {
        tabs: [
          { id: 'remote', title: 'Remote', type: 'ssh', root: remoteLeaf },
          { id: 'mixed', title: 'Mixed', type: 'local', root: mixedRoot, selectedPanePath: [1], maximizedPanePath: [2] },
          { id: 'project', title: 'Project', type: 'local', isProject: true, root: { type: 'split', direction: 'vertical', children: [], sizes: [] } },
          { id: 'remote-project', title: 'Keep project', type: 'local', isProject: true, root: remoteLeaf },
        ],
        sidebarSection: 'ssh',
      },
    }));
    const manager = new SettingsManager();
    const settings = manager.get();
    expect(settings.theme).toBe('dracula');
    expect(settings).not.toHaveProperty('sshProfiles');
    expect(settings).not.toHaveProperty('sshHostKeys');
    expect(settings.commandHistory).toEqual([localHistory]);
    expect(settings.workspaceTabs.map((tab) => tab.id)).toEqual(['mixed']);
    expect(settings.session.tabs.map((tab) => tab.id)).toEqual(['mixed', 'project', 'remote-project']);
    expect(settings.session.tabs[2].root).toEqual({ type: 'split', direction: 'vertical', children: [], sizes: [] });
    expect(settings.session.tabs[0].root).toEqual({ ...mixedRoot, children: [localLeaf, { ...localLeaf, title: 'Last' }], sizes: [2, 4] });
    expect(settings.session.tabs[0]).not.toHaveProperty('selectedPanePath');
    expect(settings.session.tabs[0]).not.toHaveProperty('maximizedPanePath');
    expect(settings.session.sidebarSection).toBe('files');
    expect(JSON.stringify(settings)).not.toContain('remote-only');
    manager.set({ fontSize: 15 });
    const writes = vi.mocked(fs.writeFileSync).mock.calls;
    const current = writes.find(([file]) => String(file).endsWith('settings.json.tmp'))!;
    const saved = JSON.parse(String(current[1]));
    expect(saved).not.toHaveProperty('sshProfiles');
    expect(saved).not.toHaveProperty('sshHostKeys');
    expect(saved.session.tabs).toEqual(settings.session.tabs);
    expect(() => manager.set({ sshProfiles: [] })).toThrow();
  });

  it('keeps main directory unset until chosen and persists linked folders', async () => {
    const { SettingsManager } = await import('../../src/main/settings');
    const manager = new SettingsManager();
    expect(manager.get().mainDirectory).toBeNull();
    expect(manager.get().mainDirectorySetupSkipped).toBe(false);
    manager.set({ mainDirectorySetupSkipped: true });
    expect(manager.get().mainDirectorySetupSkipped).toBe(true);
    expect(manager.get().mainDirectory).toBeNull();
    expect(() => manager.set({ mainDirectorySetupSkipped: 'yes' })).toThrow();
    const directory = process.platform === 'win32' ? 'C:\\Projects' : '/projects';
    const folder = { id: 'project', name: 'Project', kind: 'folder' as const, directory };
    manager.set({ mainDirectory: directory, session: { ...manager.get().session, groups: [folder] } });
    expect(manager.get().mainDirectory).toBe(directory);
    expect(manager.get().session.groups).toEqual([folder]);
    expect(() => manager.set({ mainDirectory: '../relative' })).toThrow();
    expect(() => manager.set({ session: { ...manager.get().session, groups: [{ ...folder, directory: '' }] } })).toThrow();
  });
  it('round-trips group membership and collapse state while rejecting invalid groups', async () => {
    const { SettingsManager } = await import('../../src/main/settings');
    const manager = new SettingsManager();
    const session = { ...manager.get().session, groups: [{ id: 'team', name: 'Team', collapsed: true }], tabs: [{
      id: 'work', title: 'Work', groupId: 'team', type: 'local' as const, root: { type: 'leaf' as const },
    }] };
    manager.set({ session });
    expect(manager.get().session).toMatchObject(session);
    const copy = manager.get().session;
    copy.groups![0].name = 'Mutated';
    expect(manager.get().session.groups![0].name).toBe('Team');
    expect(() => manager.set({ session: { ...session, groups: [{ id: 'team', name: '' }] } })).toThrow();
    expect(() => manager.set({ session: { ...session, groups: [...session.groups, ...session.groups] } })).toThrow();
    expect(manager.get().session.groups![0].name).toBe('Team');
  });
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates with default settings when no file exists', async () => {
    const { SettingsManager } = await import('../../src/main/settings');
    const manager = new SettingsManager();
    const settings = manager.get();

    expect(settings.theme).toBe('one-dark');
    expect(settings.fontSize).toBe(14);
    expect(settings.fontFamily).toContain('JetBrains Mono Variable');
    expect(settings.sidebarSide).toBe('right');
    expect(settings.workspaceTabs).toEqual([]);
    expect(settings.notificationsEnabled).toBe(false);
    expect(settings.notificationThresholdSeconds).toBe(10);
    expect(settings.keybindings).toMatchObject({
      'previous-command': 'Ctrl+Shift+ArrowUp',
      'next-command': 'Ctrl+Shift+ArrowDown',
      'copy-command': 'Ctrl+Alt+C',
      'copy-command-output': 'Ctrl+Alt+O',
      'rerun-command': 'Ctrl+Alt+R',
      'move-pane-left': '',
      'move-pane-right': '',
      'move-pane-up': '',
      'move-pane-down': '',
    });
  });

  it('defaults, loads, deep-clones, and round-trips output-free command history', async () => {
    const fsMock = await import('fs');
    const valid = {
      id: 'old', command: 'printf old', startedAt: 1, durationMs: 2, exitCode: 0,
      context: { kind: 'local' as const, cwd: '/repo' },
    };
    (fsMock.readFileSync as any).mockImplementationOnce(() => JSON.stringify({
      theme: 'dracula', commandHistory: [valid, { ...valid, id: 'bad', output: 'secret' }],
    }));
    const { SettingsManager } = await import('../../src/main/settings');
    const manager = new SettingsManager();
    const loaded = manager.get();
    expect(loaded.commandHistory).toEqual([valid]);
    (loaded.commandHistory[0].context as any).cwd = '/mutated';
    expect((manager.get().commandHistory[0].context as any).cwd).toBe('/repo');
    const next = { ...valid, id: 'new', context: { kind: 'local' as const, cwd: '/other' } };
    expect(manager.set({ commandHistory: [next] }).commandHistory).toEqual([next]);
    const saved = JSON.parse((fsMock.writeFileSync as any).mock.calls.at(-1)[1]);
    expect(saved.commandHistory).toEqual([next]);
    expect(JSON.stringify(saved.commandHistory)).not.toContain('output');
  });

  it('rejects malformed, duplicate, and 257-entry live history atomically and rolls cache back on write failure', async () => {
    const fsMock = await import('fs');
    const { SettingsManager } = await import('../../src/main/settings');
    const manager = new SettingsManager();
    const valid = (id: string) => ({ id, command: 'pwd', startedAt: 1, durationMs: 1, context: { kind: 'local' as const, cwd: '/repo' } });
    expect(() => manager.set({ commandHistory: [{ ...valid('bad'), output: 'secret' }] as any })).toThrow('Invalid settings update');
    expect(() => manager.set({ commandHistory: [valid('x'), valid('x')] })).toThrow('Invalid settings update');
    expect(() => manager.set({ commandHistory: Array.from({ length: 257 }, (_, i) => valid(String(i))) })).toThrow('Invalid settings update');
    expect(manager.get().commandHistory).toEqual([]);
    (fsMock.renameSync as any).mockImplementationOnce(() => { throw new Error('disk full'); });
    expect(() => manager.set({ commandHistory: [valid('kept')] })).toThrow('Could not persist settings');
    expect(manager.get().commandHistory).toEqual([]);
  });

  it('round-trips valid notification settings', async () => {
    const { SettingsManager } = await import('../../src/main/settings');
    const manager = new SettingsManager();
    expect(manager.set({ notificationsEnabled: true, notificationThresholdSeconds: 86_400 }))
      .toMatchObject({ notificationsEnabled: true, notificationThresholdSeconds: 86_400 });
  });

  it.each([undefined, null, 0, 1.5, 86_401, '10'])('normalizes a malformed legacy notification threshold: %s', async (value) => {
    const fsMock = await import('fs');
    (fsMock.readFileSync as any).mockImplementationOnce(() => JSON.stringify({
      theme: 'dracula', notificationThresholdSeconds: value,
    }));
    const { SettingsManager } = await import('../../src/main/settings');
    expect(new SettingsManager().get()).toMatchObject({ theme: 'dracula', notificationThresholdSeconds: 10 });
  });

  it.each([0, 1.5, 86_401, '10'])('rejects malformed live notification threshold atomically: %s', async (value) => {
    const fsMock = await import('fs');
    const { SettingsManager } = await import('../../src/main/settings');
    const manager = new SettingsManager();
    expect(() => manager.set({ notificationThresholdSeconds: value } as any)).toThrow(/invalid settings/i);
    expect(manager.get().notificationThresholdSeconds).toBe(10);
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
  });

  it('rolls back both notification settings after persistence failure', async () => {
    const fsMock = await import('fs');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(fsMock.renameSync).mockImplementationOnce(() => { throw new Error('blocked'); });
    const { SettingsManager } = await import('../../src/main/settings');
    const manager = new SettingsManager();
    expect(() => manager.set({ notificationsEnabled: true, notificationThresholdSeconds: 20 })).toThrow();
    expect(manager.get()).toMatchObject({ notificationsEnabled: false, notificationThresholdSeconds: 10 });
  });

  it('round-trips a configured semantic rerun shortcut', async () => {
    const { SettingsManager } = await import('../../src/main/settings');
    const manager = new SettingsManager();
    expect(manager.set({
      keybindings: { ...manager.get().keybindings, 'rerun-command': 'Alt+R' },
    }).keybindings['rerun-command']).toBe('Alt+R');
  });

  it('adds new shortcut defaults when loading older settings without replacing custom bindings', async () => {
    const fsMock = await import('fs');
    (fsMock.readFileSync as any).mockImplementationOnce(() => JSON.stringify({
      theme: 'dracula',
      keybindings: { 'close-tab': 'Alt+X' },
    }));
    const { SettingsManager } = await import('../../src/main/settings');
    const settings = new SettingsManager().get();
    const primaryModifier = process.platform === 'darwin' ? 'Meta' : 'Ctrl';

    expect(settings.keybindings).toMatchObject({
      'close-tab': 'Alt+X',
      'settings-toggle': `${primaryModifier}+,`,
      'font-reset': `${primaryModifier}+0`,
      'history-toggle': '',
    });
  });

  it.each(['win32', 'darwin'] as const)(
    'migrates the exact raw legacy %s keybindings to current defaults',
    async (platformName) => {
      const { actual, defaults } = await loadKeybindings(platformName, () => LEGACY_KEYBINDINGS);
      expect(actual).toEqual(defaults);
    },
  );

  it.each(['win32', 'darwin'] as const)(
    'migrates the exact JaneT-expanded legacy %s keybindings to current defaults',
    async (platformName) => {
      const { actual, defaults } = await loadKeybindings(platformName, (current) => ({
        ...current,
        ...LEGACY_KEYBINDINGS,
      }));
      expect(actual).toEqual(defaults);
    },
  );

  it.each(['win32', 'darwin'] as const)(
    'migrates the previous JaneT-expanded legacy %s keybindings after new actions are added',
    async (platformName) => {
      const { actual, defaults } = await loadKeybindings(platformName, (current) => ({
        ...Object.fromEntries(Object.entries(current).filter(([action]) => !action.startsWith('move-pane-'))),
        ...LEGACY_KEYBINDINGS,
      }));
      expect(actual).toEqual(defaults);
    },
  );

  it.each([
    ['sparse', { 'close-tab': 'Alt+X' }],
    ['changed complete', { ...LEGACY_KEYBINDINGS, 'palette-toggle': 'Alt+K' }],
    ['explicit empty', { ...LEGACY_KEYBINDINGS, 'palette-toggle': '' }],
    ['extra key', { ...LEGACY_KEYBINDINGS, custom: 'Alt+J' }],
    ['missing key', Object.fromEntries(
      Object.entries(LEGACY_KEYBINDINGS).filter(([key]) => key !== 'rerun-command'),
    )],
  ])('preserves the user-owned %s keybinding map', async (_name, keybindings) => {
    for (const platformName of ['win32', 'darwin'] as const) {
      const { actual, defaults } = await loadKeybindings(platformName, () => keybindings);
      expect(actual).toEqual({ ...defaults, ...keybindings });
    }
  });

  it('rejects shortcut updates whose merged map exceeds the entry limit', async () => {
    const fsMock = await import('fs');
    const { SettingsManager } = await import('../../src/main/settings');
    const manager = new SettingsManager();
    const initialKeybindings = manager.get().keybindings;
    const keybindings = Object.fromEntries(
      Array.from({ length: 64 }, (_, index) => [`custom-${index}`, `Alt+${index}`]),
    );

    expect(() => manager.set({ keybindings })).toThrow('Invalid settings update');
    expect(manager.get().keybindings).toEqual(initialKeybindings);
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
  });

  it('ignores stored shortcut overrides whose merged map exceeds the entry limit', async () => {
    const fsMock = await import('fs');
    const keybindings = Object.fromEntries(
      Array.from({ length: 64 }, (_, index) => [`custom-${index}`, `Alt+${index}`]),
    );
    (fsMock.readFileSync as any).mockImplementationOnce(() => JSON.stringify({
      theme: 'dracula',
      keybindings,
    }));
    const { SettingsManager } = await import('../../src/main/settings');
    const settings = new SettingsManager().get();
    const primaryModifier = process.platform === 'darwin' ? 'Meta' : 'Ctrl';

    expect(settings.theme).toBe('dracula');
    expect(Object.keys(settings.keybindings).length).toBeLessThanOrEqual(64);
    expect(settings.keybindings).toHaveProperty('settings-toggle', `${primaryModifier}+,`);
    expect(settings.keybindings).not.toHaveProperty('custom-0');
  });

  it('updates settings partially', async () => {
    const { SettingsManager } = await import('../../src/main/settings');
    const manager = new SettingsManager();

    const updated = manager.set({ fontSize: 18 });
    expect(updated.fontSize).toBe(18);
    expect(updated.theme).toBe('one-dark'); // unchanged
  });

  it('returns a copy, not a reference', async () => {
    const { SettingsManager } = await import('../../src/main/settings');
    const manager = new SettingsManager();

    const settings = manager.get();
    const originalFontSize = settings.fontSize;
    (settings as any).fontSize = 99;

    const settingsAgain = manager.get();
    expect(settingsAgain.fontSize).toBe(originalFontSize);
  });

  it('allows setting theme to valid values', async () => {
    const { SettingsManager } = await import('../../src/main/settings');
    const manager = new SettingsManager();

    const updated = manager.set({ theme: 'dracula' });
    expect(updated.theme).toBe('dracula');
  });

  it('loads from file when settings.json exists', async () => {
    // Override the readFileSync mock for this test
    const fsMock = await import('fs');
    (fsMock.readFileSync as any).mockImplementationOnce(() => JSON.stringify({
      theme: 'dracula',
      fontSize: 16,
    }));

    const { SettingsManager } = await import('../../src/main/settings');
    const manager = new SettingsManager();
    const settings = manager.get();

    expect(settings.theme).toBe('dracula');
    expect(settings.fontSize).toBe(16);
  });

  it('drops malformed and duplicate legacy keyed entries without resetting unrelated settings', async () => {
    const fsMock = await import('fs');
    (fsMock.readFileSync as any).mockImplementationOnce(() => JSON.stringify({
      theme: 'dracula',
      fontSize: 18,
      workspaceTabs: [
        { id: 'workspace', name: 'First', type: 'local', terminalCount: 1, splitDirection: 'vertical' },
        { id: 'workspace', name: 'Duplicate', type: 'local', terminalCount: 1, splitDirection: 'vertical' },
        null,
      ],
    }));

    const { SettingsManager } = await import('../../src/main/settings');
    const settings = new SettingsManager().get();

    expect(settings.theme).toBe('dracula');
    expect(settings.fontSize).toBe(18);
    expect(settings.workspaceTabs).toEqual([
      expect.objectContaining({ id: 'workspace', name: 'First' }),
    ]);
  });

  it('persists settings to file on set', async () => {
    const { SettingsManager } = await import('../../src/main/settings');
    const manager = new SettingsManager();

    manager.set({ fontSize: 20, theme: 'gruvbox' });

    const fsMock = await import('fs');
    expect(fsMock.writeFileSync).toHaveBeenCalledWith(
      expect.stringMatching(/settings\.json\.tmp$/),
      expect.any(Buffer),
      { flush: true },
    );
    expect((fsMock.writeFileSync as any).mock.calls.at(-1)[1].toString('utf8'))
      .toContain('"fontSize": 20');
    expect(fsMock.renameSync).toHaveBeenCalledWith(
      expect.stringMatching(/settings\.json\.tmp$/),
      expect.stringMatching(/settings\.json$/),
    );
  });

  it('syncs the containing directory after replacement where supported', async () => {
    const fsMock = await import('fs');
    const platform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { ...platform, value: 'linux' });
    try {
      const { SettingsManager } = await import('../../src/main/settings');
      new SettingsManager().set({ fontSize: 20 });

      expect(fsMock.openSync).toHaveBeenCalledWith(expect.stringMatching(/user-data$/), 'r');
      expect(fsMock.fsyncSync).toHaveBeenCalledWith(17);
      expect(fsMock.closeSync).toHaveBeenCalledWith(17);
      expect(vi.mocked(fsMock.renameSync).mock.invocationCallOrder[0])
        .toBeLessThan(vi.mocked(fsMock.openSync).mock.invocationCallOrder[0]);
    } finally {
      Object.defineProperty(process, 'platform', platform!);
    }
  });

  it('keeps the committed cache when directory sync cannot confirm durability', async () => {
    const fsMock = await import('fs');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const platform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { ...platform, value: 'linux' });
    vi.mocked(fsMock.fsyncSync).mockImplementationOnce(() => { throw new Error('sync unavailable'); });
    try {
      const { SettingsManager } = await import('../../src/main/settings');
      const manager = new SettingsManager();

      expect(manager.set({ fontSize: 20 }).fontSize).toBe(20);
      expect(manager.get().fontSize).toBe(20);
      expect(error).toHaveBeenCalledWith(
        'Settings were saved, but crash durability could not be confirmed:', expect.any(Error),
      );
    } finally {
      Object.defineProperty(process, 'platform', platform!);
    }
  });

  it('skips unsupported directory syncing on Windows', async () => {
    const fsMock = await import('fs');
    const platform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
    try {
      const { SettingsManager } = await import('../../src/main/settings');
      expect(new SettingsManager().set({ fontSize: 20 }).fontSize).toBe(20);
      expect(fsMock.openSync).not.toHaveBeenCalled();
      expect(fsMock.fsyncSync).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(process, 'platform', platform!);
    }
  });

  it.each([
    ['null SSH profiles', { sshProfiles: null }],
    ['object workspace tabs', { workspaceTabs: {} }],
    ['null keybindings', { keybindings: null }],
    ['undefined theme', { theme: undefined }],
    ['undefined font size', { fontSize: undefined }],
    ['undefined sidebar side', { sidebarSide: undefined }],
    ['unknown field', { unexpected: true }],
  ])('rejects malformed runtime updates without mutating or writing: %s', async (_label, updates) => {
    const fsMock = await import('fs');
    const { SettingsManager } = await import('../../src/main/settings');
    const manager = new SettingsManager();

    expect(() => manager.set(updates as any)).toThrow(/invalid settings/i);
    expect(manager.get()).toMatchObject({
      workspaceTabs: [], keybindings: expect.any(Object),
    });
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
  });

  it.each([
    ['snippet', { snippets: [null] }],
    ['workspace preset', { workspaceTabs: [null] }],
  ])('rejects a malformed live %s collection without erasing saved entries', async (_label, update) => {
    const fsMock = await import('fs');
    const { SettingsManager } = await import('../../src/main/settings');
    const manager = new SettingsManager();
    manager.set({
      snippets: [{ id: 'deploy', name: 'Deploy', content: 'npm run deploy' }],
      workspaceTabs: [{
        id: 'workspace', name: 'Workspace', type: 'local', terminalCount: 1, splitDirection: 'vertical',
      }],
    });
    const before = manager.get();
    vi.mocked(fsMock.writeFileSync).mockClear();

    expect(() => manager.set(update as any)).toThrow(/invalid settings/i);
    expect(manager.get().snippets).toEqual(before.snippets);
    expect(manager.get().workspaceTabs).toEqual(before.workspaceTabs);
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
  });

  it('rejects unknown nested workspace fields before retaining caller-owned data', async () => {
    const fsMock = await import('fs');
    const { SettingsManager } = await import('../../src/main/settings');
    const manager = new SettingsManager();
    const extra = { nested: ['caller-owned'] };

    expect(() => manager.set({
      workspaceTabs: [{
        id: 'workspace', name: 'Workspace', type: 'local', terminalCount: 1,
        splitDirection: 'vertical', extra,
      } as any],
    })).toThrow(/invalid settings/i);
    extra.nested[0] = 'mutated';

    expect(manager.get().workspaceTabs).toEqual([]);
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
  });

  it.each([
    ['snippet ids', {
      snippets: [
        { id: 'duplicate', name: 'First', content: 'echo first' },
        { id: 'duplicate', name: 'Second', content: 'echo second' },
      ],
    }],
    ['snippet names', {
      snippets: [
        { id: 'first', name: 'Deploy', content: 'echo first' },
        { id: 'second', name: ' deploy ', content: 'echo second' },
      ],
    }],
    ['SSH profile ids', {
      sshProfiles: [
        { id: 'duplicate', host: 'first.example.com', port: 22, auth: 'password' },
        { id: 'duplicate', host: 'second.example.com', port: 22, auth: 'password' },
      ],
    }],
    ['workspace preset ids', {
      workspaceTabs: [
        { id: 'duplicate', name: 'First', type: 'local', terminalCount: 1, splitDirection: 'vertical' },
        { id: 'duplicate', name: 'Second', type: 'local', terminalCount: 1, splitDirection: 'vertical' },
      ],
    }],
    ['session tab ids', {
      session: {
        tabs: [
          { id: 'duplicate', title: 'First', type: 'local', root: { type: 'leaf' } },
          { id: 'duplicate', title: 'Second', type: 'local', root: { type: 'leaf' } },
        ],
        activeTabId: 'duplicate', sidebarOpen: true, tabsOpen: true, sidebarSection: 'files',
      },
    }],
  ])('rejects duplicate live collection identities before mutation or I/O: %s', async (_label, update) => {
    const fsMock = await import('fs');
    const { SettingsManager } = await import('../../src/main/settings');
    const manager = new SettingsManager();
    const before = manager.get();

    expect(() => manager.set(update as any)).toThrow(/invalid settings/i);
    expect(manager.get()).toEqual(before);
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
  });

  it.each([
    ['renderer-supplied SSH trust', { sshHostKeys: { 'attacker.example.com:22': 'SHA256:forged' } }],
    ['unknown session field', {
      session: {
        tabs: [], activeTabId: null, sidebarOpen: true, tabsOpen: true,
        sidebarSection: 'files', extra: true,
      },
    }],
    ['unknown saved-tab field', {
      session: {
        tabs: [{
          id: 'tab', title: 'Tab', type: 'local', root: { type: 'leaf' }, extra: true,
        }],
        activeTabId: 'tab', sidebarOpen: true, tabsOpen: true, sidebarSection: 'files',
      },
    }],
  ])('rejects renderer-owned trust and unknown session fields: %s', async (_label, update) => {
    const fsMock = await import('fs');
    const { SettingsManager } = await import('../../src/main/settings');
    const manager = new SettingsManager();

    expect(() => manager.set(update as any)).toThrow(/invalid settings/i);
    expect(manager.get().session.tabs).toEqual([]);
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
  });

  it.each([
    ['too many snippets', {
      snippets: new Array(257).fill(null).map((_, index) => ({
        id: `snippet-${index}`, name: `Snippet ${index}`, content: 'echo ok',
      })),
    }],
    ['too many SSH profiles', {
      sshProfiles: new Array(257).fill(null).map((_, index) => ({
        id: `profile-${index}`, host: `host-${index}.example.com`, port: 22, auth: 'password',
      })),
    }],
    ['too many workspace presets', {
      workspaceTabs: new Array(65).fill(null).map((_, index) => ({
        id: `preset-${index}`, name: `Preset ${index}`, type: 'local',
        terminalCount: 1, splitDirection: 'vertical',
      })),
    }],
    ['too many keybindings', {
      keybindings: Object.fromEntries(new Array(65).fill(null).map((_, index) => [`action-${index}`, 'Ctrl+K'])),
    }],
    ['out-of-range font size', { fontSize: 1_000 }],
    ['oversized settings string', { gitWorktreeBaseDir: 'x'.repeat(8_193) }],
    ['oversized pane startup command', {
      workspaceTabs: [{
        id: 'startup', name: 'Startup', type: 'local', terminalCount: 1,
        splitDirection: 'vertical', root: {
          type: 'leaf', terminalType: 'local', startupCommands: ['x'.repeat(4_097)],
        },
      }],
    }],
    ['unknown SSH profile field', {
      sshProfiles: [{
        id: 'profile', host: 'example.com', port: 22, auth: 'password', extra: { callerOwned: true },
      }],
    }],
  ])('rejects bounded live settings before mutation or I/O: %s', async (_label, update) => {
    const fsMock = await import('fs');
    const { SettingsManager } = await import('../../src/main/settings');
    const manager = new SettingsManager();
    const before = manager.get();

    expect(() => manager.set(update as any)).toThrow(/invalid settings/i);
    expect(manager.get()).toEqual(before);
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
  });

  it('keeps the existing settings file when atomic replacement fails', async () => {
    const fsMock = await import('fs');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(fsMock.renameSync).mockImplementationOnce(() => {
      throw new Error('replacement blocked');
    });
    const { SettingsManager } = await import('../../src/main/settings');
    const manager = new SettingsManager();

    expect(() => manager.set({ fontSize: 20 })).toThrow(/persist settings/i);

    expect(fsMock.writeFileSync).toHaveBeenCalledWith(
      expect.stringMatching(/settings\.json\.tmp$/), expect.any(Buffer), { flush: true },
    );
    expect(fsMock.writeFileSync).not.toHaveBeenCalledWith(
      expect.stringMatching(/settings\.json$/), expect.anything(), expect.anything(),
    );
    expect(fsMock.rmSync).toHaveBeenCalledWith(
      expect.stringMatching(/settings\.json\.tmp$/), { force: true },
    );
    expect(manager.get().fontSize).toBe(14);
    expect(error).toHaveBeenCalled();
  });

  it('rolls back nested settings after persistence failure and saves normally after recovery', async () => {
    const fsMock = await import('fs');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { SettingsManager } = await import('../../src/main/settings');
    const manager = new SettingsManager();
    manager.set({
      snippets: [{ id: 'one', name: 'Original', content: 'echo original' }],
    });
    vi.mocked(fsMock.writeFileSync).mockImplementationOnce(() => {
      throw new Error('disk full');
    });

    expect(() => manager.set({
      fontSize: 20,
      snippets: [{ id: 'one', name: 'Mutated', content: 'echo mutated' }],
      session: {
        tabs: [{
          id: 'mutated-tab', title: 'Mutated', type: 'local', root: { type: 'leaf' },
        }],
        activeTabId: 'mutated-tab', sidebarOpen: false, tabsOpen: false, sidebarSection: 'git',
      },
    })).toThrow(/persist settings/i);
    expect(manager.get().fontSize).toBe(14);
    expect(manager.get().snippets[0]).toEqual({ id: 'one', name: 'Original', content: 'echo original' });
    expect(manager.get().session.tabs).toEqual([]);
    expect(error).toHaveBeenCalled();

    expect(manager.set({ fontSize: 16 }).fontSize).toBe(16);
    const saved = JSON.parse((fsMock.writeFileSync as any).mock.calls.at(-1)[1] as string);
    expect(saved.snippets[0]).toEqual({ id: 'one', name: 'Original', content: 'echo original' });
    expect(JSON.stringify(saved)).not.toContain('echo mutated');
  });

  it('preserves a saved session across reload', async () => {
    const fsMock = await import('fs');
    const { SettingsManager } = await import('../../src/main/settings');
    const manager = new SettingsManager();

    manager.set({
      session: {
        tabs: [
          {
            id: 'tab-1',
            title: 'JaneT - fixes',
            type: 'local',
            cwd: 'C:/repo',
            selectedPanePath: [1],
            maximizedPanePath: [1],
            root: { type: 'split', direction: 'vertical', sizes: [1, 1], children: [{ type: 'leaf', title: 'Dev server' }, { type: 'leaf', title: 'Tests' }] },
          },
          {
            id: 'tab-2',
            title: 'Tools',
            type: 'local',
            root: { type: 'leaf', title: 'shell' },
          },
        ],
        activeTabId: 'tab-2',
        sidebarOpen: false,
        tabsOpen: true,
        sidebarSection: 'git',
      },
    });

    const savedJson = (fsMock.writeFileSync as any).mock.calls.at(-1)[1] as string;
    (fsMock.readFileSync as any).mockImplementationOnce(() => savedJson);

    const loadedManager = new SettingsManager();
    const loaded = loadedManager.get();
    expect(loaded.session.tabs).toHaveLength(2);
    expect(loaded.session.activeTabId).toBe('tab-2');
    expect(loaded.session.sidebarOpen).toBe(false);
    expect(loaded.session.sidebarSection).toBe('git');
    expect(loaded.session.tabs[0].cwd).toBe('C:/repo');
    expect(loaded.session.tabs[0]).toMatchObject({
      title: 'JaneT - fixes',
      selectedPanePath: [1],
      maximizedPanePath: [1],
      root: { children: [{ title: 'Dev server' }, { title: 'Tests' }] },
    });

    loaded.keybindings['new-tab'] = 'Ctrl+Alt+M';
    loaded.session.tabs[0].title = 'mutated';
    loaded.session.tabs[0].selectedPanePath![0] = 0;
    loaded.session.tabs[0].maximizedPanePath![0] = 0;
    if (loaded.session.tabs[0].root.type === 'split') {
      loaded.session.tabs[0].root.sizes[0] = 99;
    }
    const isolated = loadedManager.get();
    expect(isolated.keybindings['new-tab']).not.toBe('Ctrl+Alt+M');
    expect(isolated.session.tabs[0].title).toBe('JaneT - fixes');
    expect(isolated.session.tabs[0].selectedPanePath).toEqual([1]);
    expect(isolated.session.tabs[0].maximizedPanePath).toEqual([1]);
    expect(isolated.session.tabs[0].root).toMatchObject({ sizes: [1, 1] });
  });

  it('rejects a runtime pane path that does not resolve to a saved leaf', async () => {
    const fsMock = await import('fs');
    const { SettingsManager } = await import('../../src/main/settings');
    const manager = new SettingsManager();

    expect(() => manager.set({
      session: {
        tabs: [{
          id: 'tab', title: 'Tab', type: 'local', selectedPanePath: [1],
          root: { type: 'leaf' },
        }],
        activeTabId: 'tab', sidebarOpen: true, tabsOpen: true, sidebarSection: 'files',
      },
    })).toThrow(/invalid settings/i);
    expect(() => manager.set({
      session: {
        tabs: [{
          id: 'tab', title: 'Tab', type: 'local', selectedPanePath: new Array(1),
          root: {
            type: 'split', direction: 'vertical', sizes: [1, 1],
            children: [{ type: 'leaf' }, { type: 'leaf' }],
          },
        }],
        activeTabId: 'tab', sidebarOpen: true, tabsOpen: true, sidebarSection: 'files',
      },
    })).toThrow(/invalid settings/i);
    expect(manager.get().session.tabs).toEqual([]);
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
  });

  it('bounds saved tab and pane names while loading settings from disk', async () => {
    const fsMock = await import('fs');
    (fsMock.readFileSync as any).mockImplementationOnce(() => JSON.stringify({
      session: {
        tabs: [
          { id: 'good', title: 'Good', type: 'local', root: { type: 'leaf', title: 'x'.repeat(257) } },
          { id: 'bad', title: 'x'.repeat(257), type: 'local', root: { type: 'leaf', title: 'Tests' } },
        ],
        activeTabId: 'good', sidebarOpen: true, tabsOpen: true, sidebarSection: 'files',
      },
    }));

    const { SettingsManager } = await import('../../src/main/settings');
    const loaded = new SettingsManager().get();
    expect(loaded.session.tabs).toHaveLength(1);
    expect(loaded.session.tabs[0]).toMatchObject({ id: 'good', root: { type: 'leaf' } });
    expect(loaded.session.tabs[0].root).not.toHaveProperty('title');
  });

  it('round-trips per-pane startup commands and isolates returned settings', async () => {
    const fsMock = await import('fs');
    const { SettingsManager } = await import('../../src/main/settings');
    const manager = new SettingsManager();

    manager.set({
      workspaceTabs: [{
        id: 'workspace-automation',
        name: 'Automated workspace',
        type: 'local',
        terminalCount: 1,
        splitDirection: 'vertical',
        root: {
          type: 'leaf',
          terminalType: 'local',
          startupCommands: ['hermes doctor', 'hermes --tui'],
          startupShellDialect: 'fish',
        },
      }],
    });

    const savedJson = (fsMock.writeFileSync as any).mock.calls.at(-1)[1] as string;
    (fsMock.readFileSync as any).mockImplementationOnce(() => savedJson);
    const loaded = new SettingsManager();
    const settings = loaded.get();
    const leaf = settings.workspaceTabs[0].root;
    expect(leaf).toMatchObject({
      startupCommands: ['hermes doctor', 'hermes --tui'],
      startupShellDialect: 'fish',
    });

    if (leaf?.type === 'leaf' && leaf.startupCommands) leaf.startupCommands[0] = 'mutated';
    expect(loaded.get().workspaceTabs[0].root).toMatchObject({
      startupCommands: ['hermes doctor', 'hermes --tui'],
    });
  });

  it('drops deeply nested pane trees before main-process cloning can exhaust resources', async () => {
    let root: unknown = { type: 'leaf' };
    for (let index = 0; index < 100; index += 1) {
      root = { type: 'split', direction: 'vertical', sizes: [1], children: [root] };
    }
    const fsMock = await import('fs');
    (fsMock.readFileSync as any).mockImplementationOnce(() => JSON.stringify({
      theme: 'dracula',
      workspaceTabs: [{
        id: 'deep-preset', name: 'Deep', type: 'local', terminalCount: 1,
        splitDirection: 'vertical', root,
      }],
      session: {
        tabs: [{ id: 'deep-tab', title: 'Deep', type: 'local', root }],
      },
    }));

    const { SettingsManager } = await import('../../src/main/settings');
    const settings = new SettingsManager().get();
    expect(settings.theme).toBe('dracula');
    expect(settings.workspaceTabs[0]).not.toHaveProperty('root');
    expect(settings.session.tabs).toEqual([]);
  });

  it('keeps the earliest whole tabs when a loaded session exceeds the shared terminal budget', async () => {
    const split = (leaves: number) => ({
      type: 'split', direction: 'vertical', sizes: new Array(leaves).fill(1 / leaves),
      children: new Array(leaves).fill(null).map(() => ({ type: 'leaf' })),
    });
    const fsMock = await import('fs');
    (fsMock.readFileSync as any).mockImplementationOnce(() => JSON.stringify({
      theme: 'dracula',
      session: {
        tabs: [
          { id: 'first', title: 'First', type: 'local', root: split(40) },
          { id: 'second', title: 'Second', type: 'local', root: split(25) },
        ],
      },
    }));

    const { SettingsManager } = await import('../../src/main/settings');
    const settings = new SettingsManager().get();
    expect(settings.theme).toBe('dracula');
    expect(settings.session.tabs.map((tab) => tab.id)).toEqual(['first']);
  });

  it('rejects runtime sessions that exceed the shared terminal budget without writing', async () => {
    const fsMock = await import('fs');
    const { SettingsManager } = await import('../../src/main/settings');
    const manager = new SettingsManager();
    const tabs = new Array(65).fill(null).map((_, index) => ({
      id: `tab-${index}`, title: `Tab ${index}`, type: 'local' as const, root: { type: 'leaf' as const },
    }));

    expect(() => manager.set({
      session: {
        tabs, activeTabId: tabs[0].id, sidebarOpen: true, tabsOpen: true, sidebarSection: 'files',
      },
    })).toThrow(/invalid settings/i);
    expect(manager.get().session.tabs).toEqual([]);
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
  });

  it('rejects malformed runtime session trees instead of repairing them', async () => {
    const fsMock = await import('fs');
    const { SettingsManager } = await import('../../src/main/settings');
    const manager = new SettingsManager();

    expect(() => manager.set({
      session: {
        tabs: [{
          id: 'malformed', title: 'Malformed', type: 'local',
          root: {
            type: 'split', direction: 'vertical', sizes: [1, 1],
            children: [null, { type: 'leaf' }],
          } as any,
        }],
        activeTabId: 'malformed', sidebarOpen: true, tabsOpen: true, sidebarSection: 'files',
      },
    })).toThrow(/invalid settings/i);
    expect(manager.get().session.tabs).toEqual([]);
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
  });

  it('keeps valid settings when a preset split contains malformed children', async () => {
    const fsMock = await import('fs');
    (fsMock.readFileSync as any).mockImplementationOnce(() => JSON.stringify({
      theme: 'dracula',
      workspaceTabs: [{
        id: 'partially-valid', name: 'Partially valid', type: 'local', terminalCount: 2,
        splitDirection: 'vertical',
        root: {
          type: 'split', direction: 'vertical', sizes: [1, 1],
          children: [null, { type: 'leaf', terminalType: 'local', startupCommands: ['npm install'] }],
        },
      }],
    }));

    const { SettingsManager } = await import('../../src/main/settings');
    const loaded = new SettingsManager().get();
    expect(loaded.theme).toBe('dracula');
    expect(loaded.workspaceTabs[0].root).toEqual({
      type: 'split',
      direction: 'vertical',
      sizes: [1],
      children: [{
        type: 'leaf',
        terminalType: 'local',
        startupCommands: ['npm install'],
      }],
    });
  });

  it('falls back to an empty session when settings.json is missing it (back-compat)', async () => {
    const fsMock = await import('fs');
    (fsMock.readFileSync as any).mockImplementationOnce(() => JSON.stringify({
      theme: 'dracula',
      fontSize: 16,
      // No `session` key — simulates a settings.json written by an older build.
    }));

    const { SettingsManager } = await import('../../src/main/settings');
    const loaded = new SettingsManager().get();
    expect(loaded.session.tabs).toEqual([]);
    expect(loaded.session.activeTabId).toBeNull();
    expect(loaded.session.sidebarOpen).toBe(true);
    expect(loaded.session.tabsOpen).toBe(true);
    expect(loaded.session.sidebarSection).toBe('files');
  });

  it('loads validated flat snippets and drops malformed or duplicate saved entries', async () => {
    const fsMock = await import('fs');
    (fsMock.readFileSync as any).mockImplementationOnce(() => JSON.stringify({
      snippets: [
        { id: 'deploy', name: ' Deploy ', content: 'npm run deploy' },
        { id: 'duplicate', name: 'deploy', content: 'duplicate' },
        { id: 'broken', name: 'Broken' },
      ],
    }));

    const { SettingsManager } = await import('../../src/main/settings');
    expect(new SettingsManager().get().snippets).toEqual([
      { id: 'deploy', name: 'Deploy', content: 'npm run deploy' },
    ]);
  });

  it('normalizes valid snippets before persisting settings updates', async () => {
    const { SettingsManager } = await import('../../src/main/settings');
    const manager = new SettingsManager();

    const saved = manager.set({
      snippets: [
        { id: 'deploy', name: ' Deploy ', content: 'npm run deploy' },
      ] as any,
    });

    expect(saved.snippets).toEqual([
      { id: 'deploy', name: 'Deploy', content: 'npm run deploy' },
    ]);
  });
});
