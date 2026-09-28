import { describe, it, expect } from 'vitest';
import { fileUrlToPath, isLocalOsc7Host, MAX_OSC7_PAYLOAD_LENGTH } from '../../src/renderer/osc7';

/** Reference RFC 3986 encoder matching the shell emitters: unreserved, `/` and `:` stay literal. */
function encodePath(path: string): string {
  return Array.from(new TextEncoder().encode(path), byte => {
    const ch = String.fromCharCode(byte);
    return /[A-Za-z0-9/._~:-]/.test(ch) ? ch : '%' + byte.toString(16).toUpperCase().padStart(2, '0');
  }).join('');
}

describe('fileUrlToPath', () => {
  it('decodes a POSIX file:// URL', () => {
    expect(fileUrlToPath('file://localhost/home/alice')).toBe('/home/alice');
  });

  it('decodes a Windows file:// URL (C:/...)', () => {
    expect(fileUrlToPath('file://localhost/C:/Users/sjorm')).toBe('C:/Users/sjorm');
    expect(fileUrlToPath('file:///C:/Users/sjorm')).toBe('C:/Users/sjorm');
  });

  it('normalizes a bare drive root', () => {
    expect(fileUrlToPath('file://localhost/C:')).toBe('C:/');
    expect(fileUrlToPath('file://localhost/C:/')).toBe('C:/');
  });

  it('decodes percent-encoded paths', () => {
    expect(fileUrlToPath('file://localhost/home/alice/My%20Dir')).toBe('/home/alice/My Dir');
    expect(fileUrlToPath('file://localhost/C:/Program%20Files/JaneT')).toBe('C:/Program Files/JaneT');
  });

  it('keeps accepting raw spaces and Unicode from permissive emitters', () => {
    expect(fileUrlToPath('file://localhost/home/alice/My Dir')).toBe('/home/alice/My Dir');
    expect(fileUrlToPath('file://localhost/home/ålice/日本')).toBe('/home/ålice/日本');
  });

  it.each([
    ['spaces', '/home/alice/My Dir'],
    ['a literal %20', 'C:/work/literal%20name'],
    ['a bare percent', 'C:/work/100%done'],
    ['a hash', '/srv/issue#12'],
    ['a question mark', '/srv/why?'],
    ['Unicode', '/home/ålice/日本語/😀'],
    ['apostrophes', "C:/Users/o'brien/it's"],
    ['a backslash in a POSIX name', '/tmp/back\\slash'],
    ['a Windows drive path', 'C:/Program Files (x86)/JaneT'],
  ])('round-trips %s exactly once', (_label, path) => {
    const url = 'file://localhost' + (path.startsWith('/') ? '' : '/') + encodePath(path);
    expect(fileUrlToPath(url)).toBe(path);
  });

  it('decodes exactly once', () => {
    expect(fileUrlToPath('file://localhost/C:/work/literal%2520name')).toBe('C:/work/literal%20name');
    expect(fileUrlToPath('file://localhost/C:/work/100%25done')).toBe('C:/work/100%done');
  });

  it('rejects malformed percent encoding', () => {
    expect(fileUrlToPath('file://localhost/home/%XX')).toBeNull();
    expect(fileUrlToPath('file://localhost/C:/work/100%done')).toBeNull();
    expect(fileUrlToPath('file://localhost/home/trailing%')).toBeNull();
    expect(fileUrlToPath('file://localhost/home/short%2')).toBeNull();
    // Invalid UTF-8.
    expect(fileUrlToPath('file://localhost/home/%C3')).toBeNull();
    expect(fileUrlToPath('file://localhost/home/%FF')).toBeNull();
  });

  it('rejects NUL and other control characters, encoded or raw', () => {
    expect(fileUrlToPath('file://localhost/C:/bad%00name')).toBeNull();
    expect(fileUrlToPath('file://localhost/tmp/a%09b')).toBeNull();
    expect(fileUrlToPath('file://localhost/tmp/a%0Ab')).toBeNull();
    expect(fileUrlToPath('file://localhost/tmp/a%1Bb')).toBeNull();
    expect(fileUrlToPath('file://localhost/tmp/a%7Fb')).toBeNull();
    expect(fileUrlToPath('file://localhost/tmp/a%C2%9Bb')).toBeNull();
    expect(fileUrlToPath('file://localhost/tmp/a\tb')).toBeNull();
    expect(fileUrlToPath('file://localhost/tmp/a\x1bb')).toBeNull();
  });

  it('rejects raw query and fragment delimiters that make the path ambiguous', () => {
    expect(fileUrlToPath('file://localhost/srv/issue#12')).toBeNull();
    expect(fileUrlToPath('file://localhost/srv/why?')).toBeNull();
  });

  it('rejects relative and dot-segment paths', () => {
    expect(fileUrlToPath('file://localhost/home/../etc')).toBeNull();
    expect(fileUrlToPath('file://localhost/home/./alice')).toBeNull();
    expect(fileUrlToPath('file://localhost/home/%2E%2E/etc')).toBeNull();
    expect(fileUrlToPath('file://localhost/C:relative')).toBeNull();
  });

  it('rejects UNC forms instead of contacting a network share', () => {
    expect(fileUrlToPath('file://localhost//server/share/folder')).toBeNull();
    expect(fileUrlToPath('file:////server/share/folder')).toBeNull();
    expect(fileUrlToPath('file://server/share/folder', 'janet-box')).toBeNull();
  });

  it('rejects over-long payloads', () => {
    const long = 'file://localhost/' + 'a'.repeat(MAX_OSC7_PAYLOAD_LENGTH);
    expect(fileUrlToPath(long)).toBeNull();
    expect(fileUrlToPath('file://localhost/' + 'a'.repeat(40_000))).toBeNull();
  });

  it('rejects URLs without a path', () => {
    expect(fileUrlToPath('file://localhost')).toBeNull();
  });

  it('rejects non-file URLs', () => {
    expect(fileUrlToPath('https://example.com/foo')).toBeNull();
    expect(fileUrlToPath('not-a-url')).toBeNull();
  });

  it('handles an empty path after the host (just a slash)', () => {
    expect(fileUrlToPath('file://localhost/')).toBe('/');
  });

  describe('host validation', () => {
    it('accepts empty and localhost authorities', () => {
      expect(fileUrlToPath('file:///home/alice', 'janet-box')).toBe('/home/alice');
      expect(fileUrlToPath('file://LOCALHOST/home/alice', 'janet-box')).toBe('/home/alice');
    });

    it("accepts this machine's hostname case-insensitively", () => {
      expect(fileUrlToPath('file://SHINIGAMI/C:/Users', 'Shinigami')).toBe('C:/Users');
      expect(fileUrlToPath('file://janet-box/home/alice', 'janet-box')).toBe('/home/alice');
    });

    it('accepts a short name against the FQDN and vice versa', () => {
      expect(fileUrlToPath('file://janet-box/home/alice', 'janet-box.example.com')).toBe('/home/alice');
      expect(fileUrlToPath('file://janet-box.local/home/alice', 'janet-box')).toBe('/home/alice');
    });

    it('rejects a remote host so a nested SSH shell cannot redirect local tools', () => {
      expect(fileUrlToPath('file://remote.example/home/alice', 'janet-box')).toBeNull();
      expect(fileUrlToPath('file://myhost.example.com/var/log')).toBeNull();
      expect(fileUrlToPath('file://other-box/home/alice', 'janet-box')).toBeNull();
    });

    it('rejects different FQDNs that share a short name', () => {
      expect(fileUrlToPath('file://janet-box.a.example/home', 'janet-box.b.example')).toBeNull();
    });

    it('rejects a non-local host when the local hostname is unknown', () => {
      expect(fileUrlToPath('file://janet-box/home/alice', '')).toBeNull();
    });

    it('rejects userinfo, ports and odd authorities', () => {
      expect(fileUrlToPath('file://user@localhost/home')).toBeNull();
      expect(fileUrlToPath('file://localhost:22/home')).toBeNull();
      expect(fileUrlToPath('file://C:/Users')).toBeNull();
      expect(fileUrlToPath('file://local%68ost/home')).toBeNull();
    });

    it('matches hostnames via isLocalOsc7Host', () => {
      expect(isLocalOsc7Host('', '')).toBe(true);
      expect(isLocalOsc7Host('localhost.', 'x')).toBe(true);
      expect(isLocalOsc7Host('box.', 'BOX')).toBe(true);
      expect(isLocalOsc7Host('boxy', 'box')).toBe(false);
      expect(isLocalOsc7Host('box', 'boxy.example')).toBe(false);
    });
  });
});
