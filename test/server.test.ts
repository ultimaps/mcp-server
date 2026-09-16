import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it } from 'vitest';

import { RENDER_MAP_PROPERTY_DESCRIPTIONS } from '../src/descriptions.js';
import { RENDER_MAP_INPUT_SCHEMA, loadGeneratedRenderSchema, withDescriptions } from '../src/schema.js';
import { createServer } from '../src/server.js';
import { apiResponse, fakeDeps, pngBytes } from './helpers.js';

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function connect(deps: ReturnType<typeof fakeDeps>['deps']) {
  const server = createServer(deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(clientTransport);
  closers.push(() => client.close(), () => server.close());
  return client;
}

function descriptionsOf(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((item) => descriptionsOf(item, found));
  else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'description' && typeof value === 'string') found.push(value);
      else descriptionsOf(value, found);
    }
  }
  return found;
}

describe('MCP server over the protocol', () => {
  it('advertises exactly three read-only tools with the flattened render schema', async () => {
    const client = await connect(fakeDeps().deps);

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual(['get_map_regions', 'list_maps', 'render_map']);
    for (const tool of tools) {
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: true });
      expect(tool.title).toBeTruthy();
    }
    const render = tools.find((tool) => tool.name === 'render_map')!;
    expect(render.inputSchema).toEqual(RENDER_MAP_INPUT_SCHEMA);
    expect(render.inputSchema).not.toHaveProperty('not');
    expect(render.inputSchema).not.toHaveProperty('dependentSchemas');
    expect(render.outputSchema).toBeDefined();
    expect(render.annotations).not.toHaveProperty('idempotentHint');
    expect(tools.find((tool) => tool.name === 'list_maps')!.annotations).toMatchObject({ idempotentHint: true });
  });

  it('never validates arguments locally: schema-invalid input reaches the API', async () => {
    const { deps, request } = fakeDeps({ responses: [apiResponse(200, pngBytes(1200, 800), { 'content-type': 'image/png' })] });
    const client = await connect(deps);

    const result = await client.callTool({ name: 'render_map', arguments: { mapId: 'world', notInTheSchemaYet: 1 } });

    expect(result.isError).toBeFalsy();
    expect(request.mock.calls[0]![0].body).toEqual({ mapId: 'world', notInTheSchemaYet: 1 });
    expect(result.content[0]).toMatchObject({ type: 'image', mimeType: 'image/png' });
    expect(result.structuredContent).toMatchObject({ dryRun: false, format: 'png' });
  });

  it('delivers API errors as tool errors, not protocol errors', async () => {
    const { deps } = fakeDeps({ responses: [apiResponse(400, { code: 'validation_error', detail: 'Use either `choropleth` or `categories`.' })] });
    const client = await connect(deps);

    const result = await client.callTool({ name: 'render_map', arguments: { mapId: 'world', choropleth: {}, categories: {} } });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('Use either `choropleth` or `categories`.');
  });
});

describe('render_map descriptions', () => {
  it('every override targets a real schema path', () => {
    expect(() => withDescriptions(loadGeneratedRenderSchema(), RENDER_MAP_PROPERTY_DESCRIPTIONS)).not.toThrow();
    expect(() => withDescriptions(loadGeneratedRenderSchema(), { 'choropleth.nope': 'x' })).toThrow(/unknown schema path/);
  });

  it('ships no HTTP-flavoured prose (endpoints, response headers, docs sections)', () => {
    const offenders = descriptionsOf(RENDER_MAP_INPUT_SCHEMA).filter((text) => /GET \/v1|POST \/v1|X-Ultimaps-|see Tiers/.test(text));
    expect(offenders).toEqual([]);
  });

  it('does not mutate the generated schema', () => {
    const generated = loadGeneratedRenderSchema();
    const before = JSON.stringify(generated);
    withDescriptions(generated, RENDER_MAP_PROPERTY_DESCRIPTIONS);
    expect(JSON.stringify(generated)).toBe(before);
  });
});
