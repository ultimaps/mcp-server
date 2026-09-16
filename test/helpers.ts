import { vi } from 'vitest';

import type { ApiRequest, ApiResponse } from '../src/api/http.js';
import { createTaskQueue } from '../src/api/queue.js';
import { loadConfig } from '../src/config.js';
import type { ToolDeps } from '../src/tools/deps.js';

export const NOW = Date.parse('2026-09-11T12:00:00Z');

export function apiResponse(
  status: number,
  body: Buffer | string | unknown,
  headers: Record<string, string> = {},
): ApiResponse {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const contentType = headers['content-type'] ?? (status >= 400 ? 'application/problem+json' : 'application/json');
  return { status, headers: new Headers({ ...headers, 'content-type': contentType }), contentType, body: bytes };
}

/** A minimal PNG header: signature + IHDR carrying width and height, padded to `size` bytes. */
export function pngBytes(width: number, height: number, size = 64): Buffer {
  const bytes = Buffer.alloc(Math.max(size, 33));
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

export function fakeDeps(options: { apiKey?: string; responses?: ApiResponse[]; now?: () => number } = {}) {
  const queue = [...(options.responses ?? [])];
  const request = vi.fn(async (_request: ApiRequest): Promise<ApiResponse> => {
    const next = queue.shift();
    if (!next) throw new Error('No fake API response queued');
    return next;
  });
  const saveRender = vi.fn<ToolDeps['saveRender']>(async ({ bytes, extension, stem }) => ({
    path: `/tmp/ultimaps-mcp/${stem}.${extension}`,
    bytes: bytes.length,
  }));
  const deps: ToolDeps = {
    config: loadConfig(options.apiKey ? { ULTIMAPS_API_KEY: options.apiKey } : {}, '0.1.0'),
    api: { request },
    renderQueue: createTaskQueue(1),
    saveRender,
    now: options.now ?? (() => NOW),
  };
  return { deps, request, saveRender, queue };
}

export function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}
