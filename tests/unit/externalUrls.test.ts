import { describe, expect, it } from 'vitest';
import { isAllowedExternalUrl } from '../../src/main/externalUrls';

describe('isAllowedExternalUrl', () => {
  it.each([
    'https://example.com/docs',
    'http://localhost:3000',
  ])('allows browser-safe URL %s', (url) => {
    expect(isAllowedExternalUrl(url)).toBe(true);
  });

  it.each([
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,hello',
    'mailto:user@example.com',
    'not a url',
  ])('rejects terminal-originated URL %s', (url) => {
    expect(isAllowedExternalUrl(url)).toBe(false);
  });
});
