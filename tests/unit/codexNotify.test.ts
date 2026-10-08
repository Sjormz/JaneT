import { describe, it, expect } from 'vitest';
import { parse } from 'smol-toml';
import { decodeNotify, disconnectCodexNotify, encodeNotify, forwardedNotify, withoutJanetNotify } from '../../src/main/codexNotify';

const helper = 'C:/JaneT/agent-cli.cjs';
const wrap = (original: string[]) => ['node', helper, '--codex-notify-forward', JSON.stringify(original)];

describe('Codex notification forwarding', () => {
  it('restores only the intended arrays, including inline/dotted profiles and misleading quoted text', () => {
    const lines = (notify: (value: string[]) => string[]) => [
      '# notify = ["wrong"]',
      'description = """',
      'notify = ["wrong"]',
      '"""',
      `"\\u006eotify" = ${JSON.stringify(notify(['existing', 'quote" and ] # and \\ path']))} # keep this comment`,
      `profiles.inline = { notify = ${JSON.stringify(notify(['second']))}, model = "keep" }`,
      `profiles.dotted.notify = ${JSON.stringify(notify(['third']))}`,
      '[profiles."name.with.dot"]',
      `notify = ${JSON.stringify(notify(['fourth']))}`,
      '[unrelated]',
      `notify = ${JSON.stringify(wrap(['not a Codex notify table']))}`,
      'date = 2026-09-05',
      '',
    ].join('\r\n');
    const restored = disconnectCodexNotify(lines(wrap));
    expect(parse(restored)).toEqual(parse(lines(value => value)));
    expect(restored).toContain(' # keep this comment\r\n');
    expect(restored).toContain(`[unrelated]\r\nnotify = ${JSON.stringify(wrap(['not a Codex notify table']))}\r\ndate = 2026-09-05`);
    expect(disconnectCodexNotify(restored)).toBe(restored);
  });

  it('unwraps every older JaneT callback form, including session forwarders', () => {
    expect(forwardedNotify(['node', 'C:/old/agent-cli.cjs', '--codex-notify'])).toEqual([]);
    expect(withoutJanetNotify(wrap(wrap(['original', 'arg'])))).toEqual(['original', 'arg']);
    const session = ['node', 'C:/x/agent-cli.cjs', '--codex-notify-forward-b64', encodeNotify(['user', 'a b', 'quote"'])];
    expect(withoutJanetNotify(session)).toEqual(['user', 'a b', 'quote"']);
    expect(encodeNotify(['quote"', "'"])).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeNotify(encodeNotify(['a', 'b']))).toEqual(['a', 'b']);
    expect(() => decodeNotify('not base64!')).toThrow(/Invalid/);
  });

  it('repairs a large alternating computer-use and JaneT wrapper chain to the user handler', () => {
    const computer = 'C:/Users/test/.codex/plugins/computer-use/codex-computer-use.exe';
    const leaf = ['C:/tools/user-notifier.exe', '--quiet', 'keep this'];
    let nested: string[] = [computer, 'turn-ended', '--previous-notify', JSON.stringify(leaf)];
    let i = 0;
    while (JSON.stringify(nested).length < 110000) {
      nested = i % 2 === 0 ? wrap(nested) : [computer, 'turn-ended', '--previous-notify', JSON.stringify(nested)];
      i++;
    }
    if (i % 2 === 1) nested = [computer, 'turn-ended', '--previous-notify', JSON.stringify(nested)];
    expect(JSON.stringify(nested).length).toBeGreaterThan(65536);
    expect(withoutJanetNotify(nested)).toEqual([computer, 'turn-ended', '--previous-notify', JSON.stringify(leaf)]);
    expect(withoutJanetNotify([computer, 'turn-ended', '--previous-notify', JSON.stringify(wrap([computer, 'turn-ended']))])).toEqual([computer, 'turn-ended']);
  });

  it.each([`'''literal [ ] # "notify"'''`, `"""basic \\\" [ ] # text"""`, `'''four quotes''''`, `"""five quotes"""""`])('preserves multiline string boundaries: %s', literal => {
    const source = `notes = ${literal}\nnotify = ${JSON.stringify(wrap(['original']))}\n`;
    const result = parse(disconnectCodexNotify(source));
    expect(result.notes).toEqual(parse(source).notes);
    expect(result.notify).toEqual(['original']);
  });

  it('removes JaneT-only notify lines, falls back to an empty array inline, and rejects invalid commands', () => {
    expect(disconnectCodexNotify(`model = "m"\nnotify = ${JSON.stringify(wrap([]))}\n`)).toBe('model = "m"\n');
    expect(parse(disconnectCodexNotify(`profiles.p = { notify = ${JSON.stringify(wrap([]))} }`))).toEqual({ profiles: { p: { notify: [] } } });
    expect(disconnectCodexNotify('notify = ["mine"]\n')).toBe('notify = ["mine"]\n');
    expect(() => disconnectCodexNotify('notify="not an argv"')).toThrow(/Invalid/);
    expect(() => disconnectCodexNotify('notify=[""]')).toThrow(/Invalid/);
  });
});
