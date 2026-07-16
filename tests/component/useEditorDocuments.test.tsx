import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useEditorDocuments,
  type EditorDocumentsController,
} from '../../src/renderer/useEditorDocuments';

const modelMocks = vi.hoisted(() => ({
  dispose: vi.fn(),
  disposeAll: vi.fn(),
}));

vi.mock('../../src/renderer/components/MonacoEditor', () => ({
  disposeEditorDocumentModel: modelMocks.dispose,
  disposeAllEditorDocumentModels: modelMocks.disposeAll,
}));

let controller: EditorDocumentsController;

function Harness() {
  controller = useEditorDocuments();
  return null;
}

const revision = (token = 'a'.repeat(64)) => ({
  token,
  size: 6,
  mtime: '2026-07-16T00:00:00.000Z',
  fileId: '1:2',
});

const snapshot = (path: string, content = 'hello\n') => ({
  requestedPath: path,
  resolvedPath: path,
  content,
  encoding: 'utf8' as const,
  hasUtf8Bom: false,
  revision: revision(),
});

const api = {
  fsReadTextFile: vi.fn(),
  fsWriteTextFile: vi.fn(),
  sshReadTextFile: vi.fn(),
  sshWriteTextFile: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'janet', {
    configurable: true,
    value: api,
  });
  api.fsReadTextFile.mockResolvedValue({ ok: true, value: snapshot('/repo/readme.md') });
  api.fsWriteTextFile.mockImplementation(async (request) => ({
    ok: true,
    value: {
      requestedPath: request.requestedPath,
      resolvedPath: request.resolvedPath,
      revision: revision('b'.repeat(64)),
    },
  }));
  api.sshReadTextFile.mockResolvedValue({ ok: true, value: snapshot('/srv/app.ts') });
  api.sshWriteTextFile.mockImplementation(async (request) => ({
    ok: true,
    value: {
      requestedPath: request.requestedPath,
      resolvedPath: request.resolvedPath,
      revision: revision('c'.repeat(64)),
    },
  }));
  render(<Harness />);
});

describe('useEditorDocuments', () => {
  it('opens, deduplicates, edits, and saves the latest local content', async () => {
    let key = '';
    await act(async () => {
      key = await controller.openDocument('tab-1', { kind: 'local', path: '/repo/readme.md' });
    });

    expect(api.fsReadTextFile).toHaveBeenCalledWith({ filePath: '/repo/readme.md' });
    expect(controller.documentsByTab['tab-1']).toHaveLength(1);
    expect(controller.workspaces['tab-1'].activeSurface).toBe(key);

    await act(async () => {
      const duplicate = await controller.openDocument('tab-1', { kind: 'local', path: '/repo/readme.md' });
      expect(duplicate).toBe(key);
    });
    expect(api.fsReadTextFile).toHaveBeenCalledOnce();
    expect(controller.documentsByTab['tab-1']).toHaveLength(1);

    let outcome = '';
    await act(async () => {
      controller.updateDocumentContent(key, 'edited immediately\n');
      outcome = await controller.saveDocument(key);
    });

    expect(outcome).toBe('saved');
    expect(api.fsWriteTextFile).toHaveBeenCalledWith(expect.objectContaining({
      requestedPath: '/repo/readme.md',
      content: 'edited immediately\n',
      hasUtf8Bom: false,
    }));
    expect(controller.dirtyDocuments).toHaveLength(0);
  });

  it('binds remote reads and writes to the exact SSH connection generation', async () => {
    let key = '';
    await act(async () => {
      key = await controller.openDocument('tab-ssh', {
        kind: 'ssh',
        sessionId: 'session-1',
        connectionId: 'generation-7',
        path: '/srv/app.ts',
        label: 'dev@example.com',
      });
    });
    expect(api.sshReadTextFile).toHaveBeenCalledWith({
      sessionId: 'session-1',
      connectionId: 'generation-7',
      remotePath: '/srv/app.ts',
    });

    await act(async () => {
      controller.updateDocumentContent(key, 'remote edit\n');
      await controller.saveDocument(key);
    });
    expect(api.sshWriteTextFile).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      connectionId: 'generation-7',
      content: 'remote edit\n',
    }));
  });

  it('surfaces a conflict and only sends overwrite after explicit retry', async () => {
    api.fsWriteTextFile
      .mockResolvedValueOnce({ ok: false, error: { code: 'CONFLICT', message: 'Changed outside JaneT' } })
      .mockImplementationOnce(async (request) => ({
        ok: true,
        value: {
          requestedPath: request.requestedPath,
          resolvedPath: request.resolvedPath,
          revision: revision('d'.repeat(64)),
        },
      }));
    let key = '';
    await act(async () => {
      key = await controller.openDocument('tab-1', { kind: 'local', path: '/repo/readme.md' });
      controller.updateDocumentContent(key, 'mine\n');
    });

    await act(async () => {
      await expect(controller.saveDocument(key)).resolves.toBe('CONFLICT');
    });
    expect(api.fsWriteTextFile).toHaveBeenNthCalledWith(1, expect.not.objectContaining({ overwrite: true }));

    await act(async () => {
      await expect(controller.saveDocument(key, true)).resolves.toBe('saved');
    });
    expect(api.fsWriteTextFile).toHaveBeenNthCalledWith(2, expect.objectContaining({ overwrite: true }));
  });

  it('invalidates an in-flight load when its document closes', async () => {
    let resolveRead!: (value: unknown) => void;
    api.fsReadTextFile.mockReturnValue(new Promise((resolve) => { resolveRead = resolve; }));
    let pending!: Promise<string>;
    act(() => {
      pending = controller.openDocument('tab-1', { kind: 'local', path: '/repo/readme.md' });
    });
    await waitFor(() => expect(controller.documents).toHaveLength(1));
    const key = controller.documents[0].key;

    act(() => controller.closeDocument(key));
    resolveRead({ ok: true, value: snapshot('/repo/readme.md', 'late\n') });
    await act(async () => { await pending; });

    expect(controller.documents).toHaveLength(0);
    await waitFor(() => expect(modelMocks.dispose).toHaveBeenCalledWith(key));
  });

  it('does not let an old save mutate or lock a document reopened with the same key', async () => {
    let resolveOldSave!: (value: unknown) => void;
    api.fsWriteTextFile
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOldSave = resolve; }))
      .mockImplementationOnce(async (request) => ({
        ok: true,
        value: {
          requestedPath: request.requestedPath,
          resolvedPath: request.resolvedPath,
          revision: revision('c'.repeat(64)),
        },
      }));

    let key = '';
    await act(async () => {
      key = await controller.openDocument('tab-1', { kind: 'local', path: '/repo/readme.md' });
      controller.updateDocumentContent(key, 'old edit\n');
    });
    let oldSave!: Promise<string>;
    act(() => {
      oldSave = controller.saveDocument(key);
    });
    await waitFor(() => expect(api.fsWriteTextFile).toHaveBeenCalledTimes(1));

    api.fsReadTextFile.mockResolvedValueOnce({
      ok: true,
      value: snapshot('/repo/readme.md', 'fresh from disk\n'),
    });
    await act(async () => {
      controller.closeDocument(key);
      expect(await controller.openDocument('tab-1', { kind: 'local', path: '/repo/readme.md' })).toBe(key);
      controller.updateDocumentContent(key, 'new edit\n');
      await expect(controller.saveDocument(key)).resolves.toBe('saved');
    });
    expect(api.fsWriteTextFile).toHaveBeenCalledTimes(2);

    resolveOldSave({
      ok: true,
      value: {
        requestedPath: '/repo/readme.md',
        resolvedPath: '/repo/readme.md',
        revision: revision('d'.repeat(64)),
      },
    });
    await act(async () => { await oldSave; });

    const reopened = controller.documents.find((document) => document.key === key);
    expect(reopened?.content).toBe('new edit\n');
    expect(reopened?.savedContent).toBe('new edit\n');
    expect(reopened?.revision?.token).toBe('c'.repeat(64));
  });
});
