import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';

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
});
