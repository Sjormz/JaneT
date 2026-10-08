import { parse, type TomlTableWithoutBigInt } from 'smol-toml';
import { isDeepStrictEqual } from 'node:util';

export function notifyCommand(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 128 || value.some(arg => typeof arg !== 'string' || arg.includes('\0')) ||
    (value.length > 0 && !value[0]) || JSON.stringify(value).length > 65536) throw new Error('Invalid Codex notification command.');
  return value;
}

/** Base64url keeps the forwarded argv free of quotes, which Windows PowerShell 5.1 mangles for native commands. */
export function encodeNotify(command: string[]): string {
  return Buffer.from(JSON.stringify(notifyCommand(command)), 'utf8').toString('base64url');
}

export function decodeNotify(value: unknown): unknown {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]*$/.test(value) || value.length > 90000) throw new Error('Invalid Codex notification command.');
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

function setupNotifyCommand(value: unknown): string[] {
  // Setup may need to repair a previously bloated config; runtime forwarding keeps
  // the tighter notifyCommand limit when it eventually starts the saved handler.
  if (!Array.isArray(value) || value.length > 128 || value.some(arg => typeof arg !== 'string' || arg.includes('\0')) ||
    (value.length > 0 && !value[0]) || JSON.stringify(value).length > 1024 * 1024) throw new Error('Invalid Codex notification command.');
  return value;
}

function janetWrapper(command: string[], helper?: string): boolean {
  return /^(?:.*[\\/])?node(?:\.exe)?$/i.test(command[0] ?? '') &&
    (command[1]?.replace(/\\/g, '/') === helper?.replace(/\\/g, '/') || /[\\/]agent-cli\.cjs$/i.test(command[1] ?? '')) &&
    command.length === 4 && command[2] === '--codex-notify-forward';
}

function computerUseWrapper(command: string[]): boolean {
  return /(?:^|[\\/])codex-computer-use\.exe$/i.test(command[0] ?? '') && command.length === 4 &&
    command[1] === 'turn-ended' && command[2] === '--previous-notify';
}

function computerUseBase(command: string[]): boolean {
  return /(?:^|[\\/])codex-computer-use\.exe$/i.test(command[0] ?? '') && command.length === 2 && command[1] === 'turn-ended';
}

export function forwardedNotify(value: unknown, helper?: string, setup = false): string[] {
  const read = setup ? setupNotifyCommand : notifyCommand;
  let command = read(value);
  let computer: string[] | undefined;
  const seen = new Set<string>();
  // Wrapper payloads are serialized argv arrays. Track them to reject malformed cycles.
  for (;;) {
    const key = JSON.stringify(command);
    if (seen.has(key)) throw new Error('Recursive JaneT notification configuration.');
    seen.add(key);
    if (janetWrapper(command, helper)) {
      command = read(JSON.parse(command[3]));
      continue;
    }
    if (janetNotify(command, helper)) {
      command = read(decodeNotify(command[3]));
      continue;
    }
    if (computerUseWrapper(command)) {
      computer ??= command.slice(0, 3);
      command = read(JSON.parse(command[3]));
      continue;
    }
    if (computerUseBase(command)) {
      computer ??= [...command, '--previous-notify'];
      command = [];
    }
    if (/^(?:.*[\\/])?node(?:\.exe)?$/i.test(command[0] ?? '') &&
      (command[1]?.replace(/\\/g, '/') === helper?.replace(/\\/g, '/') || /[\\/]agent-cli\.cjs$/i.test(command[1] ?? '')) &&
      command.length === 3 && command[2] === '--codex-notify') command = [];
    // Only the wrapper chain gets the larger setup limit; its saved leaf still
    // has to satisfy the normal runtime forwarding limit.
    notifyCommand(command);
    if (!computer) return command;
    if (!helper) return [...computer, JSON.stringify(command)];
    // Keep the computer-use callback and make its previous callback one current JaneT forwarder.
    const janet = ['node', helper.replace(/\\/g, '/'), '--codex-notify-forward', JSON.stringify(command)];
    return [...computer, JSON.stringify(janet)];
  }
}

/** Find array spans without mistaking comments or quoted TOML text for configuration. */
function arraySpans(source: string): Array<[number, number]> {
  const stack: number[] = [], spans: Array<[number, number]> = [];
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '#') { const end = source.indexOf('\n', i); i = end < 0 ? source.length : end; }
    else if (char === '"' || char === "'") {
      const triple = source.slice(i, i + 3) === char.repeat(3);
      i += triple ? 3 : 1;
      for (; i < source.length; i++) {
        if (char === '"' && source[i] === '\\') { i++; continue; }
        if (source[i] !== char) continue;
        if (!triple) break;
        let end = i;
        while (source[end] === char) end++;
        if (end - i >= 3) { i = end - 1; break; }
      }
    } else if (char === '[') stack.push(i);
    else if (char === ']' && stack.length) spans.push([stack.pop()!, i + 1]);
  }
  return spans;
}

/**
 * The user's own notifier with every JaneT forwarder removed. A computer-use callback whose
 * only previous notifier was JaneT returns to the form Codex computer-use writes itself.
 */
export function withoutJanetNotify(value: unknown): string[] {
  const command = forwardedNotify(value, undefined, true);
  if (computerUseWrapper(command) && command[3] === '[]') return command.slice(0, 2);
  return command;
}

export function janetNotify(command: string[], helper?: string): boolean {
  return janetWrapper(command, helper) || (/^(?:.*[\\/])?node(?:\.exe)?$/i.test(command[0] ?? '')
    && /[\\/]agent-cli\.cjs$/i.test(command[1] ?? '') && command.length === 4 && command[2] === '--codex-notify-forward-b64');
}

/**
 * Removes JaneT forwarders from root and profile notify arrays (persistent installs before
 * session-only setup). Only notify arrays change; the whole document is reparsed and compared.
 * A notify that only ever held JaneT is deleted when it sits on its own line.
 */
export function disconnectCodexNotify(source: string): string {
  const original = parse(source);
  const targets: string[][] = Object.hasOwn(original, 'notify') ? [['notify']] : [];
  if (original.profiles && typeof original.profiles === 'object') {
    for (const [name, profile] of Object.entries(original.profiles)) {
      if (profile && typeof profile === 'object' && Object.hasOwn(profile, 'notify')) targets.push(['profiles', name, 'notify']);
    }
  }
  for (const keys of targets) {
    const expected = parse(source);
    let table = expected;
    for (const key of keys.slice(0, -1)) table = table[key] as TomlTableWithoutBigInt;
    const previous = table.notify;
    const next = withoutJanetNotify(previous);
    if (isDeepStrictEqual(previous, next)) continue;
    let replacement: string | undefined;
    for (const [start, end] of arraySpans(source)) {
      try {
        if (!isDeepStrictEqual(parse('value = ' + source.slice(start, end)).value, previous)) continue;
        if (next.length === 0) {
          // Delete `notify = [...]` when it is the whole line; otherwise fall back to an empty array.
          const lineStart = source.lastIndexOf('\n', start - 1) + 1;
          const lineEnd = source.indexOf('\n', end);
          const after = lineEnd < 0 ? source.length : lineEnd + 1;
          if (/^[ \t]*(?:notify|"notify"|'notify')[ \t]*=[ \t]*$/.test(source.slice(lineStart, start)) && /^[ \t]*(?:#[^\n]*)?\r?\n?$/.test(source.slice(end, after))) {
            // Reparse rather than clone: TOML dates are class instances that a clone would not preserve.
            const removed = parse(source);
            let parent = removed;
            for (const key of keys.slice(0, -1)) parent = parent[key] as TomlTableWithoutBigInt;
            delete parent.notify;
            const candidate = source.slice(0, lineStart) + source.slice(after);
            if (isDeepStrictEqual(parse(candidate), removed)) { replacement = candidate; break; }
          }
        }
        table.notify = next;
        const candidate = source.slice(0, start) + JSON.stringify(next) + source.slice(end);
        if (isDeepStrictEqual(parse(candidate), expected)) { replacement = candidate; break; }
      } catch { /* Not the target array; never rewrite unrelated configuration. */ }
    }
    if (replacement === undefined) throw new Error('Cannot safely update Codex notification configuration.');
    source = replacement;
  }
  return source;
}
