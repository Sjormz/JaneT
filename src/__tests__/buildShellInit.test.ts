import { describe, it, expect } from 'vitest';
import { buildShellInit } from '../main/terminal';

describe('buildShellInit', () => {
  describe('PowerShell', () => {
    it('returns a non-empty init for powershell.exe', () => {
      const init = buildShellInit('powershell.exe');
      expect(init).toBeTruthy();
    });

    it('returns a non-empty init for pwsh.exe (PowerShell 7+)', () => {
      const init = buildShellInit('pwsh.exe');
      expect(init).toBeTruthy();
    });

    it('handles shell paths with directories', () => {
      const init = buildShellInit('C:\\Program Files\\PowerShell\\7\\pwsh.exe');
      if (process.platform === 'win32') {
        expect(init).toBeTruthy();
        expect(init).toContain('function global:prompt');
      } else {
        // On non-Windows, backslashes aren't path separators so the
        // whole Windows path is treated as the basename and won't match.
        expect(init).toBe('');
      }
    });

    it('saves the original prompt before redefining it', () => {
      const init = buildShellInit('powershell.exe');
      // Must check the existing prompt function exists before overwriting.
      expect(init).toMatch(/Test-Path Function:\\prompt/);
      // Must save the original into a global so we can call it.
      expect(init).toMatch(/\$global:__jt_orig_prompt/);
    });

    it('builds the OSC 7 sequence with [char]27 (ESC) and [char]92 (backslash)', () => {
      const init = buildShellInit('powershell.exe');
      // ESC = char 27
      expect(init).toMatch(/\[char\]27/);
      // The ST terminator is ESC + backslash. We use [char]92 to get
      // a literal backslash without PowerShell-quoting headaches.
      expect(init).toMatch(/\[char\]92/);
    });

    it('references the file:// scheme and the COMPUTERNAME env var', () => {
      const init = buildShellInit('powershell.exe');
      expect(init).toContain("']7;file://'");
      expect(init).toContain('$env:COMPUTERNAME');
    });

    it('converts backslashes to forward slashes for the URL form', () => {
      const init = buildShellInit('powershell.exe');
      // The PS regex `\\` (in PS source) is written as `\\\\` in the JS
      // source. We assert the substring is present.
      expect(init).toContain("'\\\\','/'");
    });

    it('chains to the original prompt at the end of the new prompt', () => {
      const init = buildShellInit('powershell.exe');
      // The new prompt should call the original so the user sees their
      // usual prompt (e.g. PSReadLine indicators).
      expect(init).toMatch(/& \$global:__jt_orig_prompt/);
    });

    it('does NOT contain raw backslash-escape sequences (we use [char]92 instead)', () => {
      // We deliberately avoid emitting the literal "\e" or "\\" into
      // the PowerShell source because they cause quoting issues. The
      // check below makes sure we don't accidentally regress to that.
      const init = buildShellInit('powershell.exe');
      expect(init).not.toMatch(/\\e\]7/);
    });
  });

  describe('Bash', () => {
    it('returns a PROMPT_COMMAND snippet for bash', () => {
      const init = buildShellInit('bash');
      expect(init).toContain('PROMPT_COMMAND');
      expect(init).toContain('printf');
    });

    it('uses the canonical printf + file:// pattern', () => {
      const init = buildShellInit('bash');
      expect(init).toContain('file://');
      // The actual OSC 7 escape sequence.
      expect(init).toMatch(/\\033\]7/);
    });
  });

  describe('Zsh', () => {
    it('uses a precmd hook for zsh', () => {
      const init = buildShellInit('zsh');
      expect(init).toContain('precmd_functions');
    });
  });

  describe('Fish', () => {
    it('uses a fish_prompt event handler for fish', () => {
      const init = buildShellInit('fish');
      expect(init).toContain('--on-event fish_prompt');
    });
  });

  describe('Unknown shells', () => {
    it('returns an empty string for cmd.exe (no scripting facility)', () => {
      expect(buildShellInit('cmd.exe')).toBe('');
    });

    it('returns an empty string for unknown shells', () => {
      expect(buildShellInit('nushell.exe')).toBe('');
    });
  });

  describe('Case-insensitive shell matching', () => {
    it('matches PWSH.EXE (uppercase)', () => {
      expect(buildShellInit('PWSH.EXE')).toBeTruthy();
    });

    it('matches BASH (uppercase)', () => {
      expect(buildShellInit('BASH')).toContain('PROMPT_COMMAND');
    });
  });
});
