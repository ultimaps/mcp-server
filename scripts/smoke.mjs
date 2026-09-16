#!/usr/bin/env node
/**
 * End-to-end smoke over stdio: spawns the built
 * server and drives every tool against a real API, including a non-ASCII
 * region name through the matching headers. Opt-in and NOT free: it spends
 * one dry run and one render of whatever tier the environment configures.
 *
 *   npm run build
 *   ULTIMAPS_API_URL=http://localhost:3001 node scripts/smoke.mjs
 */
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { fileURLToPath } from 'node:url';

const EXPECTED_TOOLS = ['get_map_regions', 'list_maps', 'render_map'];

function textOf(result) {
  return result.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

function check(condition, message) {
  if (!condition) throw new Error(`smoke failed: ${message}`);
}

function section(title, body) {
  process.stdout.write(`\n── ${title} ──\n${body}\n`);
}

const env = Object.fromEntries(Object.entries(process.env).filter(([, value]) => typeof value === 'string'));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL('../dist/index.js', import.meta.url))],
  env,
  stderr: 'inherit',
});
const client = new Client({ name: 'ultimaps-smoke', version: '0.0.0' });

try {
  await client.connect(transport);

  const { tools } = await client.listTools();
  const names = tools.map((tool) => tool.name).sort();
  check(JSON.stringify(names) === JSON.stringify(EXPECTED_TOOLS), `tools were ${names.join(', ')}`);
  section('tools/list', names.join(', '));

  const maps = await client.callTool({ name: 'list_maps', arguments: { query: 'malta' } });
  check(!maps.isError, textOf(maps));
  const mapId = /"id":"([^"]+)"/.exec(textOf(maps))?.[1];
  check(mapId, 'list_maps found no map for "malta"');
  section('list_maps {query: "malta"}', textOf(maps));

  const regions = await client.callTool({ name: 'get_map_regions', arguments: { mapId, query: 'birz' } });
  check(!regions.isError, textOf(regions));
  section(`get_map_regions {mapId: "${mapId}", query: "birz"}`, textOf(regions));

  // A correct non-ASCII name, a typo to auto-correct and a key that matches nothing.
  const renderArgs = {
    mapId,
    choropleth: { values: { Birżebbuġa: 3, Valetta: 5, Mdina: 1, Atlantis: 2 } },
    title: { text: 'MCP smoke test' },
  };

  const dryRun = await client.callTool({ name: 'render_map', arguments: { ...renderArgs, dryRun: true } });
  check(!dryRun.isError && dryRun.structuredContent?.dryRun === true, textOf(dryRun));
  section('render_map (dryRun)', textOf(dryRun));

  const render = await client.callTool({ name: 'render_map', arguments: renderArgs });
  check(!render.isError, textOf(render));
  const image = render.content.find((block) => block.type === 'image');
  check(image?.mimeType === 'image/png' || render.structuredContent?.file, 'render returned neither an inline PNG nor a file');
  section(
    'render_map',
    `${textOf(render)}\n[content: ${render.content.map((block) => block.type).join(', ')}; image ${image ? `${Math.round((image.data.length * 3) / 4 / 1024)} KB` : 'none'}]`,
  );
  section('structuredContent', JSON.stringify(render.structuredContent, null, 2));
  process.stdout.write('\nsmoke OK\n');
} finally {
  await client.close();
}
