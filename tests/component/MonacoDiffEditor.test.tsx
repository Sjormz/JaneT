import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import MonacoDiffEditor from '../../src/renderer/components/MonacoDiffEditor';
import type { EditorDocument } from '../../src/renderer/editorDocuments';

const monacoMocks = vi.hoisted(() => {
  const modelDisposals: Array<ReturnType<typeof vi.fn>> = [];
  const createModel = vi.fn(() => {
    const dispose = vi.fn();
    modelDisposals.push(dispose);
    return { dispose };
  });
  const instance = {
    dispose: vi.fn(),
    setModel: vi.fn(),
    updateOptions: vi.fn(),
  };
  const monaco = {
    Uri: { parse: vi.fn((value: string) => value) },
    editor: {
      createDiffEditor: vi.fn(() => instance),
      createModel,
      setTheme: vi.fn(),
    },
  };
  return { instance, modelDisposals, monaco };
});

vi.mock('../../src/renderer/monacoRuntime', () => ({
  defineJaneTMonacoTheme: (_monaco: unknown, theme: { name: string }) => `janet-${theme.name}`,
  loadMonaco: () => Promise.resolve(monacoMocks.monaco),
}));

const document: EditorDocument = {
  key: 'git-diff:/workspace:src/app.ts:unstaged',
  ownerTabId: 'tab-1',
  resource: {
    kind: 'git-diff',
    repoPath: '/workspace',
    path: 'src/app.ts',
    side: 'unstaged',
  },
  title: 'app.ts (Working Tree)',
  requestedPath: 'src/app.ts',
  resolvedPath: 'src/app.ts',
  content: 'const value = 2;\n',
  originalContent: 'const value = 1;\n',
  savedContent: 'const value = 2;\n',
  hasUtf8Bom: false,
  revision: null,
  loadState: 'ready',
  saveState: 'idle',
  error: null,
};

describe('MonacoDiffEditor', () => {
  it('updates appearance without recreating its editor or models', async () => {
    const view = render(
      <MonacoDiffEditor
        document={document}
        themeName="tokyo-night"
        fontSize={14}
        fontFamily="JetBrains Mono"
      />,
    );

    await waitFor(() => expect(monacoMocks.monaco.editor.createDiffEditor).toHaveBeenCalledOnce());

    view.rerender(
      <MonacoDiffEditor
        document={document}
        themeName="dracula"
        fontSize={16}
        fontFamily="Cascadia Mono"
      />,
    );

    await waitFor(() => {
      expect(monacoMocks.monaco.editor.setTheme).toHaveBeenCalledWith('janet-dracula');
      expect(monacoMocks.instance.updateOptions).toHaveBeenCalledWith({
        fontFamily: 'Cascadia Mono',
        fontSize: 16,
      });
    });
    expect(monacoMocks.monaco.editor.createDiffEditor).toHaveBeenCalledOnce();
    expect(monacoMocks.monaco.editor.createModel).toHaveBeenCalledTimes(2);
    expect(monacoMocks.instance.dispose).not.toHaveBeenCalled();
    expect(monacoMocks.modelDisposals).toHaveLength(2);
    expect(monacoMocks.modelDisposals.every((dispose) => dispose.mock.calls.length === 0)).toBe(true);

    view.unmount();

    expect(monacoMocks.instance.dispose).toHaveBeenCalledOnce();
    expect(monacoMocks.modelDisposals.every((dispose) => dispose.mock.calls.length === 1)).toBe(true);
  });
});
