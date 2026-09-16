/**
 * render_map → POST /v1/renders.
 *
 * One endpoint, four response types, branched explicitly: PNG (an inline image
 * block under the client-safe cap, else a file on disk), SVG (a file; inline
 * only when tiny), JSON (a dry run) and problem+json (a tool error). Every
 * success carries a text report for humans and a `structuredContent` twin for
 * agents that branch on data.
 */
import type { CallToolResult, ContentBlock } from '@modelcontextprotocol/server';

import type { ApiResponse } from '../api/http.js';
import { describeApiError } from '../api/problem.js';
import { isRecord } from '../guards.js';
import { keylessEmbedUrl } from '../render/embedUrl.js';
import type { SavedFile } from '../render/files.js';
import {
  choroplethFrom,
  editUrlFrom,
  formatChoropleth,
  formatMatching,
  formatWarnings,
  isMatchingTruncated,
  matchingFromBody,
  matchingFromHeaders,
  parseJsonHeader,
  rateLimitRemaining,
  warningsFrom,
  type ChoroplethPlan,
  type RegionMatching,
  type RenderWarning,
} from '../render/report.js';
import type { ToolDeps } from './deps.js';
import { errorResult, transportErrorResult } from './result.js';

/** Claude Desktop caps tool content near 1 MB; stay clear of it. */
export const INLINE_PNG_MAX_BYTES = 800_000;
/** SVGs embed their fonts, so real ones are multi-MB context bombs. */
export const INLINE_SVG_MAX_BYTES = 100_000;
/** Keyless calls with this many renders left (or fewer) get the key nudge. */
export const KEY_NUDGE_THRESHOLD = 5;
/**
 * Mirrors the API's free-plan limits. This package never imports the API, so
 * a test on the API side reads these lines back and fails if they drift apart. The daily cap is quoted alongside the
 * monthly one because it binds first: 500/month is unreachable in under 10 days.
 */
export const FREE_KEY_MONTHLY_RENDERS = 500;
export const FREE_KEY_DAILY_RENDERS = 50;

export interface RenderOutput {
  [key: string]: unknown;
  renderId: string | null;
  dryRun: boolean;
  format?: 'png' | 'svg';
  regionMatching: RegionMatching;
  matchingTruncated: boolean;
  choropleth?: ChoroplethPlan;
  legend?: unknown;
  warnings: RenderWarning[];
  embedUrl?: string;
  editUrl?: string;
  file?: SavedFile;
  keylessRemaining?: number;
}

export function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Width and height from a PNG's IHDR chunk; undefined for anything that isn't a PNG. */
export function pngDimensions(bytes: Buffer): { width: number; height: number } | undefined {
  if (bytes.length < 24 || bytes.readUInt32BE(0) !== 0x89504e47 || bytes.toString('ascii', 12, 16) !== 'IHDR') {
    return undefined;
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** The map's public id: the response's Content-Disposition filename, else the requested mapId. */
function mapLabel(headers: Headers, args: Record<string, unknown>): string {
  const match = /filename="([^"]+)\.(?:png|svg)"/i.exec(headers.get('content-disposition') ?? '');
  if (match?.[1]) return match[1];
  return typeof args.mapId === 'string' && args.mapId.trim() !== '' ? args.mapId.trim() : 'map';
}

export function keyNudge(hasApiKey: boolean, remaining: number | undefined): string | undefined {
  if (hasApiKey || remaining === undefined || remaining > KEY_NUDGE_THRESHOLD) return undefined;
  const left = `${remaining} keyless render${remaining === 1 ? '' : 's'} left this hour`;
  return `${left}. Set ULTIMAPS_API_KEY (a free key allows ${FREE_KEY_MONTHLY_RENDERS} renders/month, up to ${FREE_KEY_DAILY_RENDERS}/day).`;
}

function trailerLines(output: RenderOutput, hasApiKey: boolean): string[] {
  const lines: string[] = [];
  if (output.embedUrl) {
    lines.push(`Embeddable image URL (no key needed, carries Ultimaps attribution): ${output.embedUrl}`);
  }
  if (output.editUrl) {
    const signIn = hasApiKey ? ' (sign in with an account in the API key\'s workspace)' : '';
    lines.push(`Open in Ultimaps Studio to edit or export: ${output.editUrl}${signIn}`);
  }
  const nudge = keyNudge(hasApiKey, output.keylessRemaining);
  if (nudge) lines.push(nudge);
  if (output.renderId) lines.push(`Render id: ${output.renderId}`);
  return lines;
}

function reportLines(output: RenderOutput): string[] {
  return [
    ...formatMatching(output.regionMatching),
    ...(output.choropleth ? formatChoropleth(output.choropleth) : []),
    ...formatWarnings(output.warnings),
  ];
}

function optional<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

async function imageResult(
  response: ApiResponse,
  args: Record<string, unknown>,
  format: 'png' | 'svg',
  deps: ToolDeps,
): Promise<CallToolResult> {
  const { headers, body } = response;
  const hasApiKey = deps.config.apiKey !== null;
  const label = mapLabel(headers, args);
  const renderId = headers.get('x-ultimaps-render-id');
  const inline = body.length <= (format === 'png' ? INLINE_PNG_MAX_BYTES : INLINE_SVG_MAX_BYTES);

  // Every render goes to disk, inlined or not: terminal clients (Claude Code,
  // most CLIs) can show the model an image block but cannot show it to the
  // human, so the path is the only thing they can actually open.
  let file: SavedFile | undefined;
  let fileError: string | undefined;
  try {
    file = await deps.saveRender({ bytes: body, extension: format, stem: label, renderId });
  } catch (error) {
    fileError = error instanceof Error ? error.message : String(error);
  }
  if (!inline && !file) {
    return errorResult(
      `Rendered ${label} (${formatBytes(body.length)}), but it is too large to show inline and saving it failed: ${fileError}. ` +
        'Try a smaller output.width.',
    );
  }

  const matching = matchingFromHeaders(headers);
  const output: RenderOutput = {
    renderId,
    dryRun: false,
    format,
    regionMatching: matching,
    matchingTruncated: isMatchingTruncated(matching),
    ...optional('choropleth', choroplethFrom(parseJsonHeader(headers, 'x-ultimaps-choropleth'))),
    warnings: warningsFrom(parseJsonHeader(headers, 'x-ultimaps-warnings')),
    ...optional('embedUrl', format === 'png' ? keylessEmbedUrl(deps.config.apiUrl, args, hasApiKey) : undefined),
    ...optional('editUrl', editUrlFrom(headers)),
    ...optional('file', file),
    ...optional('keylessRemaining', hasApiKey ? undefined : rateLimitRemaining(headers)),
  };

  const dimensions = format === 'png' ? pngDimensions(body) : undefined;
  const size = [dimensions ? `${dimensions.width}×${dimensions.height} px` : null, formatBytes(body.length)]
    .filter(Boolean)
    .join(', ');
  let headline = `Rendered ${label} as ${format.toUpperCase()} (${size}).`;
  if (file) {
    headline += inline
      ? ` Saved to ${file.path}.`
      : ` Too large to show inline (limit ${formatBytes(format === 'png' ? INLINE_PNG_MAX_BYTES : INLINE_SVG_MAX_BYTES)}), saved to ${file.path}.`;
  }
  if (fileError) headline += ` Saving a copy to disk failed: ${fileError}.`;

  const content: ContentBlock[] = [];
  if (inline) content.push({ type: 'image', data: body.toString('base64'), mimeType: format === 'png' ? 'image/png' : 'image/svg+xml' });
  content.push({ type: 'text', text: [headline, ...reportLines(output), ...trailerLines(output, hasApiKey)].join('\n') });
  if (output.embedUrl) {
    content.push({
      type: 'resource_link',
      uri: output.embedUrl,
      name: `${label}.png`,
      title: 'Embeddable map image',
      mimeType: 'image/png',
      description: 'Keyless GET URL of this render: publicly cacheable, carries Ultimaps attribution.',
    });
  }
  return { content, structuredContent: output };
}

function legendLines(legend: unknown): string[] {
  if (Array.isArray(legend)) {
    const items = legend.filter(isRecord);
    return items.length > 0 ? ['Legend preview:', ...items.map((item) => `  ${String(item.label)}: ${String(item.color)}`)] : [];
  }
  if (isRecord(legend)) return [`Legend preview (gradient): ${JSON.stringify(legend)}`];
  return [];
}

function dryRunResult(response: ApiResponse, deps: ToolDeps): CallToolResult {
  let payload: unknown;
  try {
    payload = JSON.parse(response.body.toString('utf8'));
  } catch {
    return errorResult('The Ultimaps API returned malformed JSON for the dry run. Try again shortly.');
  }
  const source = isRecord(payload) ? payload : {};
  const hasApiKey = deps.config.apiKey !== null;
  const matching = matchingFromBody(source.regionMatching);

  const output: RenderOutput = {
    renderId: response.headers.get('x-ultimaps-render-id'),
    dryRun: true,
    regionMatching: matching,
    matchingTruncated: false,
    ...optional('choropleth', choroplethFrom(source.choropleth)),
    ...optional('legend', source.legend ?? undefined),
    warnings: warningsFrom(source.warnings),
    ...optional('keylessRemaining', hasApiKey ? undefined : rateLimitRemaining(response.headers)),
  };

  const mapId = typeof source.mapId === 'string' ? source.mapId : 'the map';
  const counts =
    `${matching.matchedKeys ?? 0} region keys matched, ${matching.correctedCount} auto-corrected, ` +
    `${matching.unmatchedCount} unmatched.`;
  const text = [
    `Dry run for ${mapId}: nothing was rendered.`,
    counts,
    ...reportLines(output),
    ...legendLines(output.legend),
    ...trailerLines(output, hasApiKey),
  ].join('\n');
  return { content: [{ type: 'text', text }], structuredContent: output };
}

export function createRenderMap(deps: ToolDeps): (args: unknown) => Promise<CallToolResult> {
  return async function renderMap(args: unknown): Promise<CallToolResult> {
    // Passed through untouched: the API is the validator (spec §6.1).
    const body = isRecord(args) ? args : {};

    let response: ApiResponse;
    try {
      response = await deps.renderQueue(() =>
        deps.api.request({ method: 'POST', path: '/v1/renders', body, authenticated: true }),
      );
    } catch (error) {
      return transportErrorResult(error);
    }
    if (response.status >= 400) return errorResult(describeApiError(response, deps.now()));

    switch (response.contentType) {
      case 'image/png':
        return imageResult(response, body, 'png', deps);
      case 'image/svg+xml':
        return imageResult(response, body, 'svg', deps);
      case 'application/json':
        return dryRunResult(response, deps);
      default:
        return errorResult(
          `Unexpected response from the Ultimaps API: status ${response.status}, content type "${response.contentType || 'none'}".`,
        );
    }
  };
}
