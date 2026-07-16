import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

export const RENDERER_SCHEME = 'janet';
export const RENDERER_HOST = 'app';
export const RENDERER_ORIGIN = `${RENDERER_SCHEME}://${RENDERER_HOST}`;

/**
 * Register this descriptor before Electron's `app.ready` event. Keeping the
 * value here makes the security-sensitive privileges explicit and prevents
 * the production protocol from accidentally bypassing the renderer CSP.
 */
export const RENDERER_SCHEME_REGISTRATION = {
  scheme: RENDERER_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    codeCache: true,
  },
} as const;

export interface RendererProtocolRequest {
  method: string;
  url: string;
}

export type RendererRequestRejection = {
  ok: false;
  status: 400 | 403 | 405 | 500;
  reason: 'invalid-method' | 'invalid-url' | 'invalid-origin' | 'invalid-path' | 'invalid-root' | 'asset-unavailable';
};

export type RendererRequestResolution = {
  ok: true;
  filePath: string;
  fileUrl: string;
} | RendererRequestRejection;

const UNSAFE_PATH_CHARACTER = /[\u0000-\u001F\u007F\\]/;

function reject(
  status: RendererRequestRejection['status'],
  reason: RendererRequestRejection['reason'],
): RendererRequestRejection {
  return { ok: false, status, reason };
}

/**
 * Return the request's path before WHATWG URL normalization. This lets us
 * reject explicit dot-segment traversal instead of silently turning
 * `../../asset` into `/asset` during URL parsing.
 */
function rawUrlPathname(value: string): string | null {
  const schemeSeparator = value.indexOf('://');
  if (schemeSeparator < 1) return null;

  const authorityStart = schemeSeparator + 3;
  const authorityEndCandidates = ['/', '?', '#']
    .map((delimiter) => value.indexOf(delimiter, authorityStart))
    .filter((position) => position >= 0);
  if (authorityEndCandidates.length === 0) return '/';

  const pathStart = Math.min(...authorityEndCandidates);
  if (value[pathStart] !== '/') return '/';

  const queryStart = value.indexOf('?', pathStart);
  const fragmentStart = value.indexOf('#', pathStart);
  let pathEnd = value.length;
  if (queryStart >= 0) pathEnd = Math.min(pathEnd, queryStart);
  if (fragmentStart >= 0) pathEnd = Math.min(pathEnd, fragmentStart);
  return value.slice(pathStart, pathEnd);
}

function isContainedPath(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return relativePath !== '..'
    && !relativePath.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relativePath);
}

/**
 * Resolve a production renderer request without reading from the filesystem.
 * Only GET requests for the exact `janet://app` authority can resolve, and the
 * returned path is always lexically contained by the renderer build root.
 */
export function resolveRendererRequest(
  request: RendererProtocolRequest,
  rendererRoot: string,
): RendererRequestResolution {
  if (request.method !== 'GET') return reject(405, 'invalid-method');
  if (typeof rendererRoot !== 'string' || !path.isAbsolute(rendererRoot)) {
    return reject(500, 'invalid-root');
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(request.url);
  } catch {
    return reject(400, 'invalid-url');
  }

  if (
    parsedUrl.protocol !== `${RENDERER_SCHEME}:`
    || parsedUrl.hostname !== RENDERER_HOST
    || parsedUrl.username !== ''
    || parsedUrl.password !== ''
    || parsedUrl.port !== ''
  ) {
    return reject(403, 'invalid-origin');
  }

  const rawPathname = rawUrlPathname(request.url);
  if (rawPathname === null) return reject(400, 'invalid-url');

  let decodedPathname: string;
  try {
    decodedPathname = decodeURIComponent(rawPathname);
  } catch {
    return reject(400, 'invalid-path');
  }

  if (
    !decodedPathname.startsWith('/')
    || UNSAFE_PATH_CHARACTER.test(decodedPathname)
    || decodedPathname.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    return reject(403, 'invalid-path');
  }

  const relativeAssetPath = decodedPathname === '/'
    ? 'index.html'
    : decodedPathname.replace(/^\/+/, '');
  const normalizedRoot = path.resolve(rendererRoot);
  const candidatePath = path.resolve(normalizedRoot, relativeAssetPath);

  if (!isContainedPath(normalizedRoot, candidatePath)) {
    return reject(403, 'invalid-path');
  }

  return {
    ok: true,
    filePath: candidatePath,
    fileUrl: pathToFileURL(candidatePath).toString(),
  };
}

export type RendererAssetFetcher = (fileUrl: string) => Promise<Response>;

function rejectionResponse(rejection: RendererRequestRejection): Response {
  const headers: Record<string, string> = {
    'Cache-Control': 'no-store',
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  };
  if (rejection.status === 405) headers.Allow = 'GET';

  return new Response('Renderer resource unavailable', {
    status: rejection.status,
    headers,
  });
}

/**
 * Build an Electron `protocol.handle` compatible callback while keeping the
 * actual fetch implementation injectable (`electron.net.fetch` in production).
 */
export function createRendererProtocolHandler(
  rendererRoot: string,
  fetchAsset: RendererAssetFetcher,
): (request: RendererProtocolRequest) => Promise<Response> {
  return async (request) => {
    const resolution = resolveRendererRequest(request, rendererRoot);
    if (!resolution.ok) return rejectionResponse(resolution);
    try {
      return await fetchAsset(resolution.fileUrl);
    } catch {
      return rejectionResponse(reject(500, 'asset-unavailable'));
    }
  };
}
