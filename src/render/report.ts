/**
 * The render report: region matching, the resolved choropleth plan, warnings
 * and links, read from response headers (image renders) or JSON bodies (dry
 * runs, errors) and rendered as text for the agent.
 * Everything here is external data — shapes are checked, never trusted.
 */

import { isRecord } from '../guards.js';

/** The API lists at most this many corrections / unmatched keys in X-Ultimaps-Matching. */
export const MATCHING_HEADER_MAX_ISSUES = 5;

export interface CorrectedKey {
  input: string;
  matchedTo: string;
  title: string;
  via: string;
}

export interface UnmatchedKey {
  input: string;
  suggestions: string[];
}

export interface RegionMatching {
  /** Only dry runs and error bodies carry it; image responses send counts. */
  matchedKeys?: number;
  correctedCount: number;
  unmatchedCount: number;
  corrected: CorrectedKey[];
  unmatched: UnmatchedKey[];
}

export interface RenderWarning {
  code: string;
  message: string;
}

export type ChoroplethPlan = Record<string, unknown>;

const PLAN_FIELDS = ['type', 'method', 'classes', 'palette', 'format', 'reason', 'breaks'] as const;

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

export function parseJsonHeader(headers: Headers, name: string): unknown {
  const raw = headers.get(name);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function correctedFrom(value: unknown): CorrectedKey[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => isRecord(item) && isString(item.input) && isString(item.matchedTo))
    .map((item) => ({
      input: item.input as string,
      matchedTo: item.matchedTo as string,
      title: isString(item.title) ? item.title : (item.matchedTo as string),
      via: isString(item.via) ? item.via : 'fuzzy',
    }));
}

function unmatchedFrom(value: unknown): UnmatchedKey[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => isRecord(item) && isString(item.input))
    .map((item) => ({
      input: item.input as string,
      suggestions: Array.isArray(item.suggestions) ? item.suggestions.filter(isString) : [],
    }));
}

/** A full `RegionMatching` object (dry-run body, onUnmatched:"error" problem). */
export function matchingFromBody(value: unknown): RegionMatching {
  const source = isRecord(value) ? value : {};
  const corrected = correctedFrom(source.corrected);
  const unmatched = unmatchedFrom(source.unmatched);
  return {
    ...(typeof source.matchedKeys === 'number' ? { matchedKeys: source.matchedKeys } : {}),
    correctedCount: corrected.length,
    unmatchedCount: unmatched.length,
    corrected,
    unmatched,
  };
}

function headerCount(raw: string | null, listed: number): number {
  const value = Number(raw);
  return raw !== null && Number.isInteger(value) && value >= listed ? value : listed;
}

/** Image responses: exact counts in two headers, the first few issues as JSON in a third (absent = nothing to report). */
export function matchingFromHeaders(headers: Headers): RegionMatching {
  const listed = matchingFromBody(parseJsonHeader(headers, 'x-ultimaps-matching'));
  return {
    correctedCount: headerCount(headers.get('x-ultimaps-corrected'), listed.corrected.length),
    unmatchedCount: headerCount(headers.get('x-ultimaps-unmatched'), listed.unmatched.length),
    corrected: listed.corrected,
    unmatched: listed.unmatched,
  };
}

export function isMatchingTruncated(matching: RegionMatching): boolean {
  return matching.correctedCount > matching.corrected.length || matching.unmatchedCount > matching.unmatched.length;
}

/** Unknown future warning codes are kept verbatim — the enum is additive. */
export function warningsFrom(value: unknown): RenderWarning[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => isRecord(item) && isString(item.code))
    .map((item) => ({ code: item.code as string, message: isString(item.message) ? item.message : '' }));
}

export function choroplethFrom(value: unknown): ChoroplethPlan | undefined {
  if (!isRecord(value)) return undefined;
  const plan = Object.fromEntries(PLAN_FIELDS.filter((field) => value[field] !== undefined).map((field) => [field, value[field]]));
  return Object.keys(plan).length > 0 ? plan : undefined;
}

/** The Studio handoff link: `Link: <url>; rel="edit"` opens the map in Ultimaps Studio. */
export function editUrlFrom(headers: Headers): string | undefined {
  const link = headers.get('link');
  if (!link) return undefined;
  const match = /<([^>]+)>\s*;[^,]*\brel="?edit"?/i.exec(link);
  return match?.[1];
}

export function rateLimitRemaining(headers: Headers): number | undefined {
  const raw = headers.get('x-ratelimit-remaining');
  const value = Number(raw);
  return raw !== null && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function quote(text: string): string {
  return JSON.stringify(text);
}

export function formatMatching(matching: RegionMatching): string[] {
  const lines: string[] = [];
  if (matching.correctedCount > 0) {
    lines.push(`Auto-corrected ${plural(matching.correctedCount, 'region key')}:`);
    for (const item of matching.corrected) {
      const target = item.title === item.matchedTo ? item.title : `${item.title} (${item.matchedTo})`;
      lines.push(`  ${quote(item.input)} → ${target}, ${item.via} match`);
    }
  }
  if (matching.unmatchedCount > 0) {
    lines.push(`${plural(matching.unmatchedCount, 'region key')} matched no region and ${matching.unmatchedCount === 1 ? 'was' : 'were'} skipped:`);
    for (const item of matching.unmatched) {
      const hint = item.suggestions.length > 0 ? `closest: ${item.suggestions.join(', ')}` : 'no close match';
      lines.push(`  ${quote(item.input)}: ${hint}`);
    }
  }
  if (isMatchingTruncated(matching)) {
    lines.push(
      `Only the first ${MATCHING_HEADER_MAX_ISSUES} of each are listed. For the full report call render_map again ` +
        'with the same arguments plus "dryRun": true (no image; it counts against the rate limit).',
    );
  }
  return lines;
}

export function formatChoropleth(plan: ChoroplethPlan): string[] {
  const parts: string[] = [];
  if (plan.type !== undefined) parts.push(`type ${String(plan.type)}`);
  if (plan.method !== undefined && plan.method !== null) parts.push(`method ${String(plan.method)}`);
  if (plan.classes !== undefined) parts.push(`${String(plan.classes)} classes`);
  if (plan.palette !== undefined) parts.push(`palette ${String(plan.palette)}`);
  const lines = [`Choropleth plan: ${parts.join(', ')}.`];
  if (plan.format !== undefined) lines.push(`  Number format: ${JSON.stringify(plan.format)}`);
  if (isString(plan.reason)) lines.push(`  Why: ${plan.reason}`);
  if (Array.isArray(plan.breaks)) lines.push(`  Breaks: ${JSON.stringify(plan.breaks)}`);
  return lines;
}

export function formatWarnings(warnings: RenderWarning[]): string[] {
  if (warnings.length === 0) return [];
  return ['Warnings:', ...warnings.map((warning) => `  ${warning.code}: ${warning.message}`)];
}
