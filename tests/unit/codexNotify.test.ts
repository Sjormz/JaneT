import { describe, it, expect } from 'vitest';
import { parse } from 'smol-toml';
import { connectCodexNotify, forwardedNotify } from '../../src/main/codexNotify';

const helper = 'C:/JaneT/agent-cli.cjs';
describe('Codex notification forwarding configuration', () => {
  it('edits only the intended arrays, including inline/dotted profiles and misleading quoted text', () => {
    const source = [
      '# notify = ["wrong"]',
      'description = """',
      'notify = ["wrong"]',
      '"""',
      '"\\u006eotify" = [',
      ' "existing", # array comment',
      ' "quote\\\" and ] # and \\\\ path",',
      '] # keep this comment',
      'profiles.inline = { notify = ["second"], model = "keep" }',
      'profiles.dotted.notify = ["third"]',
      '[profiles."name.with.dot"]',
      'notify = ["fourth"]',
      '[unrelated]',
      'notify = ["existing", "quote\\\" and ] # and \\\\ path"]',
      'date = 2026-09-05',
      '',
    ].join('\r\n');
    const before = parse(source) as any;
    const text = connectCodexNotify(source, helper, true);
    const after = parse(text) as any;
    expect(JSON.parse(after.notify[3])).toEqual(before.notify);
    for (const key of ['inline', 'dotted', 'name.with.dot']) expect(JSON.parse(after.profiles[key].notify[3])).toEqual(before.profiles[key].notify);
    expect(after.description).toBe(before.description);
    expect(after.unrelated).toEqual(before.unrelated);
    expect(text).toContain('] # keep this comment\r\n');
    expect(text).toContain('[unrelated]\r\n' + source.split('[unrelated]\r\n')[1]);
    expect(connectCodexNotify(text, helper, true)).toBe(text);
  });

  it('migrates older JaneT callbacks without duplicate forwarding', () => {
    expect(forwardedNotify(['node', 'C:/old/agent-cli.cjs', '--codex-notify'])).toEqual([]);
    const existing = ['node', 'C:/old/agent-cli.cjs', '--codex-notify-forward', '["original","arg"]'];
    const next = parse(connectCodexNotify('notify = ' + JSON.stringify(existing), helper, true)).notify as string[];
    expect(next).toEqual(['node', helper, '--codex-notify-forward', '["original","arg"]']);
  });

  it.each([`'''literal [ ] # "notify"'''`, `"""basic \\\" [ ] # text"""`, `'''four quotes''''`, `"""five quotes"""""`])('preserves multiline string boundaries: %s', literal => {
    const source = `notes = ${literal}\nnotify = ['original']\n`;
    const result = parse(connectCodexNotify(source, helper, true));
    expect(result.notes).toEqual(parse(source).notes);
    expect(JSON.parse((result.notify as string[])[3])).toEqual(['original']);
  });

  it('respects an empty notifier, leaves inheriting profiles alone, and rejects invalid commands', () => {
    expect(JSON.parse((parse(connectCodexNotify('notify=[]', helper, true)).notify as string[])[3])).toEqual([]);
    expect(connectCodexNotify('# profile inherits root\nmodel="keep"', helper, false)).toBe('# profile inherits root\nmodel="keep"');
    expect(() => connectCodexNotify('notify="not an argv"', helper, true)).toThrow(/Invalid/);
    expect(() => connectCodexNotify('notify=[""]', helper, true)).toThrow(/Invalid/);
  });
});
