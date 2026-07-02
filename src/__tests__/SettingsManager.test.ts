import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';

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
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
  },
  readFileSync: vi.fn(() => {
    throw new Error('File not found');
  }),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
}));

describe('SettingsManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates with default settings when no file exists', async () => {
    const { SettingsManager } = await import('../main/settings');
    const manager = new SettingsManager();
    const settings = manager.get();

    expect(settings.theme).toBe('tokyo-night');
    expect(settings.fontSize).toBe(14);
    expect(settings.fontFamily).toContain('Cascadia Code');
    expect(settings.sidebarSide).toBe('left');
    expect(settings.sshProfiles).toEqual([]);
    expect(settings.workspaceTabs).toEqual([]);
  });

  it('updates settings partially', async () => {
    const { SettingsManager } = await import('../main/settings');
    const manager = new SettingsManager();

    const updated = manager.set({ fontSize: 18 });
    expect(updated.fontSize).toBe(18);
    expect(updated.theme).toBe('tokyo-night'); // unchanged
  });

  it('returns a copy, not a reference', async () => {
    const { SettingsManager } = await import('../main/settings');
    const manager = new SettingsManager();

    const settings = manager.get();
    const originalFontSize = settings.fontSize;
    (settings as any).fontSize = 99;

    const settingsAgain = manager.get();
    expect(settingsAgain.fontSize).toBe(originalFontSize);
  });

  it('allows setting theme to valid values', async () => {
    const { SettingsManager } = await import('../main/settings');
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

    const { SettingsManager } = await import('../main/settings');
    const manager = new SettingsManager();
    const settings = manager.get();

    expect(settings.theme).toBe('dracula');
    expect(settings.fontSize).toBe(16);
  });

  it('persists settings to file on set', async () => {
    const { SettingsManager } = await import('../main/settings');
    const manager = new SettingsManager();

    manager.set({ fontSize: 20, theme: 'gruvbox' });

    const fsMock = await import('fs');
    expect(fsMock.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('settings.json'),
      expect.stringContaining('"fontSize": 20'),
      'utf-8',
    );
  });

  it('encrypts saved SSH credentials on disk and decrypts them when loading', async () => {
    const fsMock = await import('fs');
    const { SettingsManager } = await import('../main/settings');
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
    expect(savedJson).toContain('"passwordEncrypted"');

    (fsMock.readFileSync as any).mockImplementationOnce(() => savedJson);
    const loaded = new SettingsManager().get();
    expect(loaded.sshProfiles[0].password).toBe('secret');
  });

  it('preserves a saved session across reload', async () => {
    const fsMock = await import('fs');
    const { SettingsManager } = await import('../main/settings');
    const manager = new SettingsManager();

    manager.set({
      session: {
        tabs: [
          {
            id: 'tab-1',
            title: 'main',
            type: 'local',
            cwd: 'C:/repo',
            root: { type: 'split', direction: 'vertical', sizes: [1, 1], children: [{ type: 'leaf' }, { type: 'leaf' }] },
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

    const loaded = new SettingsManager().get();
    expect(loaded.session.tabs).toHaveLength(2);
    expect(loaded.session.activeTabId).toBe('tab-2');
    expect(loaded.session.sidebarOpen).toBe(false);
    expect(loaded.session.sidebarSection).toBe('git');
    expect(loaded.session.tabs[0].cwd).toBe('C:/repo');
    expect(loaded.session.tabs[1].sshProfileId).toBe('pckpr@box.local:22:password');
  });

  it('falls back to an empty session when settings.json is missing it (back-compat)', async () => {
    const fsMock = await import('fs');
    (fsMock.readFileSync as any).mockImplementationOnce(() => JSON.stringify({
      theme: 'dracula',
      fontSize: 16,
      // No `session` key — simulates a settings.json written by an older build.
    }));

    const { SettingsManager } = await import('../main/settings');
    const loaded = new SettingsManager().get();
    expect(loaded.session.tabs).toEqual([]);
    expect(loaded.session.activeTabId).toBeNull();
    expect(loaded.session.sidebarOpen).toBe(true);
    expect(loaded.session.tabsOpen).toBe(true);
    expect(loaded.session.sidebarSection).toBe('files');
  });
});
