import type {
  TextFileError,
  TextFileRevision,
} from '../shared/textFiles';

export type EditorResource =
  | {
      kind: 'local';
      path: string;
    }
  | {
      kind: 'ssh';
      sessionId: string;
      connectionId: string;
      path: string;
      label: string;
    };

export type EditorDocumentLoadState = 'loading' | 'ready' | 'error';
export type EditorDocumentSaveState = 'idle' | 'saving' | 'error';

export interface EditorDocument {
  key: string;
  ownerTabId: string;
  resource: EditorResource;
  title: string;
  requestedPath: string;
  resolvedPath: string;
  content: string;
  savedContent: string;
  hasUtf8Bom: boolean;
  revision: TextFileRevision | null;
  loadState: EditorDocumentLoadState;
  saveState: EditorDocumentSaveState;
  error: TextFileError | null;
}

export interface TabDocumentWorkspace {
  order: string[];
  activeSurface: 'terminal' | string;
}

export function editorResourceKey(resource: EditorResource): string {
  return resource.kind === 'local'
    ? `local:${resource.path}`
    : `ssh:${resource.sessionId}:${resource.connectionId}:${resource.path}`;
}

export function editorResourceTitle(resource: EditorResource): string {
  const segments = resource.path.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] || resource.path;
}

export function editorModelUri(resource: EditorResource, resolvedPath = resource.path): string {
  if (resource.kind === 'local') return resolvedPath;
  const session = encodeURIComponent(resource.sessionId);
  const path = resolvedPath
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `janet-ssh://${session}/${path}?connection=${encodeURIComponent(resource.connectionId)}`;
}

/**
 * Monaco requires every live model URI to be globally unique. JaneT permits
 * the same file to be opened in more than one terminal workspace, so include
 * the owning outer tab without changing the file resource's save identity.
 */
export function editorDocumentModelUri(document: EditorDocument): string {
  const resolvedPath = document.resolvedPath || document.resource.path;
  const owner = encodeURIComponent(document.ownerTabId);
  if (document.resource.kind === 'ssh') {
    return `${editorModelUri(document.resource, resolvedPath)}&owner=${owner}`;
  }

  const title = encodeURIComponent(editorResourceTitle({ kind: 'local', path: resolvedPath }) || 'document');
  return `janet-local://workspace/${title}?path=${encodeURIComponent(resolvedPath)}&owner=${owner}`;
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  bat: 'bat',
  c: 'c',
  cc: 'cpp',
  conf: 'ini',
  cpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  csv: 'plaintext',
  env: 'ini',
  go: 'go',
  h: 'c',
  hpp: 'cpp',
  htm: 'html',
  html: 'html',
  ini: 'ini',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsonc: 'json',
  jsx: 'javascript',
  less: 'less',
  log: 'plaintext',
  lua: 'lua',
  md: 'markdown',
  mdx: 'markdown',
  mjs: 'javascript',
  php: 'php',
  ps1: 'powershell',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  scss: 'scss',
  sh: 'shell',
  sql: 'sql',
  swift: 'swift',
  toml: 'ini',
  ts: 'typescript',
  tsx: 'typescript',
  txt: 'plaintext',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'shell',
};

export function editorLanguageForPath(filePath: string): string {
  const name = editorResourceTitle({ kind: 'local', path: filePath }).toLowerCase();
  if (name === 'dockerfile') return 'dockerfile';
  if (name === 'makefile' || name === 'gnumakefile') return 'makefile';
  const extension = name.includes('.') ? name.split('.').pop() ?? '' : '';
  return LANGUAGE_BY_EXTENSION[extension] ?? 'plaintext';
}

export function isEditorDocumentDirty(document: EditorDocument): boolean {
  return document.loadState === 'ready' && document.content !== document.savedContent;
}

export function emptyTabDocumentWorkspace(): TabDocumentWorkspace {
  return { order: [], activeSurface: 'terminal' };
}
