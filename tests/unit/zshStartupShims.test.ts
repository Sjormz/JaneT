import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node-pty', () => ({ spawn: vi.fn() }));

import { buildZshStartupFiles, shellLaunch, ZSH_USER_ZDOTDIR_ENV } from '../../src/main/terminal';

const INIT = [
  'echo "JANET_INIT user_zdotdir=${ZDOTDIR-<unset>} leaked=${JANET_ZSH_USER_ZDOTDIR-<unset>}"',
  'if [[ -n "${__janet_zdotdir-}" ]]; then echo JANET_SHIM_STATE_LEFT; fi',
].join('\n');

const temporaryDirectories: string[] = [];

function temporaryDirectory(name: string): string {
  const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), name));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function writeShims(init = INIT): string {
  const directory = temporaryDirectory('janet-zsh-shims-');
  for (const [name, contents] of Object.entries(buildZshStartupFiles(init))) {
    fs.writeFileSync(path.join(directory, name), contents);
  }
  return directory;
}

function userFile(directory: string, name: string, marker: string, extra = ''): void {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, name), `echo ${marker}\n${extra}`);
}

function markers(output: string): string[] {
  return output.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^(USER_|JANET_)/.test(line));
}

/**
 * A POSIX shell that understands the shim syntax (bash 4.2+), used to replay
 * zsh's documented startup order for an interactive login shell: each file is
 * read from `${ZDOTDIR:-$HOME}` evaluated at the moment it is read.
 */
function findBash(): string | null {
  if (process.env.JANET_TEST_BASH) return process.env.JANET_TEST_BASH;
  if (process.platform === 'darwin') return null; // macOS ships bash 3.2 (no typeset -g); real zsh covers it.
  const candidates = process.platform === 'win32'
    ? [
      path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
      path.join(process.env.LOCALAPPDATA ?? '', 'hermes', 'git', 'usr', 'bin', 'bash.exe'),
    ]
    : ['/bin/bash', '/usr/bin/bash'];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

const bash = findBash();
const zsh = ['/bin/zsh', '/usr/bin/zsh'].find((candidate) => fs.existsSync(candidate)) ?? null;

function replayZshStartup(env: NodeJS.ProcessEnv): string {
  const driver = path.join(temporaryDirectory('janet-zsh-driver-'), 'driver.sh');
  fs.writeFileSync(driver, [
    'for __file in .zshenv .zprofile .zshrc .zlogin; do',
    '  __dir="${ZDOTDIR:-$HOME}"',
    '  if [[ -f "$__dir/$__file" ]]; then builtin source "$__dir/$__file"; fi',
    'done',
    '',
  ].join('\n'));
  const result = spawnSync(bash!, ['--noprofile', '--norc', driver], { env, encoding: 'utf8', timeout: 20_000 });
  expect(result.error).toBeUndefined();
  expect(result.stderr).toBe('');
  return result.stdout;
}

function runRealZsh(env: NodeJS.ProcessEnv): string {
  const result = spawnSync(zsh!, ['-i', '-l', '-c', 'true'], { env, encoding: 'utf8', timeout: 20_000 });
  expect(result.error).toBeUndefined();
  return result.stdout;
}

function baseEnv(home: string, shims: string, userZdotdir?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, ZDOTDIR: shims };
  delete env.JANET_ZSH_USER_ZDOTDIR;
  return { ...env, ...shellLaunchEnv(shims, userZdotdir) };
}

/** The env JaneT itself adds for zsh, with ZDOTDIR pointing at `shims`. */
function shellLaunchEnv(shims: string, userZdotdir?: string): NodeJS.ProcessEnv {
  const inherited: NodeJS.ProcessEnv = userZdotdir === undefined ? {} : { ZDOTDIR: userZdotdir };
  const launch = shellLaunch('/bin/zsh', INIT, () => '', () => shims, inherited);
  return launch.env;
}

describe('zsh startup shims', () => {
  it('launches zsh with the user ZDOTDIR recorded beside JaneT\'s shim directory', () => {
    expect(shellLaunch('/bin/zsh', INIT, () => '', () => '/tmp/shims', { ZDOTDIR: '/home/u/.config/zsh' })).toEqual({
      args: ['-i'],
      env: { ZDOTDIR: '/tmp/shims', [ZSH_USER_ZDOTDIR_ENV]: '/home/u/.config/zsh' },
    });
    expect(shellLaunch('/bin/zsh', INIT, () => '', () => '/tmp/shims', {}).env).toEqual({
      ZDOTDIR: '/tmp/shims',
      [ZSH_USER_ZDOTDIR_ENV]: '',
    });
  });

  it('writes every zsh startup file and runs JaneT init only from .zshrc, after the user file', () => {
    const files = buildZshStartupFiles('JANET_INIT_MARKER');
    expect(Object.keys(files).sort()).toEqual(['.zlogin', '.zprofile', '.zshenv', '.zshrc']);
    const occurrences = Object.values(files).join('\n').split('JANET_INIT_MARKER').length - 1;
    expect(occurrences).toBe(1);
    const zshrc = files['.zshrc'];
    expect(zshrc.indexOf('/.zshrc"')).toBeGreaterThan(-1);
    expect(zshrc.indexOf('/.zshrc"')).toBeLessThan(zshrc.indexOf('JANET_INIT_MARKER'));
    // ZDOTDIR is restored to the user's value (never re-pointed at the shims)
    // before JaneT init and startup commands run.
    expect(zshrc).not.toContain('export ZDOTDIR="$__janet_zdotdir"');
    expect(files['.zshenv']).toContain(`unset ${ZSH_USER_ZDOTDIR_ENV}`);
  });

  const scenarios = (run: (env: NodeJS.ProcessEnv) => string) => {
    it('follows a ZDOTDIR exported by ~/.zshenv and never reads the home .zshrc', () => {
      const home = temporaryDirectory('janet-zsh-home-');
      const config = path.join(home, 'cfg');
      userFile(home, '.zshenv', 'USER_ZSHENV', 'export ZDOTDIR="$HOME/cfg"\n');
      userFile(home, '.zshrc', 'USER_WRONG_HOME_ZSHRC');
      userFile(config, '.zshenv', 'USER_WRONG_SECOND_ZSHENV');
      userFile(config, '.zprofile', 'USER_ZPROFILE');
      userFile(config, '.zshrc', 'USER_ZSHRC', 'typeset -A user_map; user_map[key]=value\n');
      userFile(config, '.zlogin', 'USER_ZLOGIN', 'echo "USER_MAP ${user_map[key]-missing}"\n');

      const lines = markers(run(baseEnv(home, writeShims())));
      expect(lines.map((line) => line.startsWith('JANET_INIT') ? 'JANET_INIT' : line)).toEqual([
        'USER_ZSHENV',
        'USER_ZPROFILE',
        'USER_ZSHRC',
        'JANET_INIT',
        'USER_ZLOGIN',
        // A typeset in the user's .zshrc stays global (not function-local).
        'USER_MAP value',
      ]);
      expect(lines.find((line) => line.startsWith('JANET_INIT'))).toMatch(/user_zdotdir=\S*cfg leaked=<unset>$/);
    });

    it('reads an inherited custom ZDOTDIR instead of $HOME and keeps it for the session', () => {
      const home = temporaryDirectory('janet-zsh-home-');
      const custom = temporaryDirectory('janet-zsh-custom-');
      userFile(home, '.zshenv', 'USER_WRONG_HOME_ZSHENV');
      userFile(home, '.zshrc', 'USER_WRONG_HOME_ZSHRC');
      userFile(custom, '.zshenv', 'USER_ZSHENV');
      userFile(custom, '.zshrc', 'USER_ZSHRC');

      const lines = markers(run(baseEnv(home, writeShims(), custom)));
      expect(lines).toEqual(['USER_ZSHENV', 'USER_ZSHRC', `JANET_INIT user_zdotdir=${custom} leaked=<unset>`]);
    });

    it('uses $HOME and leaves ZDOTDIR unset when the user never set one', () => {
      const home = temporaryDirectory('janet-zsh-home-');
      userFile(home, '.zshenv', 'USER_ZSHENV');
      userFile(home, '.zshrc', 'USER_ZSHRC');
      userFile(home, '.zlogin', 'USER_ZLOGIN');

      const lines = markers(run(baseEnv(home, writeShims())));
      expect(lines).toEqual(['USER_ZSHENV', 'USER_ZSHRC', 'JANET_INIT user_zdotdir=<unset> leaked=<unset>', 'USER_ZLOGIN']);
    });

    it('still runs JaneT init once when the user has no startup files', () => {
      const home = temporaryDirectory('janet-zsh-home-');
      const lines = markers(run(baseEnv(home, writeShims())));
      expect(lines).toEqual(['JANET_INIT user_zdotdir=<unset> leaked=<unset>']);
    });
  };

  describe.skipIf(!bash)('replayed with bash in zsh startup order', () => scenarios(replayZshStartup));
  describe.skipIf(!zsh)('in a real interactive login zsh', () => scenarios(runRealZsh));
});
