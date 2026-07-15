import { execFile } from 'child_process';

export interface ProcessInfo {
  pid: number;
  ppid: number;
  name: string;
  startTime?: string;
  state?: string;
}

export interface ProcessInspector {
  snapshot(): Promise<ProcessInfo[]>;
}

function execute(
  file: string,
  args: string[],
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, {
      encoding: 'utf8',
      timeout: 5_000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

export function parsePosixProcessSnapshot(output: string): ProcessInfo[] {
  const processes: ProcessInfo[] = [];
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.{24})\s+(.+?)\s*$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isSafeInteger(ppid) || ppid < 0) continue;
    processes.push({
      pid,
      ppid,
      state: match[3],
      startTime: match[4].trim(),
      name: match[5].trim(),
    });
  }
  return processes;
}

interface WindowsProcessRow {
  ProcessId?: unknown;
  ParentProcessId?: unknown;
  Name?: unknown;
  CreationDate?: unknown;
}

export function parseWindowsProcessSnapshot(output: string): ProcessInfo[] {
  if (!output.trim()) return [];
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch {
    return [];
  }
  const rows: WindowsProcessRow[] = Array.isArray(value) ? value : [value as WindowsProcessRow];
  const processes: ProcessInfo[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const pid = Number(row.ProcessId);
    const ppid = Number(row.ParentProcessId);
    if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isSafeInteger(ppid) || ppid < 0) continue;
    processes.push({
      pid,
      ppid,
      name: typeof row.Name === 'string' && row.Name.trim() ? row.Name.trim() : `process-${pid}`,
      startTime: typeof row.CreationDate === 'string' ? row.CreationDate : undefined,
    });
  }
  return processes;
}

function stableKey(process: ProcessInfo): string {
  return process.startTime
    ? `${process.pid}:${process.startTime}`
    : `${process.pid}:${process.ppid}:${process.name.toLowerCase()}`;
}

/** Keep only processes that were present in both close-time samples. */
export function stableProcesses(first: ProcessInfo[], second: ProcessInfo[]): ProcessInfo[] {
  const firstKeys = new Set(first.map(stableKey));
  return second.filter((process) => firstKeys.has(stableKey(process)));
}

export class SystemProcessInspector implements ProcessInspector {
  constructor(private readonly platform: NodeJS.Platform = process.platform) {}

  async snapshot(): Promise<ProcessInfo[]> {
    if (this.platform === 'win32') {
      const script = [
        'Get-CimInstance Win32_Process',
        'Select-Object ProcessId,ParentProcessId,Name,CreationDate',
        'ConvertTo-Json -Compress',
      ].join(' | ');
      const output = await execute('powershell.exe', [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        script,
      ]);
      return parseWindowsProcessSnapshot(output);
    }

    const output = await execute('ps', ['-axo', 'pid=,ppid=,stat=,lstart=,comm=']);
    return parsePosixProcessSnapshot(output);
  }
}
