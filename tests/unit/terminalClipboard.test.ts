import { describe, expect, it } from 'vitest';
import { decodeTerminalClipboard } from '../../src/renderer/terminalClipboard';

describe('OSC 52 clipboard decoding', () => {
  it('decodes bounded UTF-8 copies and rejects reads, malformed data and oversized writes', () => {
    expect(decodeTerminalClipboard(`c;${Buffer.from('Hello 🌍\nsecond line').toString('base64')}`)).toBe('Hello 🌍\nsecond line');
    const largestCopy = 'x'.repeat(1_048_576);
    expect(decodeTerminalClipboard(`c;${Buffer.from(largestCopy).toString('base64')}`)).toBe(largestCopy);
    for (const data of ['c;?', 'c;%%%%', 'q;SGVsbG8=', 'c;/w==', `c;${'A'.repeat(1_500_000)}`]) {
      expect(decodeTerminalClipboard(data)).toBeNull();
    }
  });
});
