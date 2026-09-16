import { fromJsonSchema } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';

import { ApiTransportError } from '../src/api/http.js';
import { RENDER_MAP_OUTPUT_SCHEMA } from '../src/schema.js';
import { INLINE_PNG_MAX_BYTES, createRenderMap, keyNudge } from '../src/tools/renderMap.js';
import { apiResponse, fakeDeps, pngBytes, textOf } from './helpers.js';

const outputValidator = fromJsonSchema(RENDER_MAP_OUTPUT_SCHEMA);

function expectValidOutput(structured: unknown): void {
  const result = outputValidator['~standard'].validate(structured) as { issues?: unknown };
  expect(result.issues).toBeUndefined();
}

const args = { mapId: 'united-states', choropleth: { values: { Calfornia: 39.5, Texas: 30.5 } } };

function pngHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'content-type': 'image/png',
    'content-disposition': 'inline; filename="united-states.png"',
    'x-ultimaps-render-id': '3f1c0a52-0000-4000-8000-000000000000',
    'x-ultimaps-corrected': '1',
    'x-ultimaps-unmatched': '0',
    'x-ultimaps-matching': JSON.stringify({
      corrected: [{ input: 'Calfornia', matchedTo: 'US-CA', title: 'California', via: 'fuzzy' }],
      unmatched: [],
    }),
    'x-ultimaps-choropleth': JSON.stringify({ type: 'steps', method: 'quantile', classes: 2, palette: 'blues', format: { style: 'decimal' } }),
    'x-ultimaps-warnings': JSON.stringify([
      { code: 'layer_unavailable', message: 'This map has no "roads" layer.' },
      { code: 'labels_unavailable', message: 'This map ships no region labels.' },
    ]),
    link: '<https://studio.ultimaps.com/editor?render=3f1c0a52>; rel="edit"',
    'x-ratelimit-remaining': '20',
    ...extra,
  };
}

describe('render_map: PNG', () => {
  it('returns an inline image, the text report, the embed link and a valid structured twin', async () => {
    const { deps, request } = fakeDeps({ responses: [apiResponse(200, pngBytes(1200, 742), pngHeaders())] });

    const result = await createRenderMap(deps)(args);

    expect(request).toHaveBeenCalledWith({ method: 'POST', path: '/v1/renders', body: args, authenticated: true });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]).toMatchObject({ type: 'image', mimeType: 'image/png' });
    const text = textOf(result as never);
    expect(text).toContain('Rendered united-states as PNG (1200×742 px');
    expect(text).toContain('"Calfornia" → California (US-CA), fuzzy match');
    expect(text).toContain('Choropleth plan: type steps, method quantile, 2 classes, palette blues.');
    expect(text).toContain('layer_unavailable: This map has no "roads" layer.');
    expect(text).toContain('labels_unavailable: This map ships no region labels.');
    expect(text).toContain('Open in Ultimaps Studio to edit or export: https://studio.ultimaps.com/editor?render=3f1c0a52');
    expect(text).not.toContain('keyless renders left');
    expect(result.content[2]).toMatchObject({ type: 'resource_link', mimeType: 'image/png' });

    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured).toMatchObject({
      renderId: '3f1c0a52-0000-4000-8000-000000000000',
      dryRun: false,
      format: 'png',
      matchingTruncated: false,
      editUrl: 'https://studio.ultimaps.com/editor?render=3f1c0a52',
      keylessRemaining: 20,
    });
    expect(structured.embedUrl).toMatch(/^https:\/\/api\.ultimaps\.com\/v1\/renders\?spec=/);
    // Saved even though it inlined: a terminal client can only show the user the path.
    expect(text).toContain('Saved to /tmp/ultimaps-mcp/united-states.png.');
    expect(structured).toMatchObject({ file: { path: '/tmp/ultimaps-mcp/united-states.png' } });
    expectValidOutput(structured);
  });

  it('passes arguments through untouched, even ones the schema would reject', async () => {
    const { deps, request } = fakeDeps({ responses: [apiResponse(200, pngBytes(10, 10), { 'content-type': 'image/png' })] });
    const unknownField = { mapId: 'world', futureOption: { enabled: true } };

    await createRenderMap(deps)(unknownField);

    expect(request.mock.calls[0]![0].body).toBe(unknownField);
  });

  it('suppresses the embed URL and the nudge for keyed calls and asks keyed users to sign in', async () => {
    const { deps } = fakeDeps({ apiKey: 'um_live_x', responses: [apiResponse(200, pngBytes(1200, 742), pngHeaders({ 'x-ratelimit-remaining': '1' }))] });

    const result = await createRenderMap(deps)(args);

    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured).not.toHaveProperty('embedUrl');
    expect(structured).not.toHaveProperty('keylessRemaining');
    expect(result.content.map((block) => block.type)).toEqual(['image', 'text']);
    const text = textOf(result as never);
    expect(text).not.toContain('ULTIMAPS_API_KEY');
    expect(text).toContain("sign in with an account in the API key's workspace");
  });

  it('nudges keyless callers toward a key when five or fewer renders remain', async () => {
    const { deps } = fakeDeps({ responses: [apiResponse(200, pngBytes(10, 10), pngHeaders({ 'x-ratelimit-remaining': '5' }))] });
    expect(textOf((await createRenderMap(deps)(args)) as never)).toContain(
      '5 keyless renders left this hour. Set ULTIMAPS_API_KEY (a free key allows 500 renders/month, up to 50/day).',
    );
    expect(keyNudge(false, 6)).toBeUndefined();
    expect(keyNudge(false, 1)).toContain('1 keyless render left');
  });

  it('saves an over-cap PNG to disk instead of inlining it, without re-rendering', async () => {
    const big = pngBytes(1600, 2400, INLINE_PNG_MAX_BYTES + 1);
    const { deps, request, saveRender } = fakeDeps({ responses: [apiResponse(200, big, pngHeaders())] });

    const result = await createRenderMap(deps)(args);

    expect(request).toHaveBeenCalledTimes(1);
    expect(saveRender).toHaveBeenCalledWith(expect.objectContaining({ extension: 'png', stem: 'united-states' }));
    expect(result.content.some((block) => block.type === 'image')).toBe(false);
    expect(textOf(result as never)).toContain('Too large to show inline (limit 781 KB), saved to /tmp/ultimaps-mcp/united-states.png.');
    expect(result.structuredContent).toMatchObject({ file: { path: '/tmp/ultimaps-mcp/united-states.png', bytes: big.length } });
    expectValidOutput(result.structuredContent);
  });

  it('fails clearly when an over-cap PNG cannot be saved', async () => {
    const { deps, saveRender } = fakeDeps({ responses: [apiResponse(200, pngBytes(1, 1, INLINE_PNG_MAX_BYTES + 1), pngHeaders())] });
    saveRender.mockRejectedValueOnce(new Error('EACCES'));

    const result = await createRenderMap(deps)(args);

    expect(result.isError).toBe(true);
    expect(textOf(result as never)).toContain('saving it failed: EACCES');
  });

  it('flags a truncated matching report and steers to a dry run', async () => {
    const unmatched = Array.from({ length: 5 }, (_, i) => ({ input: `Nowhere ${i}`, suggestions: [] }));
    const headers = pngHeaders({ 'x-ultimaps-corrected': '0', 'x-ultimaps-unmatched': '9', 'x-ultimaps-matching': JSON.stringify({ corrected: [], unmatched }) });
    const { deps } = fakeDeps({ responses: [apiResponse(200, pngBytes(10, 10), headers)] });

    const result = await createRenderMap(deps)(args);

    expect(result.structuredContent).toMatchObject({ matchingTruncated: true, regionMatching: { unmatchedCount: 9 } });
    expect(textOf(result as never)).toContain('"dryRun": true');
  });
});

describe('render_map: other response types', () => {
  const svgHeaders = { 'content-type': 'image/svg+xml', 'x-ultimaps-render-id': 'r-svg' };

  it('writes a large SVG to disk and never inlines it', async () => {
    const { deps, saveRender } = fakeDeps({ apiKey: 'um_live_pro', responses: [apiResponse(200, Buffer.alloc(2_000_000, 'a'), svgHeaders)] });

    const result = await createRenderMap(deps)({ mapId: 'world', output: { format: 'svg' } });

    expect(saveRender).toHaveBeenCalledWith(expect.objectContaining({ extension: 'svg' }));
    expect(result.content.map((block) => block.type)).toEqual(['text']);
    expect(result.structuredContent).toMatchObject({ format: 'svg', file: { bytes: 2_000_000 } });
  });

  it('inlines a tiny SVG and still saves it', async () => {
    const { deps, saveRender } = fakeDeps({ apiKey: 'um_live_pro', responses: [apiResponse(200, '<svg/>', svgHeaders)] });

    const result = await createRenderMap(deps)({ mapId: 'world', output: { format: 'svg' } });

    expect(saveRender).toHaveBeenCalled();
    expect(result.content[0]).toMatchObject({ type: 'image', mimeType: 'image/svg+xml' });
  });

  it('pretty-prints a dry run: report, plan, legend preview and warnings', async () => {
    const body = {
      dryRun: true,
      mapId: 'united-states',
      choropleth: { type: 'steps', method: 'quantile', classes: 2, palette: 'blues', reason: 'skewed', breaks: [30.5, 35, 39.5], format: { style: 'decimal' } },
      legend: [
        { label: '30.5–35', color: '#c6dbef' },
        { label: '35–39.5', color: '#2171b5' },
      ],
      warnings: [{ code: 'percent_values_look_scaled', message: 'Values look like percent points.' }],
      regionMatching: { matchedKeys: 2, corrected: [{ input: 'Calfornia', matchedTo: 'US-CA', title: 'California', via: 'fuzzy' }], unmatched: [] },
    };
    const { deps } = fakeDeps({ responses: [apiResponse(200, body, { 'x-ratelimit-remaining': '2' })] });

    const result = await createRenderMap(deps)({ ...args, dryRun: true });

    const text = textOf(result as never);
    expect(text).toContain('Dry run for united-states: nothing was rendered.');
    expect(text).toContain('2 region keys matched, 1 auto-corrected, 0 unmatched.');
    expect(text).toContain('  Why: skewed');
    expect(text).toContain('  30.5–35: #c6dbef');
    expect(text).toContain('percent_values_look_scaled');
    expect(text).toContain('2 keyless renders left this hour');
    expect(result.content.map((block) => block.type)).toEqual(['text']);
    expect(result.structuredContent).toMatchObject({ dryRun: true, choropleth: { breaks: [30.5, 35, 39.5] }, regionMatching: { matchedKeys: 2 } });
    expectValidOutput(result.structuredContent);
  });

  it('turns problem+json into a tool error with the full extension surface', async () => {
    const problem = { code: 'unknown_map', detail: 'Unknown map "untied-states".', suggestions: ['united-states'] };
    const { deps } = fakeDeps({ responses: [apiResponse(404, problem, { 'x-ultimaps-render-id': 'r-404' })] });

    const result = await createRenderMap(deps)({ mapId: 'untied-states' });

    expect(result.isError).toBe(true);
    const text = textOf(result as never);
    expect(text).toContain('Closest map ids: united-states');
    expect(text).toContain('r-404');
  });

  it('reports transport failures and unexpected content types as tool errors', async () => {
    const { deps, request } = fakeDeps();
    request.mockRejectedValueOnce(new ApiTransportError('timeout', 'The Ultimaps API did not respond within 35 s.'));
    expect(textOf((await createRenderMap(deps)(args)) as never)).toBe('The Ultimaps API did not respond within 35 s.');

    request.mockResolvedValueOnce(apiResponse(200, 'hello', { 'content-type': 'text/html' }));
    const unexpected = await createRenderMap(deps)(args);
    expect(unexpected.isError).toBe(true);
    expect(textOf(unexpected as never)).toContain('content type "text/html"');
  });
});
