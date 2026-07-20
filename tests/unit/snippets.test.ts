import { describe, expect, it } from 'vitest';
import { hasDuplicateSnippetName, normalizeSnippets, snippetTextForPaste } from '../../src/shared/snippets';

describe('snippets', () => {
  it('keeps valid snippets and removes malformed or duplicate names case-insensitively', () => {
    expect(normalizeSnippets([
      { id: 'deploy', name: ' Deploy ', content: 'npm run deploy' },
      { id: 'deploy-again', name: 'deploy', content: 'duplicate' },
      { id: 'missing-content', name: 'Broken' },
      { id: 'empty-name', name: '   ', content: 'echo nope' },
    ])).toEqual([
      { id: 'deploy', name: 'Deploy', content: 'npm run deploy' },
    ]);
  });

  it('detects a case-insensitive name collision while allowing the snippet being edited', () => {
    const snippets = [{ id: 'deploy', name: 'Deploy', content: 'npm run deploy' }];

    expect(hasDuplicateSnippetName(snippets, ' deploy ')).toBe(true);
    expect(hasDuplicateSnippetName(snippets, ' deploy ', 'deploy')).toBe(false);
  });

  it('removes trailing line endings before a snippet is pasted', () => {
    expect(snippetTextForPaste('echo hello\n')).toBe('echo hello');
    expect(snippetTextForPaste('first\nsecond\n')).toBe('first\nsecond');
  });
});
