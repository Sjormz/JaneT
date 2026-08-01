import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import { safeStorage } from 'electron';

// Mock electron's app module
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/user-data'),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((value: string) => Buffer.from(`encrypted:${value}`)),
    decryptString: vi.fn((value: Buffer) => value.toString().replace(/^encrypted:/, '')),
  },
}));

// Mock fs to prevent real file I/O
vi.mock('fs', () => ({
  default: {
    readFileSync: vi.fn(() => {
      throw new Error('File not found');
    }),
    writeFileSync: vi.fn(),
    renameSync: vi.fn(),
    rmSync: vi.fn(),
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
  },
  readFileSync: vi.fn(() => {
    throw new Error('File not found');
  }),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  rmSync: vi.fn(),
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
}));

describe('SettingsManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
  });

  it('creates with default settings when no file exists', async () => {
    const { SettingsManager } = await import('../../src/main/settings');
    const manager = new SettingsManager();
    const settings = manager.get();

    expect(settings.theme).toBe('tokyo-night');
    expect(settings.fontSize).toBe(14);
    expect(settings.fontFamily).toContain('JetBrains Mono Variable');
    expect(settings.sidebarSide).toBe('right');
    expect(settings.sshProfiles).toEqual([]);
    expect(settings.workspaceTabs).toEqual([]);
  });

  it('updates settings partially', async () => {
    const { SettingsManager } = await import('../../src/main/settings');
    const manager = new SettingsManager();

    const updated = manager.set({ fontSize: 18 });
    expect(updated.fontSize).toBe(18);
    expect(updated.theme).toBe('tokyo-night'); // unchanged
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

  it('discards inactive SSH credentials from legacy settings', async () => {
    const fsMock = await import('fs');
    const passwordSecret = {
      version: 1,
      scheme: 'electron-safe-storage',
      ciphertext: Buffer.from('encrypted:password').toString('base64'),
    };
    const privateKeySecret = {
      version: 1,
      scheme: 'electron-safe-storage',
      ciphertext: Buffer.from('encrypted:private-key').toString('base64'),
    };
    (fsMock.readFileSync as any).mockImplementationOnce(() => JSON.stringify({
      sshProfiles: [
        {
          id: 'password-profile', host: 'password.example.com', port: 22, auth: 'password',
          passwordSecret, privateKeySecret,
        },
        {
          id: 'key-profile', host: 'key.example.com', port: 22, auth: 'key',
          passwordSecret, privateKeySecret,
        },
      ],
    }));

    const { SettingsManager } = await import('../../src/main/settings');
    const manager = new SettingsManager();
    const [passwordProfile, keyProfile] = manager.get().sshProfiles;
    expect(passwordProfile).toMatchObject({ password: 'password' });
    expect(passwordProfile).not.toHaveProperty('privateKey');
    expect(keyProfile).toMatchObject({ privateKey: 'private-key' });
    expect(keyProfile).not.toHaveProperty('password');
    expect(safeStorage.decryptString).toHaveBeenCalledTimes(2);

    manager.set({ fontSize: 16 });
    const saved = JSON.parse((fsMock.writeFileSync as any).mock.calls.at(-1)[1] as string);
    expect(saved.sshProfiles[0]).toMatchObject({ passwordSecret });
    expect(saved.sshProfiles[0].privateKeySecret).toBeUndefined();
    expect(saved.sshProfiles[1]).toMatchObject({ privateKeySecret });
    expect(saved.sshProfiles[1].passwordSecret).toBeUndefined();
  });

  it('normalizes missing and malformed legacy SSH ports during settings load', async () => {
    const fsMock = await import('fs');
    (fsMock.readFileSync as any).mockImplementationOnce(() => JSON.stringify({
      sshProfiles: [
        { id: 'missing', host: 'missing.example.com', auth: 'password' },
        { id: 'oversized', host: 'oversized.example.com', port: 65_536, auth: 'key' },
      ],
    }));

    const { SettingsManager } = await import('../../src/main/settings');
    expect(new SettingsManager().get().sshProfiles.map((profile) => profile.port)).toEqual([22, 22]);
  });

  it('retains only a valid jump-host profile reference without copying credentials', async () => {
    const fsMock = await import('fs');
    (fsMock.readFileSync as any).mockImplementationOnce(() => JSON.stringify({
      sshProfiles: [
        { id: 'jump', host: 'bastion.example', port: 22, auth: 'key' },
        { id: 'target', host: 'target.internal', port: 22, auth: 'password', jumpHostProfileId: 'jump' },
        { id: 'bad', host: 'bad.internal', port: 22, auth: 'password', jumpHostProfileId: 42 },
      ],
    }));
    const { SettingsManager } = await import('../../src/main/settings');
    const settings = new SettingsManager().get();
    expect(settings.sshProfiles[1]).toMatchObject({ id: 'target', jumpHostProfileId: 'jump' });
    expect(settings.sshProfiles[2]).not.toHaveProperty('jumpHostProfileId');
  });

  it('drops malformed and duplicate legacy keyed entries without resetting unrelated settings', async () => {
    const fsMock = await import('fs');
    (fsMock.readFileSync as any).mockImplementationOnce(() => JSON.stringify({
      theme: 'dracula',
      fontSize: 18,
      sshProfiles: [
        null,
        { id: 'valid', host: 'first.example.com', port: 22, auth: 'password' },
        { id: 'valid', host: 'duplicate.example.com', port: 22, auth: 'password' },
        { id: 'wrong-auth', host: 'invalid.example.com', port: 22, auth: 'agent' },
        {
          id: 'oversized-secret',
          host: 'secret.example.com',
          port: 22,
          auth: 'password',
          passwordSecret: {
            version: 1,
            scheme: 'electron-safe-storage',
            ciphertext: 'x'.repeat(512 * 1024 + 1),
          },
          passwordEncrypted: 'x'.repeat(512 * 1024 + 1),
        },
      ],
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
    expect(settings.sshProfiles).toEqual([
      expect.objectContaining({ id: 'valid', host: 'first.example.com', port: 22, auth: 'password' }),
      expect.not.objectContaining({ password: expect.any(String) }),
    ]);
    expect(settings.sshProfiles).toHaveLength(2);
    expect(settings.sshProfiles[1]).toEqual(expect.objectContaining({
      id: 'oversized-secret',
      host: 'secret.example.com',
      password: undefined,
    }));
    expect(safeStorage.decryptString).not.toHaveBeenCalled();
    expect(settings.workspaceTabs).toEqual([
      expect.objectContaining({ id: 'workspace', name: 'First' }),
    ]);
  });

  it('drops a decrypted legacy credential above the live secret ceiling', async () => {
    const fsMock = await import('fs');
    const ciphertext = Buffer.from(`encrypted:${'x'.repeat(100_001)}`).toString('base64');
    (fsMock.readFileSync as any).mockImplementationOnce(() => JSON.stringify({
      sshProfiles: [{
        id: 'oversized-decrypted-secret',
        host: 'secret.example.com',
        port: 22,
        auth: 'password',
        passwordSecret: { version: 1, scheme: 'electron-safe-storage', ciphertext },
      }],
    }));

    const { SettingsManager } = await import('../../src/main/settings');
    const [profile] = new SettingsManager().get().sshProfiles;

    expect(safeStorage.decryptString).toHaveBeenCalledOnce();
    expect(profile).toEqual(expect.objectContaining({
      id: 'oversized-decrypted-secret',
      password: undefined,
    }));
  });

  it('persists settings to file on set', async () => {
    const { SettingsManager } = await import('../../src/main/settings');
    const manager = new SettingsManager();

    manager.set({ fontSize: 20, theme: 'gruvbox' });

    const fsMock = await import('fs');
    expect(fsMock.writeFileSync).toHaveBeenCalledWith(
      expect.stringMatching(/settings\.json\.tmp$/),
      expect.stringContaining('"fontSize": 20'),
      'utf-8',
    );
    expect(fsMock.renameSync).toHaveBeenCalledWith(
      expect.stringMatching(/settings\.json\.tmp$/),
      expect.stringMatching(/settings\.json$/),
    );
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
      sshProfiles: [], workspaceTabs: [], keybindings: expect.any(Object),
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
    expect(manager.getSshHostKey('attacker.example.com', 22)).toBeUndefined();
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
      expect.stringMatching(/settings\.json\.tmp$/), expect.any(String), 'utf-8',
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
      sshProfiles: [{
        id: 'alice@example.com:22:password', host: 'example.com', port: 22,
        username: 'alice', auth: 'password', password: 'original-secret',
      }],
    });
    vi.mocked(fsMock.writeFileSync).mockImplementationOnce(() => {
      throw new Error('disk full');
    });

    expect(() => manager.set({
      fontSize: 20,
      sshProfiles: [{
        id: 'alice@example.com:22:password', host: 'example.com', port: 22,
        username: 'mutated', auth: 'password', password: 'replacement-secret',
      }],
      session: {
        tabs: [{
          id: 'mutated-tab', title: 'Mutated', type: 'local', root: { type: 'leaf' },
        }],
        activeTabId: 'mutated-tab', sidebarOpen: false, tabsOpen: false, sidebarSection: 'git',
      },
    })).toThrow(/persist settings/i);
    expect(manager.get().fontSize).toBe(14);
    expect(manager.get().sshProfiles[0]).toMatchObject({ username: 'alice', password: 'original-secret' });
    expect(manager.get().session.tabs).toEqual([]);
    expect(error).toHaveBeenCalled();

    expect(manager.set({ fontSize: 16 }).fontSize).toBe(16);
    const saved = JSON.parse((fsMock.writeFileSync as any).mock.calls.at(-1)[1] as string);
    expect(saved.sshProfiles[0].passwordSecret).toBeTruthy();
    expect(JSON.stringify(saved)).not.toContain('replacement-secret');
  });

  it('encrypts saved SSH credentials on disk and decrypts them when loading', async () => {
    const fsMock = await import('fs');
    const { SettingsManager } = await import('../../src/main/settings');
    const manager = new SettingsManager();

    manager.set({
      sshProfiles: [{
        id: 'pckpr@box.local:22:password',
        host: 'box.local',
        port: 22,
        username: 'pckpr',
        auth: 'password',
        password: 'secret',
      }],
    });

    const savedJson = (fsMock.writeFileSync as any).mock.calls.at(-1)[1] as string;
    expect(savedJson).not.toContain('"password": "secret"');
    expect(savedJson).toContain('"passwordSecret"');
    expect(savedJson).toContain('"version": 1');
    expect(savedJson).toContain('"scheme": "electron-safe-storage"');

    (fsMock.readFileSync as any).mockImplementationOnce(() => savedJson);
    const loaded = new SettingsManager().get();
    expect(loaded.sshProfiles[0].password).toBe('secret');
  });

  it('reuses encrypted SSH credentials when saving unrelated settings', async () => {
    const fsMock = await import('fs');
    const { SettingsManager } = await import('../../src/main/settings');
    const manager = new SettingsManager();
    manager.set({
      sshProfiles: [{
        id: 'pckpr@box.local:22:password', host: 'box.local', port: 22,
        username: 'pckpr', auth: 'password', password: 'secret',
      }],
    });
    const original = JSON.parse((fsMock.writeFileSync as any).mock.calls.at(-1)[1] as string);
    vi.mocked(safeStorage.encryptString).mockClear();

    manager.set({ fontSize: 16 });

    const rewritten = JSON.parse((fsMock.writeFileSync as any).mock.calls.at(-1)[1] as string);
    expect(safeStorage.encryptString).not.toHaveBeenCalled();
    expect(rewritten.sshProfiles[0].passwordSecret).toEqual(original.sshProfiles[0].passwordSecret);
  });

  it('reuses an unchanged encrypted credential when editing profile metadata', async () => {
    const fsMock = await import('fs');
    const { SettingsManager } = await import('../../src/main/settings');
    const manager = new SettingsManager();
    manager.set({
      sshProfiles: [{
        id: 'pckpr@box.local:22:password', host: 'box.local', port: 22,
        username: 'pckpr', auth: 'password', password: 'secret',
      }],
    });
    const original = JSON.parse((fsMock.writeFileSync as any).mock.calls.at(-1)[1] as string);
    vi.mocked(safeStorage.encryptString).mockClear();
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);

    const updated = manager.set({
      sshProfiles: manager.get().sshProfiles.map((profile) => ({
        ...profile,
        username: 'renamed-pckpr',
      })),
    });

    const rewritten = JSON.parse((fsMock.writeFileSync as any).mock.calls.at(-1)[1] as string);
    expect(updated.sshProfiles[0].username).toBe('renamed-pckpr');
    expect(safeStorage.encryptString).not.toHaveBeenCalled();
    expect(rewritten.sshProfiles[0].passwordSecret).toEqual(original.sshProfiles[0].passwordSecret);
  });

  it('discards the inactive credential when changing SSH authentication', async () => {
    const fsMock = await import('fs');
    const { SettingsManager } = await import('../../src/main/settings');
    const manager = new SettingsManager();
    manager.set({
      sshProfiles: [
        {
          id: 'password-profile', host: 'password.local', port: 22,
          username: 'alice', auth: 'password', password: 'old-password',
        },
        {
          id: 'key-profile', host: 'key.local', port: 22,
          username: 'bob', auth: 'key', privateKey: 'old-key',
        },
      ],
    });

    const updated = manager.set({
      sshProfiles: manager.get().sshProfiles.map((profile) => profile.auth === 'password'
        ? { ...profile, auth: 'key' as const, privateKey: 'new-key' }
        : { ...profile, auth: 'password' as const, password: 'new-password' }),
    });
    const saved = JSON.parse((fsMock.writeFileSync as any).mock.calls.at(-1)[1] as string);

    expect(updated.sshProfiles[0]).not.toHaveProperty('password');
    expect(updated.sshProfiles[1]).not.toHaveProperty('privateKey');
    expect(saved.sshProfiles[0]).toHaveProperty('privateKeySecret');
    expect(saved.sshProfiles[0]).not.toHaveProperty('passwordSecret');
    expect(saved.sshProfiles[1]).toHaveProperty('passwordSecret');
    expect(saved.sshProfiles[1]).not.toHaveProperty('privateKeySecret');
  });

  it('rejects a new SSH credential when safeStorage is unavailable', async () => {
    const fsMock = await import('fs');
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { SettingsManager } = await import('../../src/main/settings');
    const manager = new SettingsManager();

    expect(() => manager.set({
      sshProfiles: [{
        id: 'alice@box.local:22:password',
        host: 'box.local',
        port: 22,
        username: 'alice',
        auth: 'password',
        password: 'must-not-hit-disk',
      }],
    })).toThrow(/persist settings/i);

    expect(manager.get().sshProfiles).toEqual([]);
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
    expect(fsMock.renameSync).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalled();
    error.mockRestore();
    warning.mockRestore();
  });

  it('preserves an opaque encrypted credential during profile edits if safeStorage is temporarily unavailable', async () => {
    const fsMock = await import('fs');
    const { SettingsManager } = await import('../../src/main/settings');
    const first = new SettingsManager();
    first.set({
      sshProfiles: [{
        id: 'alice@box.local:22:password',
        host: 'box.local',
        port: 22,
        username: 'alice',
        auth: 'password',
        password: 'secret',
      }],
    });
    const encryptedJson = (fsMock.writeFileSync as any).mock.calls.at(-1)[1] as string;
    const encryptedSecret = JSON.parse(encryptedJson).sshProfiles[0].passwordSecret;

    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);
    (fsMock.readFileSync as any).mockImplementationOnce(() => encryptedJson);
    const second = new SettingsManager();
    expect(second.get().sshProfiles[0].password).toBeUndefined();
    second.set({
      sshProfiles: second.get().sshProfiles.map((profile) => ({
        ...profile,
        username: 'renamed-alice',
      })),
    });

    const rewritten = JSON.parse((fsMock.writeFileSync as any).mock.calls.at(-1)[1] as string);
    expect(rewritten.sshProfiles[0].username).toBe('renamed-alice');
    expect(rewritten.sshProfiles[0].passwordSecret).toEqual(encryptedSecret);
  });

  it('persists, safely migrates, and rejects unexpected replacement of SSH host keys', async () => {
    const fsMock = await import('fs');
    const { SettingsManager } = await import('../../src/main/settings');
    const manager = new SettingsManager();

    manager.rememberSshHostKey('Box.Local', 22, 'sha256:abc123');
    expect(manager.getSshHostKey('box.local', 22)).toBe('sha256:abc123');
    expect(() => manager.migrateSshHostKey(
      'box.local', 22, 'sha256:not-the-stored-key', 'SHA256:standard',
    )).toThrow(/host key changed/i);

    manager.migrateSshHostKey('box.local', 22, 'sha256:abc123', 'SHA256:standard');
    expect(manager.getSshHostKey('box.local', 22)).toBe('SHA256:standard');
    expect(() => manager.rememberSshHostKey('box.local', 22, 'SHA256:different')).toThrow(/host key changed/i);

    const saved = JSON.parse((fsMock.writeFileSync as any).mock.calls.at(-1)[1] as string);
    expect(saved.sshHostKeys['box.local:22']).toBe('SHA256:standard');
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
            root: { type: 'split', direction: 'vertical', sizes: [1, 1], children: [{ type: 'leaf', title: 'Dev server' }, { type: 'leaf', title: 'Tests' }] },
          },
          {
            id: 'tab-2',
            title: 'ssh box',
            type: 'ssh',
            sshProfileId: 'pckpr@box.local:22:password',
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
      root: { children: [{ title: 'Dev server' }, { title: 'Tests' }] },
    });
    expect(loaded.session.tabs[1].sshProfileId).toBe('pckpr@box.local:22:password');

    loaded.keybindings['new-tab'] = 'Ctrl+Alt+M';
    loaded.session.tabs[0].title = 'mutated';
    if (loaded.session.tabs[0].root.type === 'split') {
      loaded.session.tabs[0].root.sizes[0] = 99;
    }
    const isolated = loadedManager.get();
    expect(isolated.keybindings['new-tab']).not.toBe('Ctrl+Alt+M');
    expect(isolated.session.tabs[0].title).toBe('JaneT - fixes');
    expect(isolated.session.tabs[0].root).toMatchObject({ sizes: [1, 1] });
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
          terminalType: 'ssh',
          sshProfileId: 'dev@box:22:password',
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

  it('defaults legacy SSH startup commands to POSIX syntax on load', async () => {
    const fsMock = await import('fs');
    (fsMock.readFileSync as any).mockImplementationOnce(() => JSON.stringify({
      workspaceTabs: [{
        id: 'legacy-ssh', name: 'Legacy SSH', type: 'local', terminalCount: 1,
        splitDirection: 'vertical',
        root: { type: 'leaf', terminalType: 'ssh', startupCommands: ['git pull'] },
      }],
    }));

    const { SettingsManager } = await import('../../src/main/settings');
    expect(new SettingsManager().get().workspaceTabs[0].root).toMatchObject({
      startupCommands: ['git pull'],
      startupShellDialect: 'posix',
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
