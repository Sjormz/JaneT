import { describe, it, expect } from 'vitest';
import { fileUrlToPath } from '../../src/renderer/osc7';

describe('fileUrlToPath', () => {
  it('decodes a POSIX file:// URL', () => {
    expect(fileUrlToPath('file://localhost/home/alice')).toBe('/home/alice');
  });

  it('decodes a Windows file:// URL (C:/...)', () => {
    expect(fileUrlToPath('file://localhost/C:/Users/sjorm')).toBe('C:/Users/sjorm');
  });

  it('decodes percent-encoded paths', () => {
    expect(fileUrlToPath('file://localhost/home/alice/My%20Dir')).toBe('/home/alice/My Dir');
  });

  it('decodes percent-encoded characters in Windows paths', () => {
    expect(fileUrlToPath('file://localhost/C:/Program%20Files/JaneT')).toBe('C:/Program Files/JaneT');
  });

  it('handles a hostname other than localhost', () => {
    expect(fileUrlToPath('file://myhost.example.com/var/log')).toBe('/var/log');
  });

  it('rejects URLs without a path', () => {
    expect(fileUrlToPath('file://localhost')).toBeNull();
  });

  it('rejects non-file URLs', () => {
    expect(fileUrlToPath('https://example.com/foo')).toBeNull();
    expect(fileUrlToPath('not-a-url')).toBeNull();
  });

  it('handles an empty path after the host (just a slash)', () => {
    // file://localhost/ -> the "/" is the path, so result is "/"
    expect(fileUrlToPath('file://localhost/')).toBe('/');
  });
});
