import { describe, expect, it } from 'vitest';

import {
  choroplethFrom,
  editUrlFrom,
  formatChoropleth,
  formatMatching,
  isMatchingTruncated,
  matchingFromBody,
  matchingFromHeaders,
  rateLimitRemaining,
  warningsFrom,
} from '../src/render/report.js';

/** The API \uXXXX-escapes non-ASCII in JSON headers (Latin-1 header rule). */
function asciiJson(value: unknown): string {
  return JSON.stringify(value).replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

describe('matchingFromHeaders', () => {
  it('treats a missing X-Ultimaps-Matching header as nothing to report', () => {
    const matching = matchingFromHeaders(new Headers({ 'x-ultimaps-corrected': '0', 'x-ultimaps-unmatched': '0' }));
    expect(matching).toEqual({ correctedCount: 0, unmatchedCount: 0, corrected: [], unmatched: [] });
    expect(formatMatching(matching)).toEqual([]);
  });

  it('decodes escaped non-ASCII names and keeps exact counts beyond the first five', () => {
    const unmatched = Array.from({ length: 5 }, (_, i) => ({ input: `Birżebbuġa ${i}`, suggestions: ['Birżebbuġa (MT-05)'] }));
    const headers = new Headers({
      'x-ultimaps-corrected': '1',
      'x-ultimaps-unmatched': '12',
      'x-ultimaps-matching': asciiJson({
        corrected: [{ input: 'Calfornia', matchedTo: 'US-CA', title: 'California', via: 'fuzzy' }],
        unmatched,
      }),
    });

    const matching = matchingFromHeaders(headers);

    expect(matching.unmatchedCount).toBe(12);
    expect(matching.unmatched[0]!.input).toBe('Birżebbuġa 0');
    expect(isMatchingTruncated(matching)).toBe(true);
    const text = formatMatching(matching).join('\n');
    expect(text).toContain('"Calfornia" → California (US-CA), fuzzy match');
    expect(text).toContain('12 region keys matched no region');
    expect(text).toContain('"dryRun": true');
  });

  it('ignores a malformed matching header instead of throwing', () => {
    const matching = matchingFromHeaders(new Headers({ 'x-ultimaps-unmatched': '2', 'x-ultimaps-matching': '{nope' }));
    expect(matching.unmatchedCount).toBe(2);
    expect(matching.unmatched).toEqual([]);
  });
});

describe('body parsing', () => {
  it('reads a dry-run RegionMatching including matchedKeys', () => {
    const matching = matchingFromBody({ matchedKeys: 48, corrected: [], unmatched: [{ input: 'Atlantis', suggestions: [] }, { bogus: true }] });
    expect(matching).toMatchObject({ matchedKeys: 48, unmatchedCount: 1 });
    expect(formatMatching(matching)).toContain('  "Atlantis": no close match');
  });

  it('keeps unknown warning codes verbatim and drops malformed entries', () => {
    expect(warningsFrom([{ code: 'future_code', message: 'hi' }, { message: 'no code' }, 'x'])).toEqual([
      { code: 'future_code', message: 'hi' },
    ]);
    expect(warningsFrom(undefined)).toEqual([]);
  });

  it('picks the plan fields and formats them', () => {
    const plan = choroplethFrom({ type: 'steps', method: 'quantile', classes: 5, palette: 'blues', format: { style: 'decimal' }, extra: 1 });
    expect(plan).toEqual({ type: 'steps', method: 'quantile', classes: 5, palette: 'blues', format: { style: 'decimal' } });
    expect(formatChoropleth(plan!)[0]).toBe('Choropleth plan: type steps, method quantile, 5 classes, palette blues.');
    expect(choroplethFrom(null)).toBeUndefined();
  });
});

describe('header links and limits', () => {
  it('finds the rel="edit" link among others', () => {
    const headers = new Headers({
      link: '<https://ultimaps.com/docs>; rel="help", <https://studio.ultimaps.com/editor?render=abc>; rel="edit"',
    });
    expect(editUrlFrom(headers)).toBe('https://studio.ultimaps.com/editor?render=abc');
    expect(editUrlFrom(new Headers())).toBeUndefined();
  });

  it('reads X-RateLimit-Remaining only when it is a non-negative integer', () => {
    expect(rateLimitRemaining(new Headers({ 'x-ratelimit-remaining': '3' }))).toBe(3);
    expect(rateLimitRemaining(new Headers({ 'x-ratelimit-remaining': 'lots' }))).toBeUndefined();
    expect(rateLimitRemaining(new Headers())).toBeUndefined();
  });
});
