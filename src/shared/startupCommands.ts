export type StartupShellDialect = 'posix' | 'fish' | 'powershell';

export const MAX_STARTUP_COMMANDS = 16;
export const MAX_STARTUP_COMMAND_LENGTH = 4_096;
export const MAX_STARTUP_COMMAND_TOTAL_LENGTH = 16_384;

const STARTUP_SHELL_DIALECTS = new Set<StartupShellDialect>([
  'posix',
  'fish',
  'powershell',
]);

const POSIX_SHELLS = new Set([
  'ash',
  'bash',
  'dash',
  'ksh',
  'mksh',
  'sh',
  'zsh',
]);

/**
 * Normalize the user-controlled command list without ever changing executable
 * text by truncation. Blank editor rows are omitted, but a malformed nonblank
 * row invalidates the whole sequence so corruption can never skip a gate and
 * continue with a later command.
 */
export function sanitizeStartupCommands(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const commands: string[] = [];
  let totalLength = 0;
  for (const candidate of value) {
    // These values are injected as terminal input, so reject every C0/C1
    // control byte (including Tab, Escape, Ctrl-C, and Ctrl-D) plus DEL.
    // Users can still express intentional control output through shell syntax.
    if (typeof candidate !== 'string') return [];

    const command = candidate.trim();
    if (!command) continue;
    if (
      commands.length >= MAX_STARTUP_COMMANDS ||
      /[\u0000-\u001f\u007f-\u009f]/.test(candidate) ||
      command.length > MAX_STARTUP_COMMAND_LENGTH ||
      totalLength + command.length > MAX_STARTUP_COMMAND_TOTAL_LENGTH
    ) return [];

    commands.push(command);
    totalLength += command.length;
  }
  return commands;
}

export function isStartupShellDialect(value: unknown): value is StartupShellDialect {
  return typeof value === 'string' && STARTUP_SHELL_DIALECTS.has(value as StartupShellDialect);
}

/** Infer only shells whose stop-on-error syntax JaneT knows how to compile. */
export function inferStartupShellDialect(shell: string): StartupShellDialect | null {
  const base = (shell.replace(/\\/g, '/').split('/').pop() || shell).toLowerCase().replace(/\.exe$/, '');
  if (POSIX_SHELLS.has(base)) return 'posix';
  if (base === 'fish') return 'fish';
  if (base === 'powershell' || base === 'pwsh') return 'powershell';
  return null;
}

function quotePosix(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function quoteFish(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function quotePowerShell(value: string): string {
  // PowerShell treats curly single quotes as delimiters too. Doubling each
  // delimiter keeps copied typographic apostrophes inside the verbatim string.
  return `'${value.replace(/['\u2018\u2019]/g, (quote) => `${quote}${quote}`)}'`;
}

function compilePowerShell(commands: string[], index = 0): string {
  // Capture $? on a new line *inside* Invoke-Expression. Checking it after
  // Invoke-Expression returns can report the invocation itself as successful
  // even when a native command inside it exited non-zero. The runtime newline
  // also prevents a trailing PowerShell comment from swallowing the gate.
  const current = [
    '$__jt_startup_ok = $false',
    `Invoke-Expression (${quotePowerShell(commands[index])} + [Environment]::NewLine + '$__jt_startup_ok = $?')`,
  ].join('; ');
  const fail = "Write-Error '__janet_startup_failed__' -ErrorAction Ignore";
  if (index === commands.length - 1) {
    return `${current}; if ($__jt_startup_ok) { $null = $true } else { ${fail} }`;
  }
  return `${current}; if ($__jt_startup_ok) { ${compilePowerShell(commands, index + 1)} } else { ${fail} }`;
}

/**
 * Compile the list into one expression owned by the interactive shell. The
 * shell, rather than JaneT or queued terminal input, decides when it is safe
 * to start the next command.
 */
export function compileStartupCommands(
  value: unknown,
  dialect: StartupShellDialect,
): string {
  const commands = sanitizeStartupCommands(value);
  if (commands.length === 0) return '';

  switch (dialect) {
    case 'posix':
      return commands.map((command) => `eval ${quotePosix(command)}`).join(' && ');
    case 'fish':
      return commands.map((command) => `eval ${quoteFish(command)}`).join('; and ');
    case 'powershell':
      return compilePowerShell(commands);
  }
}
