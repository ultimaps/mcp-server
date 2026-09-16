/**
 * Process configuration, read from the MCP client's `env` block.
 * Nothing here is ever logged: the key travels
 * only as the render request's Authorization header.
 */
import { readFileSync } from 'node:fs';

export const DEFAULT_API_URL = 'https://api.ultimaps.com';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * `manifest.json` carries `${user_config.api_key}` and the host substitutes it
 * at install time. What a host does with an optional field the user left blank
 * is not specified: Claude Desktop is expected to substitute an empty string,
 * but a host that passed the placeholder through would turn every render into a
 * 401 on an invalid key. Treat an unsubstituted placeholder as "no key".
 *
 * The key only. ULTIMAPS_API_URL is not in `user_config` and is set by hand, so
 * a placeholder-looking value there is a typo, not a substitution failure:
 * it should fail loudly rather than quietly send the key to DEFAULT_API_URL.
 */
const UNSUBSTITUTED_PLACEHOLDER = /^\$\{[^}]*\}$/;

function readApiKey(env: NodeJS.ProcessEnv): string | null {
  const value = (env.ULTIMAPS_API_KEY ?? '').trim();
  return value === '' || UNSUBSTITUTED_PLACEHOLDER.test(value) ? null : value;
}

export interface ServerConfig {
  /** Origin (+ optional path prefix) without a trailing slash. */
  apiUrl: string;
  apiKey: string | null;
  version: string;
  userAgent: string;
}

export function readPackageVersion(): string {
  // src/ and dist/ are siblings of package.json, so one relative URL serves both.
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
}

export function loadConfig(env: NodeJS.ProcessEnv, version: string): ServerConfig {
  const rawUrl = (env.ULTIMAPS_API_URL ?? '').trim() || DEFAULT_API_URL;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`ULTIMAPS_API_URL is not a valid URL: "${rawUrl}".`);
  }
  // Plain http only for a local dev API — a key must never cross the network unencrypted.
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname))) {
    throw new Error(`ULTIMAPS_API_URL must use https (http is allowed for localhost only): "${rawUrl}".`);
  }

  return {
    apiUrl: `${url.origin}${url.pathname.replace(/\/+$/, '')}`,
    apiKey: readApiKey(env),
    version,
    userAgent: `ultimaps-mcp/${version}`,
  };
}
