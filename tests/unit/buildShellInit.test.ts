import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import pty from 'node-pty';
import { buildShellInit, STARTUP_READY_MARKER } from '../../src/main/shell-init';

const OSC_A = '\x1b]133;A\x1b\\';
const OSC_B = '\x1b]133;B\x1b\\';
const OSC_C = '\x1b]133;C\x1b\\';
const oscD = (status: number) => `\x1b]133;D;${status}\x1b\\`;

function markerCount(value: string, marker: string): number {
  return value.split(marker).length - 1;
}

function promptSegment(output: string, promptIndex: number): string {
  return output.split(OSC_B)[promptIndex] ?? '';
}

function stripOsc133(output: string): string {
  return output.replace(/\x1b\]133;[^\x07\x1b]*(?:\x07|\x1b\\)/g, '');
}

function runPromptSequence(
  executable: string,
  args: string[],
  commands: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = '';
    let nextCommand = 0;
    const terminal = pty.spawn(executable, args, {
      name: 'xterm-256color', cols: 100, rows: 30, cwd: process.cwd(),
      env: { ...env, TERM: 'xterm-256color' },
    });
    const timeout = setTimeout(() => {
      try { terminal.kill(); } catch {}
      reject(new Error(`Interactive shell timed out: ${JSON.stringify(output)}`));
    }, 15_000);
    terminal.onData((data) => {
      output += data;
      if (nextCommand < commands.length && markerCount(output, OSC_B) > nextCommand) {
        terminal.write(commands[nextCommand++] + String.fromCharCode(13));
      }
    });
    terminal.onExit(({ exitCode }) => {
      clearTimeout(timeout);
      if (exitCode === 0) resolve(output);
      else reject(new Error(`Interactive shell exited ${exitCode}: ${JSON.stringify(output)}`));
    });
  });
}

describe('buildShellInit', () => {
  describe('PowerShell', () => {
    const powershell = join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe',
    );

    it('wraps accepted nonblank lines with honest OSC 133 command lifecycle markers', () => {
      const init = buildShellInit('powershell.exe');
      expect(init).toContain('OriginalPSConsoleHostReadLine');
      expect(init).toContain('function global:PSConsoleHostReadLine');
      expect(init).toContain("']133;C'");
      expect(init).toContain("']133;D;'");
      expect(init).toContain("']133;A'");
      expect(init).toContain("']133;B'");
      expect(init).toContain('[string]::IsNullOrWhiteSpace');
    });
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
      expect(init).toMatch(/\$global:__jt_state.OriginalPrompt/);
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
      expect(init).toMatch(/& \$global:__jt_state.OriginalPrompt/);
      expect(init.indexOf('& $global:__jt_state.OriginalPrompt'))
        .toBeLessThan(init.indexOf('Write-Host -NoNewline $ready'));
    });

    it('restores the prior command status before calling a status-aware prompt', () => {
      const init = buildShellInit('powershell.exe');
      expect(init).toContain('  $__jt_success = $?');
      expect(init).toContain('  $__jt_last_exit_code = $global:LASTEXITCODE');
      expect(init.indexOf('$global:LASTEXITCODE = $__jt_last_exit_code'))
        .toBeLessThan(init.indexOf('$promptText = & $global:__jt_state.OriginalPrompt'));
      expect(init.indexOf('if ($__jt_success)'))
        .toBeLessThan(init.indexOf('$promptText = & $global:__jt_state.OriginalPrompt'));
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

    it.skipIf(!existsSync(powershell))('emits honest lifecycles in Windows PowerShell 5.1', async () => {
      const init = [
        "function global:prompt { '<PROMPT:' + $? + ':' + $global:LASTEXITCODE + '>' }",
        buildShellInit('powershell.exe'),
        buildShellInit('powershell.exe'),
      ].join('\n');
      const output = await runPromptSequence(
        powershell,
        ['-NoLogo', '-NoProfile', '-NoExit', '-Command', init],
        ['', 'cmd /c exit 7', 'cmd /c exit 7 | Out-Null', 'Get-Item Z:\\definitely-missing -ErrorAction SilentlyContinue | cmd /c exit 0', 'Write-Output $(cmd /c exit 7) | Get-Item Z:\\definitely-missing -ErrorAction SilentlyContinue', 'cmd /c exit 7; Get-Item Z:\\definitely-missing -ErrorAction SilentlyContinue', 'Get-Item Z:\\definitely-missing -ErrorAction SilentlyContinue', '$null = 1', 'exit'],
      );

      const startup = promptSegment(output, 0);
      const blank = promptSegment(output, 1);
      const nativeFailure = promptSegment(output, 2);
      const pipedNativeFailure = promptSegment(output, 3);
      const failedCmdletPipeline = promptSegment(output, 4);
      const nestedNativeFailure = promptSegment(output, 5);
      const sameLineCmdletFailure = promptSegment(output, 6);
      const cmdletFailure = promptSegment(output, 7);
      const success = promptSegment(output, 8);
      expect(startup.indexOf(OSC_A)).toBeLessThan(startup.indexOf('<PROMPT:True:'));
      expect(startup).not.toContain(OSC_C);
      expect(startup).not.toContain(']133;D;');
      expect(blank).not.toContain(OSC_C);
      expect(blank).not.toContain(']133;D;');
      expect(markerCount(nativeFailure, OSC_C)).toBe(1);
      expect(nativeFailure).toContain(oscD(7));
      expect(nativeFailure).toContain('<PROMPT:False:7>');
      expect(markerCount(pipedNativeFailure, OSC_C)).toBe(1);
      expect(pipedNativeFailure).toContain(oscD(7));
      expect(pipedNativeFailure).toContain('<PROMPT:False:7>');
      expect(markerCount(failedCmdletPipeline, OSC_C)).toBe(1);
      expect(failedCmdletPipeline).toContain(oscD(1));
      expect(failedCmdletPipeline).not.toContain(oscD(0));
      expect(failedCmdletPipeline).toContain('<PROMPT:False:0>');
      expect(markerCount(nestedNativeFailure, OSC_C)).toBe(1);
      expect(nestedNativeFailure).toContain(oscD(1));
      expect(nestedNativeFailure).not.toContain(oscD(7));
      expect(nestedNativeFailure).toContain('<PROMPT:False:7>');
      expect(markerCount(sameLineCmdletFailure, OSC_C)).toBe(1);
      expect(sameLineCmdletFailure).toContain(oscD(1));
      expect(sameLineCmdletFailure).not.toContain(oscD(7));
      expect(sameLineCmdletFailure).toContain('<PROMPT:False:7>');
      expect(markerCount(cmdletFailure, OSC_C)).toBe(1);
      expect(cmdletFailure).toContain(oscD(1));
      expect(cmdletFailure).not.toContain(oscD(7));
      expect(cmdletFailure).toContain('<PROMPT:False:7>');
      expect(markerCount(success, OSC_C)).toBe(1);
      expect(success).toContain(oscD(0));
      expect(success).toContain('<PROMPT:True:7>');
      expect(output).toContain(STARTUP_READY_MARKER);
      expect(output).toContain(']7;file://');
    }, 25_000);
  });

  describe('Bash', () => {
    const bash = process.platform === 'win32'
      ? join(process.env.LOCALAPPDATA ?? '', 'hermes', 'git', 'usr', 'bin', 'bash.exe')
      : '/bin/bash';

    it('wraps the visible prompt and accepted commands with OSC 133 markers', () => {
      const init = buildShellInit('bash');
      expect(init).toContain('trap -p DEBUG');
      expect(init).toContain("printf '\\033]133;C\\033\\\\'");
      expect(init).toContain("printf '\\033]133;D;%s\\033\\\\'");
      expect(init).toContain("PS1='\\[\\033]133;A\\033\\\\\\]'\"${PS1}\"'\\[\\033]133;B\\033\\\\\\]'");
    });
    it('returns a PROMPT_COMMAND snippet for bash', () => {
      const init = buildShellInit('bash');
      expect(init).toContain('PROMPT_COMMAND');
      expect(init).toContain('printf');
      expect(init).toContain('__jt_ready');
      expect(init.indexOf('__jt_orig_prompt_commands=("${PROMPT_COMMAND[@]}")'))
        .toBeLessThan(init.indexOf('__jt_ready', init.indexOf('__jt_prompt_command()')));
      expect(init).toContain('__jt_orig_prompt_commands=("${PROMPT_COMMAND[@]}")');
      expect(init).toContain('PROMPT_COMMAND=__jt_prompt_command');
    });

    it('uses the canonical printf + file:// pattern', () => {
      const init = buildShellInit('bash');
      expect(init).toContain('file://');
      // The actual OSC 7 escape sequence.
      expect(init).toMatch(/\\033\]7/);
    });

    it.skipIf(!existsSync(bash))('keeps every array prompt hook before readiness', () => {
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

      expect(stripOsc133(execFileSync(bash, ['--noprofile', '--norc', '-c', script], { encoding: 'utf8' })))
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

    it.skipIf(!existsSync(bash))('accepts a scalar prompt hook with a trailing separator', () => {
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

      expect(stripOsc133(execFileSync(bash, ['--noprofile', '--norc', '-c', script], { encoding: 'utf8' })))
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

    it.skipIf(!existsSync(bash))('emits one lifecycle per command in a real interactive Bash', async () => {
      const initDir = mkdtempSync(join(tmpdir(), 'janet-bash-semantic-'));
      const rcPath = join(initDir, 'bashrc');
      writeFileSync(rcPath, [
        "first_hook() { printf '<ONE:%s>' \"$?\"; }",
        "second_hook() { printf '<TWO:%s>' \"$?\"; }",
        'PROMPT_COMMAND=(first_hook second_hook)',
        "trap 'printf \"<DEBUG:%s>\" \"$?\"' DEBUG",
        "PS1='<PROMPT>'",
        buildShellInit('bash'),
        buildShellInit('bash'),
      ].join('\n'));

      try {
        const output = await runPromptSequence(
          bash,
          ['--noprofile', '--rcfile', rcPath, '-i'],
          ['', "printf '\\074OUT\\076'; false", "printf '\\074OK\\076'", 'exit'],
        );
        const startup = promptSegment(output, 0);
        const blank = promptSegment(output, 1);
        const failure = promptSegment(output, 2);
        const success = promptSegment(output, 3);
        expect(stripOsc133(startup)).not.toContain(']<PROMPT>');
        expect(startup.indexOf(OSC_A)).toBeLessThan(startup.indexOf('<PROMPT>'));
        expect(startup).toContain('<ONE:0>');
        expect(startup).toContain('<TWO:0>');
        expect(startup).not.toContain(OSC_C);
        expect(startup).not.toContain(']133;D;');
        expect(blank).not.toContain(OSC_C);
        expect(blank).not.toContain(']133;D;');
        expect(markerCount(failure, OSC_C)).toBe(1);
        expect(failure.indexOf(OSC_C)).toBeLessThan(failure.indexOf('<OUT>'));
        expect(failure.indexOf('<OUT>')).toBeLessThan(failure.indexOf(oscD(1)));
        expect(failure).toContain('<ONE:1>');
        expect(failure).toContain('<TWO:1>');
        expect(markerCount(success, OSC_C)).toBe(1);
        expect(success.indexOf(OSC_C)).toBeLessThan(success.indexOf('<OK>'));
        expect(success.indexOf('<OK>')).toBeLessThan(success.indexOf(oscD(0)));
        expect(success).toContain('<ONE:0>');
        expect(success).toContain('<TWO:0>');
        expect(failure).toContain('<DEBUG:');
        expect(success).toContain('<DEBUG:');
        expect(output).toContain(STARTUP_READY_MARKER);
        expect(output).toContain(']7;file://');
      } finally {
        rmSync(initDir, { recursive: true, force: true });
      }
    }, 25_000);
  });

  describe('Zsh', () => {
    it('uses native idempotent hooks and wraps the actual prompt', () => {
      const init = buildShellInit('zsh');
      expect(init).toContain('autoload -Uz add-zsh-hook');
      expect(init).toContain('add-zsh-hook preexec __jt_preexec');
      expect(init).toContain('add-zsh-hook precmd __jt_precmd');
      expect(init).toContain('PS1=');
      expect(init).not.toContain('precmd_functions+=');
    });
    it('uses a precmd hook for zsh', () => {
      const init = buildShellInit('zsh');
      expect(init).toContain('add-zsh-hook precmd __jt_precmd');
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
    it('installs prompt wrappers only once when sourced repeatedly', () => {
      const init = buildShellInit('fish');
      expect(init).toContain('if not set -q __jt_fish_installed');
      expect(init).toContain('set -g __jt_fish_installed 1');
    });

    it('uses native lifecycle events and preserves every prompt function', () => {
      const init = buildShellInit('fish');
      expect(init).toContain('--on-event fish_preexec');
      expect(init).toContain('--on-event fish_postexec');
      expect(init).toContain('functions -c fish_prompt __jt_orig_fish_prompt');
      expect(init).toContain('functions -c fish_mode_prompt __jt_orig_fish_mode_prompt');
      expect(init).toContain('functions -c fish_right_prompt __jt_orig_fish_right_prompt');
      expect(init).toContain('set -l __jt_status $status');
      expect(init).toContain('__jt_restore_status $__jt_status; __jt_orig_fish_prompt $argv');
      expect(init).toContain('__jt_restore_status $__jt_status; __jt_orig_fish_mode_prompt $argv');
      expect(init).not.toContain('fish_cancel');
    });
    it('uses a fish_prompt event handler for fish', () => {
      const init = buildShellInit('fish');
      expect(init).toContain('function fish_prompt');
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
