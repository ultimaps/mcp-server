import { describe, expect, it, vi } from 'vitest';

import {
  ApiTransportError,
  buildUrl,
  createApiClient,
  mediaType,
  parseRetryAfter,
  type FetchLike,
} from '../src/api/http.js';
import { loadConfig } from '../src/config.js';

const keyless = loadConfig({}, '1.2.3');
const keyed = loadConfig({ ULTIMAPS_API_KEY: 'um_live_secret' }, '1.2.3');

function respond(status: number, headers: Record<string, string> = {}, body = ''): Response {
  return new Response(body, { status, headers });
}

describe('createApiClient', () => {
  it('identifies itself and keeps the key off discovery calls', async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(respond(200, { 'content-type': 'application/json; charset=utf-8' }, '{}'));
    const client = createApiClient({ config: keyed, fetch });

    const response = await client.request({ method: 'GET', path: '/v1/maps', query: { q: 'france', offset: undefined } });

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api.ultimaps.com/v1/maps?q=france');
    expect(init.headers).toEqual({ 'User-Agent': 'ultimaps-mcp/1.2.3' });
    expect(response.contentType).toBe('application/json');
  });

  it('sends the bearer key and JSON body on authenticated calls only when a key is set', async () => {
    const fetch = vi.fn<FetchLike>().mockImplementation(async () => respond(200));
    await createApiClient({ config: keyed, fetch }).request({ method: 'POST', path: '/v1/renders', body: { mapId: 'world' }, authenticated: true });
    await createApiClient({ config: keyless, fetch }).request({ method: 'POST', path: '/v1/renders', body: { mapId: 'world' }, authenticated: true });

    expect(fetch.mock.calls[0]![1].headers).toMatchObject({ Authorization: 'Bearer um_live_secret', 'Content-Type': 'application/json' });
    expect(fetch.mock.calls[0]![1].body).toBe('{"mapId":"world"}');
    expect(fetch.mock.calls[1]![1].headers).not.toHaveProperty('Authorization');
  });

  it('honours a short Retry-After on 429 exactly once', async () => {
    const fetch = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(respond(429, { 'retry-after': '2' }))
      .mockResolvedValueOnce(respond(429, { 'retry-after': '2' }));
    const sleep = vi.fn().mockResolvedValue(undefined);

    const response = await createApiClient({ config: keyless, fetch, sleep }).request({ method: 'POST', path: '/v1/renders', body: {} });

    expect(sleep).toHaveBeenCalledWith(2000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(429);
  });

  it('surfaces long or missing Retry-After waits without retrying', async () => {
    const cases: Array<Record<string, string>> = [{ 'retry-after': '3600' }, {}];
    for (const headers of cases) {
      const fetch = vi.fn<FetchLike>().mockResolvedValue(respond(429, headers));
      const sleep = vi.fn();
      const response = await createApiClient({ config: keyless, fetch, sleep }).request({ method: 'GET', path: '/v1/maps' });
      expect(response.status).toBe(429);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    }
  });

  it('turns a hung request into a timeout error', async () => {
    const fetch: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });

    const error = await createApiClient({ config: keyless, fetch, timeoutMs: 5 })
      .request({ method: 'GET', path: '/v1/maps' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiTransportError);
    expect((error as ApiTransportError).reason).toBe('timeout');
  });

  it('reports the network cause, not undici\'s "fetch failed"', async () => {
    const failure = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    const fetch = vi.fn<FetchLike>().mockRejectedValue(failure);

    const error = await createApiClient({ config: keyless, fetch }).request({ method: 'GET', path: '/v1/maps' }).catch((e: unknown) => e);

    expect((error as ApiTransportError).reason).toBe('network');
    expect((error as Error).message).toContain('ECONNREFUSED');
  });
});

describe('helpers', () => {
  it('parses Retry-After seconds and dates', () => {
    const now = Date.parse('2026-09-11T12:00:00Z');
    expect(parseRetryAfter('5', now)).toBe(5);
    expect(parseRetryAfter('Fri, 11 Sep 2026 12:01:00 GMT', now)).toBe(60);
    expect(parseRetryAfter('soon', now)).toBeNull();
    expect(parseRetryAfter(null, now)).toBeNull();
  });

  it('normalizes media types and builds query strings', () => {
    expect(mediaType('Application/Problem+JSON; charset=utf-8')).toBe('application/problem+json');
    expect(mediaType(null)).toBe('');
    expect(buildUrl('http://localhost:3001', '/v1/maps/foo%2Fbar', { q: 'Île-de-France', limit: 200, offset: undefined })).toBe(
      'http://localhost:3001/v1/maps/foo%2Fbar?q=%C3%8Ele-de-France&limit=200',
    );
  });
});
