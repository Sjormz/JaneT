import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  TextFileError,
  TextFileErrorCode,
  TextFileResult,
  TextFileSnapshot,
} from '../shared/textFiles';
import {
  editorResourceKey,
  editorResourceTitle,
  emptyTabDocumentWorkspace,
  isEditorDocumentDirty,
  type EditorDocument,
  type EditorResource,
  type TabDocumentWorkspace,
} from './editorDocuments';
import {
  disposeAllEditorDocumentModels,
  disposeEditorDocumentModel,
} from './components/MonacoEditor';

type SaveOutcome = 'saved' | TextFileErrorCode;

const genericIoError = (message: string): TextFileError => ({ code: 'IO', message });

export interface EditorDocumentsController {
  documents: EditorDocument[];
  documentsByTab: Record<string, EditorDocument[]>;
  workspaces: Record<string, TabDocumentWorkspace>;
  dirtyTabIds: Set<string>;
  dirtyDocuments: EditorDocument[];
  openDocument: (ownerTabId: string, resource: EditorResource) => Promise<string>;
  retryDocument: (key: string) => Promise<void>;
  selectSurface: (ownerTabId: string, surface: 'terminal' | string) => void;
  updateDocumentContent: (key: string, content: string) => void;
  saveDocument: (key: string, overwrite?: boolean) => Promise<SaveOutcome>;
  saveDocuments: (keys: string[]) => Promise<boolean>;
  closeDocument: (key: string) => void;
  closeDocumentsForTab: (tabId: string) => void;
}

export function useEditorDocuments(): EditorDocumentsController {
  const [documents, setDocuments] = useState<Record<string, EditorDocument>>({});
  const [workspaces, setWorkspaces] = useState<Record<string, TabDocumentWorkspace>>({});
  const documentsRef = useRef(documents);
  const requestGenerationRef = useRef(new Map<string, number>());
  const saveLocksRef = useRef(new Map<string, Promise<SaveOutcome>>());
  documentsRef.current = documents;
  const commitDocuments = useCallback((
    update: (current: Record<string, EditorDocument>) => Record<string, EditorDocument>,
  ) => {
    const next = update(documentsRef.current);
    documentsRef.current = next;
    setDocuments(next);
  }, []);

  const selectSurface = useCallback((ownerTabId: string, surface: 'terminal' | string) => {
    setWorkspaces((current) => {
      const workspace = current[ownerTabId] ?? emptyTabDocumentWorkspace();
      if (workspace.activeSurface === surface) return current;
      return { ...current, [ownerTabId]: { ...workspace, activeSurface: surface } };
    });
  }, []);

  const loadDocument = useCallback(async (key: string): Promise<void> => {
    const existing = documentsRef.current[key];
    if (!existing) return;
    const generation = (requestGenerationRef.current.get(key) ?? 0) + 1;
    requestGenerationRef.current.set(key, generation);
    commitDocuments((current) => {
      const document = current[key];
      return document ? {
        ...current,
        [key]: { ...document, loadState: 'loading', saveState: 'idle', error: null },
      } : current;
    });

    let result: TextFileResult<TextFileSnapshot>;
    try {
      result = existing.resource.kind === 'local'
        ? await window.janet.fsReadTextFile({ filePath: existing.resource.path })
        : await window.janet.sshReadTextFile({
            sessionId: existing.resource.sessionId,
            connectionId: existing.resource.connectionId,
            remotePath: existing.resource.path,
          });
    } catch (error) {
      result = { ok: false, error: genericIoError(error instanceof Error ? error.message : 'The file could not be opened.') };
    }
    if (requestGenerationRef.current.get(key) !== generation) return;

    commitDocuments((current) => {
      const document = current[key];
      if (!document) return current;
      if (!result.ok) {
        return {
          ...current,
          [key]: { ...document, loadState: 'error', saveState: 'idle', error: result.error },
        };
      }
      return {
        ...current,
        [key]: {
          ...document,
          requestedPath: result.value.requestedPath,
          resolvedPath: result.value.resolvedPath,
          content: result.value.content,
          savedContent: result.value.content,
          hasUtf8Bom: result.value.hasUtf8Bom,
          revision: result.value.revision,
          loadState: 'ready',
          saveState: 'idle',
          error: null,
        },
      };
    });
  }, [commitDocuments]);

  const openDocument = useCallback(async (ownerTabId: string, resource: EditorResource): Promise<string> => {
    const key = `${ownerTabId}|${editorResourceKey(resource)}`;
    const existing = documentsRef.current[key];
    setWorkspaces((current) => {
      const workspace = current[ownerTabId] ?? emptyTabDocumentWorkspace();
      return {
        ...current,
        [ownerTabId]: {
          order: workspace.order.includes(key) ? workspace.order : [...workspace.order, key],
          activeSurface: key,
        },
      };
    });
    if (existing) return key;

    const document: EditorDocument = {
      key,
      ownerTabId,
      resource,
      title: editorResourceTitle(resource),
      requestedPath: resource.path,
      resolvedPath: resource.path,
      content: '',
      savedContent: '',
      hasUtf8Bom: false,
      revision: null,
      loadState: 'loading',
      saveState: 'idle',
      error: null,
    };
    documentsRef.current = { ...documentsRef.current, [key]: document };
    commitDocuments((current) => ({ ...current, [key]: document }));
    await loadDocument(key);
    return key;
  }, [commitDocuments, loadDocument]);

  const retryDocument = useCallback(async (key: string) => {
    await loadDocument(key);
  }, [loadDocument]);

  const updateDocumentContent = useCallback((key: string, content: string) => {
    commitDocuments((current) => {
      const document = current[key];
      if (!document || document.loadState !== 'ready' || document.content === content) return current;
      return {
        ...current,
        [key]: { ...document, content, saveState: 'idle', error: null },
      };
    });
  }, [commitDocuments]);

  const saveDocument = useCallback((key: string, overwrite = false): Promise<SaveOutcome> => {
    const pending = saveLocksRef.current.get(key);
    if (pending) return pending;

    const operation = (async (): Promise<SaveOutcome> => {
      const document = documentsRef.current[key];
      if (!document || document.loadState !== 'ready' || !document.revision) return 'INVALID_REQUEST';
      const documentGeneration = requestGenerationRef.current.get(key) ?? 0;
      const contentAtSave = document.content;
      commitDocuments((current) => {
        const candidate = current[key];
        return candidate ? {
          ...current,
          [key]: { ...candidate, saveState: 'saving', error: null },
        } : current;
      });

      let result;
      try {
        result = document.resource.kind === 'local'
          ? await window.janet.fsWriteTextFile({
              requestedPath: document.requestedPath,
              resolvedPath: document.resolvedPath,
              expectedRevision: document.revision,
              content: contentAtSave,
              hasUtf8Bom: document.hasUtf8Bom,
              ...(overwrite ? { overwrite: true } : {}),
            })
          : await window.janet.sshWriteTextFile({
              sessionId: document.resource.sessionId,
              connectionId: document.resource.connectionId,
              requestedPath: document.requestedPath,
              resolvedPath: document.resolvedPath,
              expectedRevision: document.revision,
              content: contentAtSave,
              hasUtf8Bom: document.hasUtf8Bom,
              ...(overwrite ? { overwrite: true } : {}),
            });
      } catch (error) {
        result = { ok: false, error: genericIoError(error instanceof Error ? error.message : 'The file could not be saved.') } as const;
      }

      commitDocuments((current) => {
        const candidate = current[key];
        if (
          !candidate
          || requestGenerationRef.current.get(key) !== documentGeneration
        ) return current;
        if (!result.ok) {
          return {
            ...current,
            [key]: { ...candidate, saveState: 'error', error: result.error },
          };
        }
        return {
          ...current,
          [key]: {
            ...candidate,
            requestedPath: result.value.requestedPath,
            resolvedPath: result.value.resolvedPath,
            revision: result.value.revision,
            savedContent: contentAtSave,
            saveState: 'idle',
            error: null,
          },
        };
      });
      return result.ok ? 'saved' : result.error.code;
    })().finally(() => {
      if (saveLocksRef.current.get(key) === operation) {
        saveLocksRef.current.delete(key);
      }
    });
    saveLocksRef.current.set(key, operation);
    return operation;
  }, [commitDocuments]);

  const saveDocuments = useCallback(async (keys: string[]): Promise<boolean> => {
    for (const key of keys) {
      const document = documentsRef.current[key];
      if (!document || !isEditorDocumentDirty(document)) continue;
      if (await saveDocument(key) !== 'saved') return false;
    }
    return true;
  }, [saveDocument]);

  const closeDocument = useCallback((key: string) => {
    requestGenerationRef.current.set(key, (requestGenerationRef.current.get(key) ?? 0) + 1);
    saveLocksRef.current.delete(key);
    const document = documentsRef.current[key];
    if (!document) return;
    commitDocuments((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    setWorkspaces((current) => {
      const workspace = current[document.ownerTabId];
      if (!workspace) return current;
      const index = workspace.order.indexOf(key);
      const order = workspace.order.filter((candidate) => candidate !== key);
      const nextSurface = workspace.activeSurface === key
        ? order[Math.min(index, order.length - 1)] ?? 'terminal'
        : workspace.activeSurface;
      return {
        ...current,
        [document.ownerTabId]: { order, activeSurface: nextSurface },
      };
    });
    requestAnimationFrame(() => {
      if (!documentsRef.current[key]) disposeEditorDocumentModel(key);
    });
  }, [commitDocuments]);

  const closeDocumentsForTab = useCallback((tabId: string) => {
    const keys = Object.values(documentsRef.current)
      .filter((document) => document.ownerTabId === tabId)
      .map((document) => document.key);
    if (keys.length === 0) return;
    const keySet = new Set(keys);
    for (const key of keys) {
      requestGenerationRef.current.set(key, (requestGenerationRef.current.get(key) ?? 0) + 1);
      saveLocksRef.current.delete(key);
    }
    commitDocuments((current) => Object.fromEntries(
      Object.entries(current).filter(([key]) => !keySet.has(key)),
    ));
    setWorkspaces((current) => {
      if (!current[tabId]) return current;
      const next = { ...current };
      delete next[tabId];
      return next;
    });
    requestAnimationFrame(() => {
      keys.forEach((key) => {
        if (!documentsRef.current[key]) disposeEditorDocumentModel(key);
      });
    });
  }, [commitDocuments]);

  useEffect(() => () => disposeAllEditorDocumentModels(), []);

  const documentList = useMemo(() => Object.values(documents), [documents]);
  const documentsByTab = useMemo(() => {
    const grouped: Record<string, EditorDocument[]> = {};
    for (const [tabId, workspace] of Object.entries(workspaces)) {
      grouped[tabId] = workspace.order
        .map((key) => documents[key])
        .filter((document): document is EditorDocument => Boolean(document));
    }
    return grouped;
  }, [documents, workspaces]);
  const dirtyDocuments = useMemo(
    () => documentList.filter(isEditorDocumentDirty),
    [documentList],
  );
  const dirtyTabIds = useMemo(
    () => new Set(dirtyDocuments.map((document) => document.ownerTabId)),
    [dirtyDocuments],
  );

  return {
    documents: documentList,
    documentsByTab,
    workspaces,
    dirtyTabIds,
    dirtyDocuments,
    openDocument,
    retryDocument,
    selectSurface,
    updateDocumentContent,
    saveDocument,
    saveDocuments,
    closeDocument,
    closeDocumentsForTab,
  };
}
