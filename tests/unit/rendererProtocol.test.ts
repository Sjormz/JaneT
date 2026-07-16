import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  RENDERER_ORIGIN,
  RENDERER_SCHEME_REGISTRATION,
  createRendererProtocolHandler,
  resolveRendererRequest,
} from '../../src/main/rendererProtocol';

const rendererRoot = path.resolve('/tmp/JaneT renderer/dist/renderer');

describe('renderer protocol registration', () => {
  it('uses a secure standard scheme without bypassing the CSP', () => {
    expect(RENDERER_SCHEME_REGISTRATION).toEqual({
      scheme: 'janet',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        codeCache: true,
      },
    });
    expect(RENDERER_SCHEME_REGISTRATION.privileges).not.toHaveProperty('bypassCSP');
  });
});

describe('resolveRendererRequest', () => {
  it.each([
    [`${RENDERER_ORIGIN}`, 'index.html'],
    [`${RENDERER_ORIGIN}/`, 'index.html'],
    [`${RENDERER_ORIGIN}?next=/assets/not-the-path.js`, 'index.html'],
    [`${RENDERER_ORIGIN}#next=/assets/not-the-path.js`, 'index.html'],
    [`${RENDERER_ORIGIN}/assets/index-AbC123.js`, path.join('assets', 'index-AbC123.js')],
    [`${RENDERER_ORIGIN}/assets/editor%20worker.js?v=1#worker`, path.join('assets', 'editor worker.js')],
    [`${RENDERER_ORIGIN}/assets/%E2%9C%93.css`, path.join('assets', '✓.css')],
  ])('maps %s to a contained renderer asset', (url, expectedRelativePath) => {
    const result = resolveRendererRequest({ method: 'GET', url }, rendererRoot);

    expect(result).toEqual({
      ok: true,
      filePath: path.join(rendererRoot, expectedRelativePath),
      fileUrl: pathToFileURL(path.join(rendererRoot, expectedRelativePath)).toString(),
    });
  });

  it.each(['POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'get', ''])
    ('rejects the non-GET method %j', (method) => {
      expect(resolveRendererRequest({ method, url: `${RENDERER_ORIGIN}/index.html` }, rendererRoot)).toEqual({
        ok: false,
        status: 405,
        reason: 'invalid-method',
      });
    });

  it.each([
    'https://app/index.html',
    'file:///tmp/index.html',
    'janet://other/index.html',
    'janet://app.example/index.html',
    'janet://user@app/index.html',
    'janet://app:8123/index.html',
    'janet:index.html',
  ])('rejects resources outside the exact renderer origin: %s', (url) => {
    const result = resolveRendererRequest({ method: 'GET', url }, rendererRoot);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid-origin');
  });

  it.each([
    `${RENDERER_ORIGIN}/../secrets.txt`,
    `${RENDERER_ORIGIN}/assets/../../secrets.txt`,
    `${RENDERER_ORIGIN}/assets/%2e%2e/secrets.txt`,
    `${RENDERER_ORIGIN}/assets/%2E%2E%2Fsecrets.txt`,
    `${RENDERER_ORIGIN}/assets/%2e/secrets.txt`,
    `${RENDERER_ORIGIN}/assets%5C..%5Csecrets.txt`,
    `${RENDERER_ORIGIN}/assets/%00index.js`,
    `${RENDERER_ORIGIN}/assets/%0Aindex.js`,
  ])('rejects unsafe or traversing path %s', (url) => {
    expect(resolveRendererRequest({ method: 'GET', url }, rendererRoot)).toEqual({
      ok: false,
      status: 403,
      reason: 'invalid-path',
    });
  });

  it('rejects malformed percent encoding without throwing', () => {
    expect(resolveRendererRequest({
      method: 'GET',
      url: `${RENDERER_ORIGIN}/assets/%E0%A4%A.js`,
    }, rendererRoot)).toEqual({
      ok: false,
      status: 400,
      reason: 'invalid-path',
    });
  });

  it.each(['not a URL', '', '://app/index.html'])('rejects malformed URL %j', (url) => {
    expect(resolveRendererRequest({ method: 'GET', url }, rendererRoot)).toEqual({
      ok: false,
      status: 400,
      reason: 'invalid-url',
    });
  });

  it.each(['.', 'dist/renderer', ''])('rejects a relative or missing renderer root %j', (root) => {
    expect(resolveRendererRequest({ method: 'GET', url: `${RENDERER_ORIGIN}/index.html` }, root)).toEqual({
      ok: false,
      status: 500,
      reason: 'invalid-root',
    });
  });
});

describe('createRendererProtocolHandler', () => {
  it('delegates a valid file URL to the injected asset fetcher', async () => {
    const assetResponse = new Response('asset', { status: 200 });
    const fetchAsset = vi.fn(async () => assetResponse);
    const handler = createRendererProtocolHandler(rendererRoot, fetchAsset);

    const response = await handler({
      method: 'GET',
      url: `${RENDERER_ORIGIN}/assets/index.js`,
    });

    expect(response).toBe(assetResponse);
    expect(fetchAsset).toHaveBeenCalledOnce();
    expect(fetchAsset).toHaveBeenCalledWith(
      pathToFileURL(path.join(rendererRoot, 'assets', 'index.js')).toString(),
    );
  });

  it('returns a generic 405 response without invoking the fetcher', async () => {
    const fetchAsset = vi.fn(async () => new Response('asset'));
    const handler = createRendererProtocolHandler(rendererRoot, fetchAsset);

    const response = await handler({ method: 'POST', url: `${RENDERER_ORIGIN}/index.html` });

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await response.text()).toBe('Renderer resource unavailable');
    expect(fetchAsset).not.toHaveBeenCalled();
  });

  it('does not disclose the renderer root in invalid-request responses', async () => {
    const fetchAsset = vi.fn(async () => new Response('asset'));
    const handler = createRendererProtocolHandler(rendererRoot, fetchAsset);

    const response = await handler({
      method: 'GET',
      url: `${RENDERER_ORIGIN}/assets/%2e%2e/secrets.txt`,
    });

    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain(rendererRoot);
    expect(fetchAsset).not.toHaveBeenCalled();
  });

  it('returns a generic 500 response when the asset fetch fails', async () => {
    const fetchAsset = vi.fn(async () => {
      throw new Error(`missing asset below ${rendererRoot}`);
    });
    const handler = createRendererProtocolHandler(rendererRoot, fetchAsset);

    const response = await handler({
      method: 'GET',
      url: `${RENDERER_ORIGIN}/assets/missing.js`,
    });

    expect(response.status).toBe(500);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('Renderer resource unavailable');
  });
});
