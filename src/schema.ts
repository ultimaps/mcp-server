/**
 * Tool schemas. render_map's input is the API-emitted schema (src/generated,
 * checked against the API in its own test suite) with this package's
 * description overrides applied; the discovery tools mirror the API's query
 * parameters. Schemas are advertised, never enforced locally.
 */
import { readFileSync } from 'node:fs';

import { RENDER_MAP_PROPERTY_DESCRIPTIONS } from './descriptions.js';
import { isRecord } from './guards.js';

export type JsonSchema = Record<string, unknown>;

export function loadGeneratedRenderSchema(): JsonSchema {
  // src/ and dist/ are siblings, and the package ships src/generated.
  const url = new URL('../src/generated/render-request.schema.json', import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as JsonSchema;
}

function replaceDescription(node: JsonSchema, segments: string[], description: string, path: string): JsonSchema {
  const [head, ...rest] = segments;
  if (head === undefined) return { ...node, description };
  const properties = node.properties;
  const child = isRecord(properties) ? properties[head] : undefined;
  if (!isRecord(properties) || !isRecord(child)) {
    throw new Error(`Description override targets unknown schema path "${path}".`);
  }
  return { ...node, properties: { ...properties, [head]: replaceDescription(child, rest, description, path) } };
}

/** A copy of `schema` with each dotted property path's description replaced. Unknown paths throw. */
export function withDescriptions(schema: JsonSchema, overrides: Readonly<Record<string, string>>): JsonSchema {
  return Object.entries(overrides).reduce(
    (current, [path, description]) => replaceDescription(current, path.split('.'), description, path),
    schema,
  );
}

export const RENDER_MAP_INPUT_SCHEMA: JsonSchema = withDescriptions(loadGeneratedRenderSchema(), RENDER_MAP_PROPERTY_DESCRIPTIONS);

export const LIST_MAPS_INPUT_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    query: {
      type: 'string',
      maxLength: 100,
      description: 'Search map ids, titles, region types and categories, e.g. "counties", "germany", "africa". Omit to list every map.',
    },
  },
};

export const GET_MAP_REGIONS_INPUT_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['mapId'],
  properties: {
    mapId: {
      type: 'string',
      minLength: 1,
      maxLength: 120,
      description: 'Map id from list_maps, e.g. "united-states", "europe", "united-states-california".',
    },
    query: {
      type: 'string',
      maxLength: 100,
      description: 'Search region keys, titles and aliases, e.g. "saint" or "US-TX". Omit to page through every region.',
    },
    offset: {
      type: 'integer',
      minimum: 0,
      description: 'Skip this many regions. Pages hold 200 regions; use the offset the previous result names.',
    },
  },
};

const STRING = { type: 'string' } as const;
const COUNT = { type: 'integer', minimum: 0 } as const;

/** The `structuredContent` twin of every successful render_map result (spec §4.3). Additive only. */
export const RENDER_MAP_OUTPUT_SCHEMA: JsonSchema = {
  type: 'object',
  required: ['renderId', 'dryRun', 'regionMatching', 'matchingTruncated', 'warnings'],
  properties: {
    renderId: { type: ['string', 'null'], description: 'The API render id; quote it to Ultimaps support.' },
    dryRun: { type: 'boolean' },
    format: { type: 'string', enum: ['png', 'svg'], description: 'Image format; absent on dry runs.' },
    regionMatching: {
      type: 'object',
      required: ['correctedCount', 'unmatchedCount', 'corrected', 'unmatched'],
      properties: {
        matchedKeys: { ...COUNT, description: 'Input keys that resolved. Dry runs only.' },
        correctedCount: { ...COUNT, description: 'Exact number of auto-corrected keys.' },
        unmatchedCount: { ...COUNT, description: 'Exact number of keys that matched no region.' },
        corrected: {
          type: 'array',
          items: {
            type: 'object',
            required: ['input', 'matchedTo', 'title', 'via'],
            properties: { input: STRING, matchedTo: STRING, title: STRING, via: STRING },
          },
        },
        unmatched: {
          type: 'array',
          items: {
            type: 'object',
            required: ['input', 'suggestions'],
            properties: { input: STRING, suggestions: { type: 'array', items: STRING } },
          },
        },
      },
    },
    matchingTruncated: {
      type: 'boolean',
      description: 'True when `corrected`/`unmatched` list only the first 5 of their counts. Repeat the call with dryRun: true for the full report.',
    },
    choropleth: {
      type: 'object',
      description: 'The resolved choropleth plan. Dry runs add `reason` and `breaks`.',
      properties: {
        type: STRING,
        method: { type: ['string', 'null'] },
        classes: COUNT,
        palette: STRING,
        format: { type: 'object' },
        reason: STRING,
        breaks: { type: 'array', items: { type: 'number' } },
      },
    },
    legend: { description: 'Dry runs: legend preview, [{label, color}] or {points, stops} for a gradient.' },
    warnings: {
      type: 'array',
      items: { type: 'object', required: ['code', 'message'], properties: { code: STRING, message: STRING } },
    },
    embedUrl: { ...STRING, description: 'Keyless GET image URL, when the render is shareable that way.' },
    editUrl: { ...STRING, description: 'Opens this map in Ultimaps Studio for editing or export.' },
    file: {
      type: 'object',
      required: ['path', 'bytes'],
      description: 'Set when the image was saved to disk (too large to inline, or SVG).',
      properties: { path: STRING, bytes: COUNT },
    },
    keylessRemaining: { ...COUNT, description: 'Keyless renders left in the current hour.' },
  },
};
