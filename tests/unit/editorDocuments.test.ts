import { describe, expect, it } from 'vitest';
import {
  editorDocumentModelUri,
  editorLanguageForPath,
  editorModelUri,
  editorResourceKey,
  editorResourceTitle,
  emptyTabDocumentWorkspace,
  isEditorDocumentDirty,
  type EditorDocument,
  type EditorResource,
} from '../../src/renderer/editorDocuments';

const revision = {
  token: 'a'.repeat(64),
  size: 12,
  mtime: '2026-07-16T12:00:00.000Z',
};

function documentFixture(overrides: Partial<EditorDocument> = {}): EditorDocument {
  const resource: EditorResource = { kind: 'local', path: '/workspace/src/app.ts' };
  return {
    key: editorResourceKey(resource),
    ownerTabId: 'tab-1',
    resource,
    title: 'app.ts',
    requestedPath: resource.path,
    resolvedPath: resource.path,
    content: 'const app = 1;',
    savedContent: 'const app = 1;',
    hasUtf8Bom: false,
    revision,
    loadState: 'ready',
    saveState: 'idle',
    error: null,
    ...overrides,
  };
}

describe('editor document identity', () => {
  it('keeps local and SSH resources distinct even when they point at the same path', () => {
    const local: EditorResource = { kind: 'local', path: '/workspace/src/app.ts' };
    const ssh: EditorResource = {
      kind: 'ssh',
      sessionId: 'session-1',
      connectionId: 'dev@example.test:22',
      path: '/workspace/src/app.ts',
      label: 'dev@example.test',
    };

    expect(editorResourceKey(local)).toBe('local:/workspace/src/app.ts');
    expect(editorResourceKey(ssh)).toBe(
      'ssh:session-1:dev@example.test:22:/workspace/src/app.ts',
    );
    expect(editorResourceKey(local)).not.toBe(editorResourceKey(ssh));
    expect(editorModelUri(local)).toBe('/workspace/src/app.ts');
    expect(editorModelUri(ssh)).toBe(
      'janet-ssh://session-1/workspace/src/app.ts?connection=dev%40example.test%3A22',
    );
  });

  it('includes session and connection identity in SSH keys and model URIs', () => {
    const resource = (sessionId: string, connectionId: string): EditorResource => ({
      kind: 'ssh',
      sessionId,
      connectionId,
      path: '/srv/My Project/config.json',
      label: 'Remote',
    });

    const first = resource('session one', 'connection-a');
    const second = resource('session two', 'connection-a');
    const third = resource('session one', 'connection-b');

    expect(new Set([
      editorResourceKey(first),
      editorResourceKey(second),
      editorResourceKey(third),
    ])).toHaveProperty('size', 3);
    expect(new Set([
      editorModelUri(first),
      editorModelUri(second),
      editorModelUri(third),
    ])).toHaveProperty('size', 3);
    expect(editorModelUri(first)).toBe(
      'janet-ssh://session%20one/srv/My%20Project/config.json?connection=connection-a',
    );
  });

  it('keeps Monaco model URIs unique when the same file is open in two terminal tabs', () => {
    const first = documentFixture({ ownerTabId: 'tab-1' });
    const second = documentFixture({ ownerTabId: 'tab-2' });

    expect(editorDocumentModelUri(first)).toContain('janet-local://workspace/app.ts?');
    expect(editorDocumentModelUri(first)).not.toBe(editorDocumentModelUri(second));
    expect(editorDocumentModelUri(first)).toContain('owner=tab-1');
    expect(editorDocumentModelUri(second)).toContain('owner=tab-2');
  });

  it('uses the final path segment as the editor title on local and remote paths', () => {
    expect(editorResourceTitle({ kind: 'local', path: 'C:\\repo\\README.md' })).toBe('README.md');
    expect(editorResourceTitle({
      kind: 'ssh',
      sessionId: 'session-1',
      connectionId: 'connection-1',
      path: '/etc/nginx/nginx.conf',
      label: 'server',
    })).toBe('nginx.conf');
  });
});

describe('editor language detection', () => {
  it.each([
    ['/workspace/app.ts', 'typescript'],
    ['/workspace/Component.TSX', 'typescript'],
    ['/workspace/script.mjs', 'javascript'],
    ['/workspace/settings.jsonc', 'json'],
    ['/workspace/README.MD', 'markdown'],
    ['/workspace/styles.scss', 'scss'],
    ['/workspace/deploy.yaml', 'yaml'],
    ['/workspace/run.zsh', 'shell'],
    ['/workspace/Dockerfile', 'dockerfile'],
    ['/workspace/GNUmakefile', 'makefile'],
    ['/workspace/no-extension', 'plaintext'],
    ['/workspace/archive.unknown', 'plaintext'],
  ])('maps %s to %s', (filePath, language) => {
    expect(editorLanguageForPath(filePath)).toBe(language);
  });
});

describe('editor dirty state', () => {
  it('marks a ready document dirty only when its content differs from the saved snapshot', () => {
    expect(isEditorDocumentDirty(documentFixture())).toBe(false);
    expect(isEditorDocumentDirty(documentFixture({ content: 'const app = 2;' }))).toBe(true);
  });

  it.each(['loading', 'error'] as const)('does not report %s documents as dirty', (loadState) => {
    expect(isEditorDocumentDirty(documentFixture({
      loadState,
      content: 'unsaved content',
    }))).toBe(false);
  });

  it('starts each tab workspace on its terminal with no open documents', () => {
    expect(emptyTabDocumentWorkspace()).toEqual({ order: [], activeSurface: 'terminal' });
    expect(emptyTabDocumentWorkspace()).not.toBe(emptyTabDocumentWorkspace());
  });
});
