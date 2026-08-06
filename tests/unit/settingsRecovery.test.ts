import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const electronState = vi.hoisted(() => ({ userData: '' }));

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => electronState.userData) },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((value: string) => Buffer.from(`encrypted:${value}`)),
    decryptString: vi.fn((value: Buffer) => value.toString().replace(/^encrypted:/, '')),
  },
}));

describe('SettingsManager recovery', () => {
  beforeEach(() => {
    electronState.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'janet-settings-recovery-'));
  });

  afterEach(() => {
    fs.rmSync(electronState.userData, { recursive: true, force: true });
  });

  it('preserves corrupt current bytes and reports a recoverable prior generation', async () => {
    const settingsPath = path.join(electronState.userData, 'settings.json');
    const previousPath = `${settingsPath}.previous`;
    fs.writeFileSync(settingsPath, JSON.stringify({ theme: 'dracula', fontSize: 16 }), 'utf8');
    const { SettingsManager } = await import('../../src/main/settings');
    const manager = new SettingsManager();

    manager.set({ theme: 'gruvbox' });
    expect(JSON.parse(fs.readFileSync(previousPath, 'utf8'))).toMatchObject({
      theme: 'dracula',
      fontSize: 16,
    });

    const corruptBytes = '{"theme":';
    fs.writeFileSync(settingsPath, corruptBytes, 'utf8');
    const damaged = new SettingsManager();

    expect(() => damaged.get()).toThrow('Could not load settings');
    expect(damaged.getRecoveryState()).toEqual({ previousAvailable: true });
    expect(fs.readFileSync(settingsPath, 'utf8')).toBe(corruptBytes);
  });

  it('restores the validated prior generation over corrupt settings', async () => {
    const settingsPath = path.join(electronState.userData, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ theme: 'dracula', fontSize: 16 }), 'utf8');
    const { SettingsManager } = await import('../../src/main/settings');
    const manager = new SettingsManager();
    manager.set({ theme: 'gruvbox' });
    fs.writeFileSync(settingsPath, '{"theme":', 'utf8');
    const damaged = new SettingsManager();

    expect(damaged.restorePrevious()).toMatchObject({ theme: 'dracula', fontSize: 16 });
    expect(JSON.parse(fs.readFileSync(settingsPath, 'utf8'))).toMatchObject({
      theme: 'dracula',
      fontSize: 16,
    });
    expect(damaged.getRecoveryState()).toEqual({ previousAvailable: false });
    expect(damaged.get()).toMatchObject({ theme: 'dracula', fontSize: 16 });
  });

  it.each([
    ['malformed JSON', '{"fontSize":'],
    ['a JSON scalar', JSON.stringify('not settings')],
    ['a JSON array', JSON.stringify([])],
  ])('does not offer %s as a prior generation', async (_label, previousBytes) => {
    const settingsPath = path.join(electronState.userData, 'settings.json');
    const corruptBytes = '{"theme":';
    fs.writeFileSync(settingsPath, corruptBytes, 'utf8');
    fs.writeFileSync(`${settingsPath}.previous`, previousBytes, 'utf8');
    const { SettingsManager } = await import('../../src/main/settings');
    const damaged = new SettingsManager();

    expect(damaged.getRecoveryState()).toEqual({ previousAvailable: false });
    expect(() => damaged.restorePrevious()).toThrow('No previous settings are available');
    expect(fs.readFileSync(settingsPath, 'utf8')).toBe(corruptBytes);
  });

  it('resets corrupt settings only after an explicit recovery action', async () => {
    const settingsPath = path.join(electronState.userData, 'settings.json');
    const previousPath = `${settingsPath}.previous`;
    const corruptBytes = '{"theme":';
    fs.writeFileSync(settingsPath, corruptBytes, 'utf8');
    fs.writeFileSync(previousPath, JSON.stringify({ theme: 'dracula' }), 'utf8');
    const { SettingsManager } = await import('../../src/main/settings');
    const damaged = new SettingsManager();

    expect(fs.readFileSync(settingsPath, 'utf8')).toBe(corruptBytes);
    expect(damaged.reset()).toMatchObject({ theme: 'tokyo-night', fontSize: 14 });
    expect(JSON.parse(fs.readFileSync(settingsPath, 'utf8'))).toMatchObject({
      theme: 'tokyo-night',
      fontSize: 14,
    });
    expect(fs.existsSync(previousPath)).toBe(false);
    expect(damaged.getRecoveryState()).toEqual({ previousAvailable: false });
    expect(damaged.get()).toMatchObject({ theme: 'tokyo-night', fontSize: 14 });
  });

  it('blocks ordinary saves while corrupt settings await recovery', async () => {
    const settingsPath = path.join(electronState.userData, 'settings.json');
    const corruptBytes = '{"theme":';
    fs.writeFileSync(settingsPath, corruptBytes, 'utf8');
    const { SettingsManager } = await import('../../src/main/settings');
    const damaged = new SettingsManager();

    expect(() => damaged.set({ theme: 'dracula' })).toThrow('Could not persist settings');
    expect(fs.readFileSync(settingsPath, 'utf8')).toBe(corruptBytes);
    expect(damaged.getRecoveryState()).toEqual({ previousAvailable: false });
  });
});
