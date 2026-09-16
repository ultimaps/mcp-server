import { describe, expect, it } from 'vitest';

import { createGetMapRegions } from '../src/tools/getMapRegions.js';
import { CATALOG_ROW_LIMIT, createListMaps, maxAgeSeconds } from '../src/tools/listMaps.js';
import { NOW, apiResponse, fakeDeps, textOf } from './helpers.js';

function catalog(count: number, total = count) {
  const data = Array.from({ length: count }, (_, i) => ({
    id: `map-${i}`,
    title: `Map ${i}`,
    regionType: 'State',
    layers: ['lakes'],
    regionCount: 50,
    labels: i % 2 === 0,
  }));
  return { data, meta: { matched: count, total } };
}

describe('list_maps', () => {
  it('relays rows verbatim and memoizes the unfiltered catalog for its max-age', async () => {
    let now = NOW;
    const { deps, request } = fakeDeps({
      now: () => now,
      responses: [
        apiResponse(200, catalog(3), { 'cache-control': 'public, max-age=3600' }),
        apiResponse(200, catalog(4), { 'cache-control': 'public, max-age=3600' }),
      ],
    });
    const listMaps = createListMaps(deps);

    const first = textOf((await listMaps({})) as never);
    expect(first).toContain('3 maps.');
    expect(first).toContain('{"id":"map-0","title":"Map 0","regionType":"State","layers":["lakes"],"regionCount":50,"labels":true}');
    expect(request.mock.calls[0]![0]).toEqual({ method: 'GET', path: '/v1/maps', query: { q: undefined } });

    await listMaps({});
    expect(request).toHaveBeenCalledTimes(1);

    now += 3601 * 1000;
    expect(textOf((await listMaps({})) as never)).toContain('4 maps.');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('sends queries to the API, never the memo, and relays matched/total', async () => {
    const { deps, request } = fakeDeps({
      responses: [apiResponse(200, catalog(3)), apiResponse(200, { data: [], meta: { matched: 0, total: 187 } })],
    });
    const listMaps = createListMaps(deps);
    await listMaps({});

    const text = textOf((await listMaps({ query: '  atlantis ' })) as never);

    expect(request.mock.calls[1]![0].query).toEqual({ q: 'atlantis' });
    expect(text).toContain('0 of 187 maps match "atlantis".');
    expect(text).toContain('Try a broader term');
  });

  it('caps an unfiltered catalog above the row limit and steers to query', async () => {
    const { deps } = fakeDeps({ responses: [apiResponse(200, catalog(CATALOG_ROW_LIMIT + 5))] });

    const text = textOf((await createListMaps(deps)({})) as never);

    expect(text).toContain(`Showing the first ${CATALOG_ROW_LIMIT} of ${CATALOG_ROW_LIMIT + 5}. Pass \`query\``);
    expect(text).toContain(`"id":"map-${CATALOG_ROW_LIMIT - 1}"`);
    expect(text).not.toContain(`"id":"map-${CATALOG_ROW_LIMIT}"`);
  });

  it('reads max-age and surfaces API errors', async () => {
    expect(maxAgeSeconds('public, max-age=300')).toBe(300);
    expect(maxAgeSeconds('no-store')).toBe(0);
    expect(maxAgeSeconds(null)).toBe(3600);

    const { deps } = fakeDeps({ responses: [apiResponse(500, { code: 'internal_error', detail: 'An unexpected error occurred.' })] });
    const result = await createListMaps(deps)({});
    expect(result.isError).toBe(true);
    expect(textOf(result as never)).toContain('500 (internal_error)');
  });
});

describe('get_map_regions', () => {
  const header = { id: 'california-counties', title: 'California counties', regionType: 'County', regionTypePlural: 'Counties', layers: [], regionCount: 58, labels: true };

  it('requests a 200-region page with the encoded id and names the next offset', async () => {
    const regions = Array.from({ length: 200 }, (_, i) => ({ key: `K${i}`, title: `Region ${i}` }));
    const { deps, request } = fakeDeps({
      responses: [apiResponse(200, { ...header, regionCount: 3100, regions, page: { offset: 200, limit: 200, matched: 3100 } })],
    });

    const text = textOf((await createGetMapRegions(deps)({ mapId: 'usa/counties', offset: 200 })) as never);

    expect(request.mock.calls[0]![0]).toEqual({ method: 'GET', path: '/v1/maps/usa%2Fcounties', query: { limit: 200, offset: 200, q: undefined } });
    expect(JSON.parse(text.split('\n')[0]!)).toEqual({ ...header, regionCount: 3100 });
    expect(text).toContain('3100 regions; showing 201–400 as {key, title}:');
    expect(text).toContain('More regions: call get_map_regions again with offset=400.');
  });

  it('says plainly when a query matches nothing', async () => {
    const { deps, request } = fakeDeps({ responses: [apiResponse(200, { ...header, regions: [], page: { offset: 0, limit: 200, matched: 0 } })] });

    const text = textOf((await createGetMapRegions(deps)({ mapId: 'california-counties', query: 'Gotham' })) as never);

    expect(request.mock.calls[0]![0].query).toMatchObject({ q: 'Gotham' });
    expect(text).toContain('No region matches "Gotham" (keys, titles and aliases were searched).');
  });

  it('relays unknown_map suggestions and requires a mapId', async () => {
    const { deps } = fakeDeps({ responses: [apiResponse(404, { code: 'unknown_map', detail: 'Unknown map "califronia".', suggestions: ['california-counties'] })] });
    const tool = createGetMapRegions(deps);

    expect(textOf((await tool({ mapId: 'califronia' })) as never)).toContain('Closest map ids: california-counties');
    const missing = await tool({});
    expect(missing.isError).toBe(true);
    expect(textOf(missing as never)).toContain('Call list_maps');
  });
});
