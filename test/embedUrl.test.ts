import { describe, expect, it } from 'vitest';

import { EMBED_URL_MAX_LENGTH, keylessEmbedUrl } from '../src/render/embedUrl.js';

const API = 'https://api.ultimaps.com';
const spec = { mapId: 'united-states', choropleth: { values: { California: 39.5, Texas: 30.5 } } };

describe('keylessEmbedUrl', () => {
  it('encodes the exact spec for keyless PNG renders', () => {
    const url = keylessEmbedUrl(API, spec, false)!;
    expect(url.startsWith(`${API}/v1/renders?spec=`)).toBe(true);
    expect(JSON.parse(new URL(url).searchParams.get('spec')!)).toEqual(spec);
  });

  it('is suppressed when a key is set (the GET twin would be watermarked)', () => {
    expect(keylessEmbedUrl(API, spec, true)).toBeUndefined();
  });

  it('exempts derived heights but not explicit ones over the keyless cap', () => {
    expect(keylessEmbedUrl(API, { ...spec, output: { width: 1600 } }, false)).toBeDefined();
    expect(keylessEmbedUrl(API, { ...spec, output: { width: 1600, height: 1601 } }, false)).toBeUndefined();
    expect(keylessEmbedUrl(API, { ...spec, output: { width: 1601 } }, false)).toBeUndefined();
  });

  it('skips svg, scaled output and dry runs', () => {
    expect(keylessEmbedUrl(API, { ...spec, output: { format: 'svg' } }, false)).toBeUndefined();
    expect(keylessEmbedUrl(API, { ...spec, output: { scale: 2 } }, false)).toBeUndefined();
    expect(keylessEmbedUrl(API, { ...spec, dryRun: true }, false)).toBeUndefined();
  });

  it('gates on the percent-encoded length', () => {
    const values = Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`Region number ${i}`, i]));
    const url = `${API}/v1/renders?spec=${encodeURIComponent(JSON.stringify({ mapId: 'world', choropleth: { values } }))}`;
    expect(url.length).toBeGreaterThan(EMBED_URL_MAX_LENGTH);
    expect(keylessEmbedUrl(API, { mapId: 'world', choropleth: { values } }, false)).toBeUndefined();
  });
});
