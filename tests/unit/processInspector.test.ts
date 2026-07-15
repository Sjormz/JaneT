import { describe, expect, it } from 'vitest';
import {
  parsePosixProcessSnapshot,
  parseWindowsProcessSnapshot,
  stableProcesses,
  type ProcessInfo,
} from '../../src/main/processInspector';

function processInfo(
  pid: number,
  ppid: number,
  name: string,
  overrides: Partial<ProcessInfo> = {},
): ProcessInfo {
  return { pid, ppid, name, ...overrides };
}

describe('stableProcesses', () => {
  it('keeps processes that identify the same operating-system process in both snapshots', () => {
    const shell = processInfo(100, 1, 'zsh', { startTime: '10' });
    const server = processInfo(101, 100, 'node', { startTime: '11', state: 'S' });

    expect(stableProcesses([shell, server], [shell, server])).toEqual([shell, server]);
  });

  it('filters processes that appear in only one snapshot', () => {
    const shell = processInfo(100, 1, 'zsh', { startTime: '10' });
    const shortLived = processInfo(101, 100, 'git', { startTime: '11' });

    expect(stableProcesses([shell, shortLived], [shell])).toEqual([shell]);
    expect(stableProcesses([shell], [shell, shortLived])).toEqual([shell]);
  });

  it('does not confuse a reused pid with the process from the first snapshot', () => {
    const first = processInfo(101, 100, 'node', { startTime: '11' });
    const reused = processInfo(101, 100, 'node', { startTime: '12' });

    expect(stableProcesses([first], [reused])).toEqual([]);
  });
});

describe('process snapshot parsing', () => {
  it('parses macOS/Linux ps rows with fixed-width start times and executable paths', () => {
    const output = [
      '    1     0 Ss   Thu Jul  9 04:38:49 2026     /sbin/launchd',
      '31965 31951 S+   Wed Jul 15 10:13:42 2026     -/bin/zsh',
    ].join('\n');

    expect(parsePosixProcessSnapshot(output)).toEqual([
      { pid: 1, ppid: 0, state: 'Ss', startTime: 'Thu Jul  9 04:38:49 2026', name: '/sbin/launchd' },
      { pid: 31965, ppid: 31951, state: 'S+', startTime: 'Wed Jul 15 10:13:42 2026', name: '-/bin/zsh' },
    ]);
  });

  it('parses either one or many PowerShell CIM rows and ignores malformed values', () => {
    expect(parseWindowsProcessSnapshot(JSON.stringify([
      { ProcessId: 10, ParentProcessId: 1, Name: 'pwsh.exe', CreationDate: '20260715110000.000000-420' },
      { ProcessId: 'bad', ParentProcessId: 1, Name: 'ignored.exe' },
    ]))).toEqual([
      { pid: 10, ppid: 1, name: 'pwsh.exe', startTime: '20260715110000.000000-420' },
    ]);
    expect(parseWindowsProcessSnapshot('{not json')).toEqual([]);
  });
});
