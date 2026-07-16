import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import pty from 'node-pty';
import { buildShellInit, STARTUP_READY_MARKER } from '../../src/main/shell-init';

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
      expect(init.indexOf('& $global:__jt_orig_prompt'))
        .toBeLessThan(init.indexOf('Write-Host -NoNewline $ready'));
    });

    it('restores the prior command status before calling a status-aware prompt', () => {
      const init = buildShellInit('powershell.exe');
      expect(init).toContain('  $__jt_success = $?');
      expect(init).toContain('  $__jt_last_exit_code = $global:LASTEXITCODE');
      expect(init.indexOf('$global:LASTEXITCODE = $__jt_last_exit_code'))
        .toBeLessThan(init.indexOf('$promptText = & $global:__jt_orig_prompt'));
      expect(init.indexOf('if ($__jt_success)'))
        .toBeLessThan(init.indexOf('$promptText = & $global:__jt_orig_prompt'));
      expect(init).toContain("Write-Error '__janet_status__' -ErrorAction Ignore");
    });

    it('emits readiness from finally and falls back when the original prompt throws', () => {
      const init = buildShellInit('powershell.exe');
      expect(init).toContain('} catch {');
      expect(init).toContain("$promptText = 'PS> '");
      expect(init).toContain('} finally {');
      expect(init.indexOf('} finally {'))
        .toBeLessThan(init.indexOf('Write-Host -NoNewline $ready'));
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
      expect(init).toContain('__jt_ready');
      expect(init.indexOf('$PROMPT_COMMAND')).toBeLessThan(init.lastIndexOf('__jt_ready'));
      expect(init).toContain('__jt_orig_prompt_commands=("${PROMPT_COMMAND[@]}")');
      expect(init).toContain('PROMPT_COMMAND=__jt_prompt_command');
    });

    it('uses the canonical printf + file:// pattern', () => {
      const init = buildShellInit('bash');
      expect(init).toContain('file://');
      // The actual OSC 7 escape sequence.
      expect(init).toMatch(/\\033\]7/);
    });

    it.skipIf(process.platform === 'win32')('keeps every array prompt hook before readiness', () => {
      const script = [
        'events=()',
        'first_hook() { events+=(first); }',
        'second_hook() { events+=(second); }',
        'PROMPT_COMMAND=(first_hook second_hook)',
        buildShellInit('bash'),
        '__jt_osc7() { events+=(cwd); }',
        '__jt_ready() { events+=(ready); }',
        'for hook in "${PROMPT_COMMAND[@]}"; do eval "$hook"; done',
        'printf %s "${events[*]}"',
      ].join('\n');

      expect(execFileSync('/bin/bash', ['--noprofile', '--norc', '-c', script], { encoding: 'utf8' }))
        .toBe('cwd first second ready');
    });

    it.skipIf(process.platform === 'win32')('runs every array hook in a real interactive prompt', async () => {
      const initDir = mkdtempSync(join(tmpdir(), 'janet-bash-prompt-'));
      const rcPath = join(initDir, 'bashrc');
      writeFileSync(rcPath, [
        `PROMPT_COMMAND=("printf '<ONE>'" "printf '<TWO>'")`,
        buildShellInit('bash'),
        `PS1='<PROMPT>'`,
      ].join('\n'));

      try {
        const output = await new Promise<string>((resolve, reject) => {
          let received = '';
          let exiting = false;
          const terminal = pty.spawn('/bin/bash', ['--noprofile', '--rcfile', rcPath, '-i'], {
            name: 'xterm-256color', cols: 80, rows: 24, cwd: process.cwd(),
            env: { ...process.env, TERM: 'xterm-256color' },
          });
          const timeout = setTimeout(() => {
            try { terminal.kill(); } catch {}
            reject(new Error(`Interactive Bash prompt timed out: ${JSON.stringify(received)}`));
          }, 5_000);
          terminal.onData((data) => {
            received += data;
            if (!exiting && received.includes(STARTUP_READY_MARKER) && received.includes('<PROMPT>')) {
              exiting = true;
              terminal.write('exit\r');
            }
          });
          terminal.onExit(({ exitCode }) => {
            clearTimeout(timeout);
            if (exitCode === 0) resolve(received);
            else reject(new Error(`Interactive Bash exited ${exitCode}: ${JSON.stringify(received)}`));
          });
        });

        expect(output.indexOf('<ONE>')).toBeGreaterThanOrEqual(0);
        expect(output.indexOf('<TWO>')).toBeGreaterThan(output.indexOf('<ONE>'));
        expect(output.indexOf(STARTUP_READY_MARKER)).toBeGreaterThan(output.indexOf('<TWO>'));
        expect(output.indexOf('<PROMPT>')).toBeGreaterThan(output.indexOf(STARTUP_READY_MARKER));
      } finally {
        rmSync(initDir, { recursive: true, force: true });
      }
    }, 10_000);

    it.skipIf(process.platform === 'win32')('accepts a scalar prompt hook with a trailing separator', () => {
      const script = [
        'events=()',
        'first_hook() { events+=(first); }',
        "PROMPT_COMMAND='first_hook;'",
        buildShellInit('bash'),
        '__jt_osc7() { events+=(cwd); }',
        '__jt_ready() { events+=(ready); }',
        'eval "$PROMPT_COMMAND"',
        'printf %s "${events[*]}"',
      ].join('\n');

      expect(execFileSync('/bin/bash', ['--noprofile', '--norc', '-c', script], { encoding: 'utf8' }))
        .toBe('cwd first ready');
    });

    it('scopes Hermes graphics to direct, non-multiplexed invocations', () => {
      const init = buildShellInit('bash');
      expect(init).toContain('type -t hermes');
      expect(init).toContain('JANET_KITTY_GRAPHICS=1 command hermes');
      expect(init).toContain('JANET_KITTY_GRAPHICS= KITTY_WINDOW_ID= WEZTERM_PANE= ITERM_SESSION_ID= TERM_PROGRAM=JaneT command hermes');
      expect(init).toContain('TMUX');
      expect(init).toContain('STY');
      expect(init).toContain('function hermes {');
      expect(init).not.toContain('hermes() {');
    });
  });

  describe('Zsh', () => {
    it('uses a precmd hook for zsh', () => {
      const init = buildShellInit('zsh');
      expect(init).toContain('precmd_functions');
      expect(init).toContain('precmd_functions+=(__jt_osc7 __jt_ready)');
    });

    it('does not replace an existing Hermes alias or function', () => {
      const init = buildShellInit('zsh');
      expect(init).toContain('! $+aliases[hermes]');
      expect(init).toContain('! $+galiases[hermes]');
      expect(init).toContain('! $+functions[hermes]');
      expect(init).toContain("command 'hermes'");
      expect(init).toContain('function hermes {');
      expect(init).not.toContain('hermes() {');
    });
  });

  describe('Fish', () => {
    it('uses a fish_prompt event handler for fish', () => {
      const init = buildShellInit('fish');
      expect(init).toContain('--on-event fish_prompt');
      expect(init).toContain('functions -c fish_right_prompt __jt_orig_fish_right_prompt');
      expect(init).toContain('__jt_orig_fish_right_prompt $argv');
      expect(init).toContain("printf '\\033]777;janet-ready\\033\\\\' >&2");
    });

    it('uses a function-local exported graphics flag', () => {
      const init = buildShellInit('fish');
      expect(init).toContain("set -lx JANET_KITTY_GRAPHICS 1");
      expect(init).toContain("set -lx JANET_KITTY_GRAPHICS ''");
      expect(init).toContain("set -lx TERM_PROGRAM JaneT");
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
