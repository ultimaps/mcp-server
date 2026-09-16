/**
 * get_map_regions → GET /v1/maps/{mapId}. The map
 * header plus regions as {key, title}, 200 per page. `query` is the API's
 * `?q=`, which searches aliases and ids the response never prints — filter
 * wide, emit narrow. Never truncates silently: counts are in every result.
 */
import type { CallToolResult } from '@modelcontextprotocol/server';

import { describeApiError } from '../api/problem.js';
import { isRecord } from '../guards.js';
import type { ToolDeps } from './deps.js';
import { errorResult, textResult, transportErrorResult } from './result.js';

export const REGION_PAGE_SIZE = 200;

const HEADER_FIELDS = ['id', 'title', 'regionType', 'regionTypePlural', 'regionCount', 'labels', 'layers'] as const;

export function formatMapRegions(payload: Record<string, unknown>, query: string | null): string {
  const header = Object.fromEntries(HEADER_FIELDS.filter((field) => field in payload).map((field) => [field, payload[field]]));
  const regions = Array.isArray(payload.regions) ? payload.regions : [];
  const page = isRecord(payload.page) ? payload.page : {};
  const offset = typeof page.offset === 'number' ? page.offset : 0;
  const matched = typeof page.matched === 'number' ? page.matched : regions.length;
  const total = typeof payload.regionCount === 'number' ? payload.regionCount : matched;

  const lines = [JSON.stringify(header)];
  const scope = query ? `${matched} of ${total} regions match ${JSON.stringify(query)}` : `${total} regions`;

  if (regions.length === 0) {
    lines.push(
      matched === 0 && query
        ? `No region matches ${JSON.stringify(query)} (keys, titles and aliases were searched).`
        : `${scope}; none at offset ${offset}.`,
    );
    return lines.join('\n');
  }

  lines.push(`${scope}; showing ${offset + 1}–${offset + regions.length} as {key, title}:`);
  lines.push(...regions.map((region) => JSON.stringify(region)));
  const nextOffset = offset + regions.length;
  if (nextOffset < matched) {
    lines.push(`More regions: call get_map_regions again with offset=${nextOffset}${query ? ' and the same query' : ''}.`);
  }
  return lines.join('\n');
}

export function createGetMapRegions(deps: ToolDeps): (args: unknown) => Promise<CallToolResult> {
  return async function getMapRegions(args: unknown): Promise<CallToolResult> {
    const source = isRecord(args) ? args : {};
    const mapId = typeof source.mapId === 'string' ? source.mapId.trim() : '';
    if (!mapId) return errorResult('`mapId` is required. Call list_maps to find the map id.');
    const query = typeof source.query === 'string' && source.query.trim() !== '' ? source.query.trim() : null;
    const offset = typeof source.offset === 'number' ? source.offset : undefined;

    let response;
    try {
      response = await deps.api.request({
        method: 'GET',
        path: `/v1/maps/${encodeURIComponent(mapId)}`,
        query: { limit: REGION_PAGE_SIZE, offset, q: query ?? undefined },
      });
    } catch (error) {
      return transportErrorResult(error);
    }
    if (response.status >= 400) return errorResult(describeApiError(response, deps.now()));

    let payload: unknown;
    try {
      payload = JSON.parse(response.body.toString('utf8'));
    } catch {
      payload = null;
    }
    if (!isRecord(payload)) return errorResult('The Ultimaps API returned an unexpected map response. Try again shortly.');
    return textResult(formatMapRegions(payload, query));
  };
}
