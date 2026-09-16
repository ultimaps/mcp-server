/**
 * Thin HTTP client over the public /v1 API.
 *
 * Every call runs under a client deadline (the API's render budget is 30 s;
 * without one a 504 turns into an opaque MCP-side timeout) and identifies
 * itself as `ultimaps-mcp/<version>` so the API can segment MCP traffic. A 429
 * asking for a short wait is retried exactly once; longer waits go back to the
 * agent — it decides, this server never loops.
 */
import type { ServerConfig } from '../config.js';

export const REQUEST_TIMEOUT_MS = 35_000;
/**
 * Covers the API's concurrency (2 s) and render-queue (5 s) Retry-After values.
 * The retry gets a fresh deadline on purpose: shortening it by the wait could
 * abort a render the API is still producing — and billing.
 */
export const MAX_AUTO_RETRY_SECONDS = 10;

export interface ApiRequest {
  method: 'GET' | 'POST';
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  /** Attach the API key. Only renders take one; discovery stays keyless. */
  authenticated?: boolean;
}

export interface ApiResponse {
  status: number;
  headers: Headers;
  /** Lower-cased media type without parameters; '' when absent. */
  contentType: string;
  body: Buffer;
}

export class ApiTransportError extends Error {
  readonly reason: 'timeout' | 'network';

  constructor(reason: 'timeout' | 'network', message: string) {
    super(message);
    this.name = 'ApiTransportError';
    this.reason = reason;
  }
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface ApiClient {
  request(request: ApiRequest): Promise<ApiResponse>;
}

export interface ApiClientOptions {
  config: ServerConfig;
  fetch?: FetchLike;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** Retry-After as seconds: delta-seconds or an HTTP date; null when absent or unparseable. */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? null : Math.max(0, Math.ceil((date - now) / 1000));
}

export function mediaType(header: string | null): string {
  return (header ?? '').split(';')[0]!.trim().toLowerCase();
}

export function buildUrl(apiUrl: string, path: string, query: ApiRequest['query'] = {}): string {
  const url = new URL(`${apiUrl}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function describeNetworkError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  // undici reports "fetch failed" and hides the useful part in `cause`.
  const cause = (error as Error & { cause?: { code?: string; message?: string } }).cause;
  return cause?.code ?? cause?.message ?? error.message;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const { config } = options;
  const fetchImpl: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  async function send(request: ApiRequest): Promise<ApiResponse> {
    const headers: Record<string, string> = { 'User-Agent': config.userAgent };
    if (request.body !== undefined) headers['Content-Type'] = 'application/json';
    if (request.authenticated && config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(buildUrl(config.apiUrl, request.path, request.query), {
        method: request.method,
        headers,
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: controller.signal,
      });
      // The body read stays under the same deadline.
      const body = Buffer.from(await response.arrayBuffer());
      return {
        status: response.status,
        headers: response.headers,
        contentType: mediaType(response.headers.get('content-type')),
        body,
      };
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ApiTransportError(
          'timeout',
          `The Ultimaps API did not respond within ${Math.round(timeoutMs / 1000)} s.`,
        );
      }
      throw new ApiTransportError(
        'network',
        `Could not reach the Ultimaps API at ${config.apiUrl} (${describeNetworkError(error)}).`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async request(request) {
      const first = await send(request);
      if (first.status !== 429) return first;
      const wait = parseRetryAfter(first.headers.get('retry-after'));
      if (wait === null || wait > MAX_AUTO_RETRY_SECONDS) return first;
      await sleep(wait * 1000);
      return send(request);
    },
  };
}
