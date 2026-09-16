import { describe, expect, it } from 'vitest';

import { DEFAULT_API_URL, loadConfig, readPackageVersion } from '../src/config.js';

describe('loadConfig', () => {
  it('defaults to the production API, keyless', () => {
    expect(loadConfig({}, '0.1.0')).toEqual({
      apiUrl: DEFAULT_API_URL,
      apiKey: null,
      version: '0.1.0',
      userAgent: 'ultimaps-mcp/0.1.0',
    });
  });

  it('treats a blank key (an unset .mcpb user_config) as keyless', () => {
    expect(loadConfig({ ULTIMAPS_API_KEY: '   ' }, '0.1.0').apiKey).toBeNull();
    expect(loadConfig({ ULTIMAPS_API_KEY: ' um_live_x ' }, '0.1.0').apiKey).toBe('um_live_x');
  });

  it('treats an unsubstituted .mcpb key placeholder as keyless', () => {
    // A host that passes `${user_config.api_key}` through instead of
    // substituting "" would otherwise 401 on every render.
    expect(loadConfig({ ULTIMAPS_API_KEY: '${user_config.api_key}' }, '0.1.0').apiKey).toBeNull();
  });

  it('still rejects a placeholder in the API URL instead of defaulting to production', () => {
    // The URL is set by hand, never substituted, so this is a typo. Silently
    // falling back would send the key to the production API unannounced.
    expect(() => loadConfig({ ULTIMAPS_API_URL: '${user_config.api_url}' }, '0.1.0')).toThrow(/valid URL/);
  });

  it('accepts a local http API and strips trailing slashes', () => {
    expect(loadConfig({ ULTIMAPS_API_URL: 'http://localhost:3001/' }, '0.1.0').apiUrl).toBe('http://localhost:3001');
  });

  it('refuses plain http beyond localhost and malformed URLs', () => {
    expect(() => loadConfig({ ULTIMAPS_API_URL: 'http://api.example.com' }, '0.1.0')).toThrow(/https/);
    expect(() => loadConfig({ ULTIMAPS_API_URL: 'not a url' }, '0.1.0')).toThrow(/valid URL/);
  });

  it('reads the version from package.json', () => {
    expect(readPackageVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
