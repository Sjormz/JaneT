import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

export type ThemeName = 'tokyo-night' | 'dracula' | 'one-dark' | 'solarized-light' | 'gruvbox';

export interface AppSettings {
  theme: ThemeName;
  fontSize: number;
  fontFamily: string;
}

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'tokyo-night',
  fontSize: 14,
  fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace",
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
      return { ...DEFAULT_SETTINGS, ...parsed };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  private save(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.cache, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  }
}
