import { describe, expect, it } from 'vitest';
import {
  compileStartupCommands,
  inferStartupShellDialect,
  isStartupShellDialect,
  MAX_STARTUP_COMMANDS,
  MAX_STARTUP_COMMAND_LENGTH,
  MAX_STARTUP_COMMAND_TOTAL_LENGTH,
  sanitizeStartupCommands,
} from '../../src/shared/startupCommands';

describe('startup command sanitization', () => {
  it('keeps trimmed, non-empty, single-line commands within the size limits', () => {
    const commands = [
      '  hermes doctor  ',
      '',
      '   ',
      ...Array.from({ length: MAX_STARTUP_COMMANDS - 1 }, (_, index) => `echo ${index}`),
    ];

    const sanitized = sanitizeStartupCommands(commands);

    expect(sanitized[0]).toBe('hermes doctor');
    expect(sanitized).toHaveLength(MAX_STARTUP_COMMANDS);
    expect(sanitized.reduce((total, command) => total + command.length, 0))
      .toBeLessThanOrEqual(MAX_STARTUP_COMMAND_TOTAL_LENGTH);
  });

  it('fails the whole sequence closed for overlong commands rather than skipping ahead', () => {
    expect(sanitizeStartupCommands([
      'ok',
      'x'.repeat(MAX_STARTUP_COMMAND_LENGTH + 1),
      'still-ok',
    ])).toEqual([]);
  });

  it('fails the whole sequence closed when it exceeds the aggregate limit', () => {
    const chunk = 'x'.repeat(MAX_STARTUP_COMMAND_LENGTH);
    expect(sanitizeStartupCommands([chunk, chunk, chunk, chunk, 'overflow']))
      .toEqual([]);
  });

  it('fails the whole sequence closed for raw terminal control characters', () => {
    expect(sanitizeStartupCommands([
      'safe command',
      'tab\tcommand',
      'escape\u001bcommand',
      'interrupt\u0003command',
      'delete\u007fcommand',
      'c1\u0085command',
    ])).toEqual([]);
  });

  it('fails the whole sequence closed for non-string rows or too many commands', () => {
    expect(sanitizeStartupCommands(['safe command', 42, 'later command'])).toEqual([]);
    expect(sanitizeStartupCommands(
      Array.from({ length: MAX_STARTUP_COMMANDS + 1 }, (_, index) => `echo ${index}`),
    )).toEqual([]);
  });
});

describe('startup command compilation', () => {
  it('compiles POSIX commands into one stop-on-error expression with safe quoting', () => {
    expect(compileStartupCommands(["printf '%s' ready", 'hermes --tui'], 'posix'))
      .toBe("eval 'printf '\\''%s'\\'' ready' && eval 'hermes --tui'");
  });

  it('uses fish-native conditional chaining', () => {
    expect(compileStartupCommands(['hermes doctor', 'hermes --tui'], 'fish'))
      .toBe("eval 'hermes doctor'; and eval 'hermes --tui'");
  });

  it('uses PowerShell 5-compatible success checks instead of &&', () => {
    const expression = compileStartupCommands(["Write-Output 'ready'", 'hermes --tui'], 'powershell');
    expect(expression).toBe(
      "$__jt_startup_ok = $false; Invoke-Expression ('Write-Output ''ready''' + [Environment]::NewLine + '$__jt_startup_ok = $?'); if ($__jt_startup_ok) { $__jt_startup_ok = $false; Invoke-Expression ('hermes --tui' + [Environment]::NewLine + '$__jt_startup_ok = $?'); if ($__jt_startup_ok) { $null = $true } else { Write-Error '__janet_startup_failed__' -ErrorAction Ignore } } else { Write-Error '__janet_startup_failed__' -ErrorAction Ignore }",
    );
    expect(expression).not.toContain('&&');
  });

  it('doubles typographic PowerShell apostrophes inside the command literal', () => {
    const expression = compileStartupCommands(['Write-Output ‘ready’'], 'powershell');
    expect(expression).toContain("'Write-Output ‘‘ready’’'");
  });

  it('returns an empty expression when no valid commands remain', () => {
    expect(compileStartupCommands(['', 'multi\nline'], 'posix')).toBe('');
  });
});

describe('startup shell dialects', () => {
  it('recognizes only supported values', () => {
    expect(isStartupShellDialect('posix')).toBe(true);
    expect(isStartupShellDialect('fish')).toBe(true);
    expect(isStartupShellDialect('powershell')).toBe(true);
    expect(isStartupShellDialect('cmd')).toBe(false);
    expect(isStartupShellDialect('auto')).toBe(false);
  });

  it('infers a dialect from known local shell executables', () => {
    expect(inferStartupShellDialect('/bin/zsh')).toBe('posix');
    expect(inferStartupShellDialect('/usr/local/bin/fish')).toBe('fish');
    expect(inferStartupShellDialect('C:\\Program Files\\PowerShell\\7\\pwsh.exe')).toBe('powershell');
    expect(inferStartupShellDialect('cmd.exe')).toBeNull();
    expect(inferStartupShellDialect('nu')).toBeNull();
  });
});
