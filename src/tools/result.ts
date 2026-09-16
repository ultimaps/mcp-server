/** Tool result constructors shared by the three tools. */
import type { CallToolResult } from '@modelcontextprotocol/server';

import { ApiTransportError } from '../api/http.js';

export function textResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] };
}

/** Tool errors are results, not thrown exceptions, so the agent reads the full text. */
export function errorResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

export function transportErrorResult(error: unknown): CallToolResult {
  if (error instanceof ApiTransportError) return errorResult(error.message);
  const detail = error instanceof Error ? error.message : String(error);
  return errorResult(`Unexpected error while calling the Ultimaps API: ${detail}`);
}
