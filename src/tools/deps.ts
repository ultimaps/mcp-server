/**
 * Process-wide tool dependencies. One instance per process, shared by every
 * server the stdio entry creates, so the render queue and the catalog memo
 * really are process-wide.
 */
import { createApiClient, type ApiClient } from '../api/http.js';
import { createTaskQueue, type TaskRunner } from '../api/queue.js';
import type { ServerConfig } from '../config.js';
import { saveRender } from '../render/files.js';

/** In-flight render limits the API enforces per caller (spec §5). */
export const KEYLESS_RENDER_CONCURRENCY = 1;
export const KEYED_RENDER_CONCURRENCY = 2;

export interface ToolDeps {
  config: ServerConfig;
  api: ApiClient;
  renderQueue: TaskRunner;
  saveRender: typeof saveRender;
  now: () => number;
}

export function createToolDeps(config: ServerConfig, overrides: Partial<ToolDeps> = {}): ToolDeps {
  return {
    config,
    api: createApiClient({ config }),
    renderQueue: createTaskQueue(config.apiKey ? KEYED_RENDER_CONCURRENCY : KEYLESS_RENDER_CONCURRENCY),
    saveRender,
    now: Date.now,
    ...overrides,
  };
}
