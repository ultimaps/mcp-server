/**
 * API errors → MCP tool error text.
 *
 * Relays the whole problem+json extension surface, not just `detail`:
 * per-parameter suggestions, unknown_map suggestions (the one-retry
 * self-correction loop), the region report of onUnmatched:"error", the
 * conversion links, Retry-After (a header — the body never carries it) and the
 * render id as the support handle. Unknown extensions are relayed verbatim.
 */
import { parseRetryAfter, type ApiResponse } from './http.js';
import { isRecord } from '../guards.js';
import { formatMatching, matchingFromBody } from '../render/report.js';

const HANDLED_FIELDS = new Set([
  'type',
  'title',
  'status',
  'detail',
  'code',
  'errors',
  'suggestions',
  'regionMatching',
  'upgrade_url',
  'signup_url',
  'quota_resets_at',
]);

function parseProblem(response: ApiResponse): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(response.body.toString('utf8'));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

export function formatDuration(seconds: number): string {
  if (seconds < 90) return `${seconds} s`;
  if (seconds < 90 * 60) return `${Math.ceil(seconds / 60)} min`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.ceil((seconds % 3600) / 60);
  return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
}

function paramErrorLines(errors: unknown): string[] {
  if (!Array.isArray(errors)) return [];
  return errors.filter(isRecord).map((error) => {
    const param = text(error.param) ?? '(request)';
    const suggestions = Array.isArray(error.suggestions) ? error.suggestions.filter((s) => typeof s === 'string') : [];
    const hint = suggestions.length > 0 ? ` Did you mean: ${suggestions.join(', ')}?` : '';
    return `  ${param}: ${text(error.message) ?? 'invalid'}${hint}`;
  });
}

function suggestionLines(code: string, suggestions: unknown): string[] {
  const list = Array.isArray(suggestions) ? suggestions.filter((s) => typeof s === 'string') : [];
  if (code === 'unknown_map') {
    return list.length > 0
      ? [`Closest map ids: ${list.join(', ')}. Retry with one of them, or call list_maps with a query.`]
      : ['Call list_maps with a query (a place or region type) to find the map id.'];
  }
  return list.length > 0 ? [`Suggestions: ${list.join(', ')}`] : [];
}

function retryLines(response: ApiResponse, now: number): string[] {
  const seconds = parseRetryAfter(response.headers.get('retry-after'), now);
  if (seconds === null) return [];
  const at = new Date(now + seconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return [`Retry after ${formatDuration(seconds)} (${at}), not sooner.`];
}

export function describeApiError(response: ApiResponse, now: number = Date.now()): string {
  const problem = parseProblem(response);
  const code = text(problem.code) ?? `http_${response.status}`;
  const summary =
    text(problem.detail) ?? text(problem.title) ?? (response.body.toString('utf8').slice(0, 200).trim() || 'No details.');

  const lines = [`Ultimaps API error ${response.status} (${code}): ${summary}`];
  const paramErrors = paramErrorLines(problem.errors);
  if (paramErrors.length > 0) lines.push('Invalid parameters:', ...paramErrors);
  lines.push(...suggestionLines(code, problem.suggestions));
  if (isRecord(problem.regionMatching)) lines.push(...formatMatching(matchingFromBody(problem.regionMatching)));
  if (response.status === 401) {
    lines.push('Check ULTIMAPS_API_KEY in the MCP client configuration. An invalid key is never downgraded to keyless.');
  }

  const upgradeUrl = text(problem.upgrade_url);
  const signupUrl = text(problem.signup_url);
  if (signupUrl) lines.push(`Create a free API key: ${signupUrl} (then set ULTIMAPS_API_KEY).`);
  if (upgradeUrl) lines.push(`Upgrade to Pro: ${upgradeUrl}`);
  const resetsAt = text(problem.quota_resets_at);
  if (resetsAt) lines.push(`Quota resets at ${resetsAt}.`);
  lines.push(...retryLines(response, now));

  const extra = Object.fromEntries(Object.entries(problem).filter(([key]) => !HANDLED_FIELDS.has(key)));
  if (Object.keys(extra).length > 0) lines.push(`Details: ${JSON.stringify(extra)}`);

  const renderId = response.headers.get('x-ultimaps-render-id');
  if (renderId) lines.push(`Render id (quote it to Ultimaps support): ${renderId}`);
  return lines.join('\n');
}
