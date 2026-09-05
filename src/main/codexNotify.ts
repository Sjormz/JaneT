import { parse, type TomlTableWithoutBigInt } from 'smol-toml';
import { isDeepStrictEqual } from 'node:util';

export function notifyCommand(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 128 || value.some(arg => typeof arg !== 'string' || arg.includes('\0')) ||
    (value.length > 0 && !value[0]) || JSON.stringify(value).length > 65536) throw new Error('Invalid Codex notification command.');
  return value;
}

export function forwardedNotify(value: unknown, helper?: string): string[] {
  let command = notifyCommand(value);
  // Unwrap only JaneT's known command shapes, including a previous installation path.
  for (let depth = 0; depth < 8; depth++) {
    if (!/^(?:.*[\\/])?node(?:\.exe)?$/i.test(command[0] ?? '') ||
      (command[1]?.replace(/\\/g, '/') !== helper?.replace(/\\/g, '/') && !/[\\/]agent-cli\.cjs$/.test(command[1] ?? ''))) return command;
    if (command.length === 3 && command[2] === '--codex-notify') return [];
    if (command.length !== 4 || command[2] !== '--codex-notify-forward') return command;
    command = notifyCommand(JSON.parse(command[3]));
  }
  throw new Error('Recursive JaneT notification configuration.');
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

/** Change only notify arrays. Reparse and compare the whole document before accepting an edit. */
export function connectCodexNotify(source: string, helper: string, addRoot: boolean): string {
  const original = parse(source);
  const targets: string[][] = Object.hasOwn(original, 'notify') ? [['notify']] : [];
  if (original.profiles && typeof original.profiles === 'object') {
    for (const [name, profile] of Object.entries(original.profiles)) {
      if (profile && typeof profile === 'object' && Object.hasOwn(profile, 'notify')) targets.push(['profiles', name, 'notify']);
    }
  }
  const wrap = (previous: unknown) => ['node', helper.replace(/\\/g, '/'), '--codex-notify-forward', JSON.stringify(forwardedNotify(previous, helper))];
  for (const keys of targets) {
    const expected = parse(source);
    let table = expected;
    for (const key of keys.slice(0, -1)) table = table[key] as TomlTableWithoutBigInt;
    const previous = table.notify;
    const next = wrap(previous);
    if (isDeepStrictEqual(previous, next)) continue;
    table.notify = next;
    let replacement: string | undefined;
    for (const [start, end] of arraySpans(source)) {
      try {
        if (!isDeepStrictEqual(parse('value = ' + source.slice(start, end)).value, previous)) continue;
        const candidate = source.slice(0, start) + JSON.stringify(next) + source.slice(end);
        if (isDeepStrictEqual(parse(candidate), expected)) { replacement = candidate; break; }
      } catch { /* Not the target array; never rewrite unrelated configuration. */ }
    }
    if (replacement === undefined) throw new Error('Cannot safely update Codex notification configuration.');
    source = replacement;
  }
  if (addRoot && !Object.hasOwn(original, 'notify')) source = `notify = ${JSON.stringify(wrap([]))}\n` + source;
  return source;
}
