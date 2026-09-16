/**
 * list_maps → GET /v1/maps. Rows are relayed
 * verbatim; `query` is the API's server-side `?q=` (it searches fields the
 * catalog does not print, so no client-side filtering). The unfiltered catalog
 * is memoized for the API's own max-age.
 */
import type { CallToolResult } from '@modelcontextprotocol/server';

import { describeApiError } from '../api/problem.js';
import { isRecord } from '../guards.js';
import type { ToolDeps } from './deps.js';
import { errorResult, textResult, transportErrorResult } from './result.js';

/** Context-budget guard: the live catalog (~190 rows) never reaches it today. */
export const CATALOG_ROW_LIMIT = 200;
export const DEFAULT_CATALOG_MAX_AGE_SECONDS = 3600;

interface Catalog {
  rows: unknown[];
  matched: number;
  total: number;
}

export function maxAgeSeconds(cacheControl: string | null): number {
  if (cacheControl === null) return DEFAULT_CATALOG_MAX_AGE_SECONDS;
  if (/\b(no-store|no-cache)\b/i.test(cacheControl)) return 0;
  const match = /\bmax-age=(\d+)/i.exec(cacheControl);
  return match ? Number(match[1]) : DEFAULT_CATALOG_MAX_AGE_SECONDS;
}

function parseCatalog(body: Buffer): Catalog | null {
  try {
    const payload: unknown = JSON.parse(body.toString('utf8'));
    if (!isRecord(payload) || !Array.isArray(payload.data)) return null;
    const meta = isRecord(payload.meta) ? payload.meta : {};
    return {
      rows: payload.data,
      matched: typeof meta.matched === 'number' ? meta.matched : payload.data.length,
      total: typeof meta.total === 'number' ? meta.total : payload.data.length,
    };
  } catch {
    return null;
  }
}

export function formatCatalog(catalog: Catalog, query: string | null): string {
  const lines: string[] = [];
  if (query) {
    lines.push(`${catalog.matched} of ${catalog.total} maps match ${JSON.stringify(query)}.`);
    if (catalog.matched === 0) {
      lines.push('Try a broader term (a country, a continent, "counties", "world"), or call list_maps without a query.');
    }
  } else {
    lines.push(`${catalog.total} maps.`);
  }

  const rows = !query && catalog.rows.length > CATALOG_ROW_LIMIT ? catalog.rows.slice(0, CATALOG_ROW_LIMIT) : catalog.rows;
  if (rows.length < catalog.rows.length) {
    lines.push(`Showing the first ${CATALOG_ROW_LIMIT} of ${catalog.total}. Pass \`query\` to narrow the list.`);
  }
  if (rows.length > 0) {
    lines.push('One map per line: id (the mapId), title, regionType, layers, regionCount, labels.');
    lines.push(...rows.map((row) => JSON.stringify(row)));
  }
  return lines.join('\n');
}

export function createListMaps(deps: ToolDeps): (args: unknown) => Promise<CallToolResult> {
  let memo: { catalog: Catalog; expiresAt: number } | null = null;

  return async function listMaps(args: unknown): Promise<CallToolResult> {
    const rawQuery = isRecord(args) && typeof args.query === 'string' ? args.query.trim() : '';
    const query = rawQuery || null;

    if (!query && memo && memo.expiresAt > deps.now()) {
      return textResult(formatCatalog(memo.catalog, null));
    }

    let response;
    try {
      response = await deps.api.request({ method: 'GET', path: '/v1/maps', query: { q: query ?? undefined } });
    } catch (error) {
      return transportErrorResult(error);
    }
    if (response.status >= 400) return errorResult(describeApiError(response, deps.now()));

    const catalog = parseCatalog(response.body);
    if (!catalog) return errorResult('The Ultimaps API returned an unexpected catalog response. Try again shortly.');

    if (!query) {
      memo = { catalog, expiresAt: deps.now() + maxAgeSeconds(response.headers.get('cache-control')) * 1000 };
    }
    return textResult(formatCatalog(catalog, query));
  };
}
