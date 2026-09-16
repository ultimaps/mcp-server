/**
 * The MCP server: exactly three read-only tools mapping 1:1 onto /v1.
 */
import {
  McpServer,
  fromJsonSchema,
  type JsonSchemaType,
  type JsonSchemaValidator,
  type jsonSchemaValidator,
} from '@modelcontextprotocol/server';

import {
  GET_MAP_REGIONS_DESCRIPTION,
  LIST_MAPS_DESCRIPTION,
  RENDER_MAP_DESCRIPTION,
  SERVER_INSTRUCTIONS,
} from './descriptions.js';
import {
  GET_MAP_REGIONS_INPUT_SCHEMA,
  LIST_MAPS_INPUT_SCHEMA,
  RENDER_MAP_INPUT_SCHEMA,
  RENDER_MAP_OUTPUT_SCHEMA,
  type JsonSchema,
} from './schema.js';
import type { ToolDeps } from './tools/deps.js';
import { createGetMapRegions } from './tools/getMapRegions.js';
import { createListMaps } from './tools/listMaps.js';
import { createRenderMap } from './tools/renderMap.js';

/**
 * Input schemas are advertised, never enforced (spec §6.1). The API is
 * additive-only: a stale published package that validated locally would reject
 * values the API has since learned to accept. Arguments pass straight through,
 * and the API's 400s carry suggestions the agent can act on.
 *
 * The output schema is this package's own contract, so it IS enforced: a
 * result that drifts from it fails here with a clear message instead of in a
 * client that validates structured content.
 */
export const passThroughValidator: jsonSchemaValidator = {
  getValidator<T>(_schema: JsonSchemaType): JsonSchemaValidator<T> {
    return (input: unknown) => ({ valid: true, data: input as T, errorMessage: undefined });
  },
};

function advertisedInput(json: JsonSchema) {
  return fromJsonSchema(json, passThroughValidator);
}

export function createServer(deps: ToolDeps): McpServer {
  const server = new McpServer(
    { name: 'ultimaps', title: 'Ultimaps', version: deps.config.version, websiteUrl: 'https://ultimaps.com' },
    { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS },
  );

  server.registerTool(
    'list_maps',
    {
      title: 'List maps',
      description: LIST_MAPS_DESCRIPTION,
      inputSchema: advertisedInput(LIST_MAPS_INPUT_SCHEMA),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    createListMaps(deps),
  );

  server.registerTool(
    'get_map_regions',
    {
      title: 'Get map regions',
      description: GET_MAP_REGIONS_DESCRIPTION,
      inputSchema: advertisedInput(GET_MAP_REGIONS_INPUT_SCHEMA),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    createGetMapRegions(deps),
  );

  server.registerTool(
    'render_map',
    {
      title: 'Render map',
      description: RENDER_MAP_DESCRIPTION,
      inputSchema: advertisedInput(RENDER_MAP_INPUT_SCHEMA),
      outputSchema: fromJsonSchema(RENDER_MAP_OUTPUT_SCHEMA),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    createRenderMap(deps),
  );

  return server;
}
