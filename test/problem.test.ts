import { describe, expect, it } from 'vitest';

import type { ApiResponse } from '../src/api/http.js';
import { describeApiError, formatDuration } from '../src/api/problem.js';

const NOW = Date.parse('2026-09-11T12:00:00Z');

function problem(status: number, body: unknown, headers: Record<string, string> = {}): ApiResponse {
  return {
    status,
    headers: new Headers(headers),
    contentType: 'application/problem+json',
    body: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

describe('describeApiError', () => {
  it('relays per-parameter errors with their suggestions', () => {
    const text = describeApiError(
      problem(400, {
        code: 'validation_error',
        detail: 'Request validation failed.',
        errors: [{ param: 'choropleth.palette', message: 'Unknown palette "blu".', suggestions: ['blues'] }],
      }),
    );
    expect(text).toContain('Ultimaps API error 400 (validation_error): Request validation failed.');
    expect(text).toContain('  choropleth.palette: Unknown palette "blu". Did you mean: blues?');
  });

  it('keeps the unknown_map self-correction loop', () => {
    expect(describeApiError(problem(404, { code: 'unknown_map', detail: 'Unknown map "frnace".', suggestions: ['france'] }))).toContain(
      'Closest map ids: france. Retry with one of them',
    );
    expect(describeApiError(problem(404, { code: 'unknown_map', detail: 'x', suggestions: [] }))).toContain('Call list_maps');
  });

  it('formats the onUnmatched:"error" region report', () => {
    const text = describeApiError(
      problem(400, {
        code: 'validation_error',
        detail: 'Unmatched region keys.',
        regionMatching: { matchedKeys: 1, corrected: [], unmatched: [{ input: 'Texs', suggestions: ['Texas (US-TX)'] }] },
      }),
    );
    expect(text).toContain('"Texs": closest: Texas (US-TX)');
  });

  it('relays conversion links verbatim and reads Retry-After from the header', () => {
    const text = describeApiError(
      problem(
        429,
        {
          code: 'rate_limit_exceeded',
          detail: 'Keyless limit of 30 renders per hour exceeded. Create a free API key for 500 renders/month.',
          signup_url: 'https://studio.ultimaps.com/account/workspace/api',
        },
        { 'retry-after': '1800', 'x-ultimaps-render-id': 'r-123' },
      ),
      NOW,
    );
    expect(text).toContain('Keyless limit of 30 renders per hour exceeded.');
    expect(text).toContain('Create a free API key: https://studio.ultimaps.com/account/workspace/api');
    expect(text).toContain('Retry after 30 min (2026-09-11T12:30:00Z), not sooner.');
    expect(text).toContain('Render id (quote it to Ultimaps support): r-123');
  });

  it('adds upgrade and quota details, a 401 hint and unknown extensions', () => {
    const quota = describeApiError(
      problem(402, { code: 'monthly_quota_exceeded', detail: 'Quota used.', upgrade_url: 'https://ultimaps.com/#pricing', quota_resets_at: '2026-10-01T00:00:00Z', limit: 500 }),
    );
    expect(quota).toContain('Upgrade to Pro: https://ultimaps.com/#pricing');
    expect(quota).toContain('Quota resets at 2026-10-01T00:00:00Z.');
    expect(quota).toContain('Details: {"limit":500}');

    expect(describeApiError(problem(401, { code: 'unauthorized', detail: 'Invalid API key.' }))).toContain('Check ULTIMAPS_API_KEY');
  });

  it('survives a non-JSON error body', () => {
    expect(describeApiError(problem(502, '<html>Bad gateway</html>'))).toBe('Ultimaps API error 502 (http_502): <html>Bad gateway</html>');
  });
});

describe('formatDuration', () => {
  it('scales from seconds to hours', () => {
    expect(formatDuration(5)).toBe('5 s');
    expect(formatDuration(600)).toBe('10 min');
    expect(formatDuration(3600 * 11 + 60 * 30)).toBe('11 h 30 min');
  });
});
