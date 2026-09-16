#!/usr/bin/env node
/**
 * ultimaps-mcp — the stdio entry. stdout belongs to
 * the protocol; every diagnostic goes to stderr.
 */
import { serveStdio } from '@modelcontextprotocol/server/stdio';

import { loadConfig, readPackageVersion, type ServerConfig } from './config.js';
import { createServer } from './server.js';
import { createToolDeps } from './tools/deps.js';

function logError(message: string): void {
  process.stderr.write(`ultimaps-mcp: ${message}\n`);
}

function main(): void {
  let config: ServerConfig;
  try {
    config = loadConfig(process.env, readPackageVersion());
  } catch (error) {
    logError(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  // One set of dependencies for the process: the render queue and the catalog
  // memo must be shared by every server instance the entry creates.
  const deps = createToolDeps(config);
  serveStdio(() => createServer(deps), { onerror: (error) => logError(error.message) });
  logError(`${config.version} ready (${config.apiKey ? 'API key' : 'keyless'}, ${config.apiUrl})`);
}

main();
