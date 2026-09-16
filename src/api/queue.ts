/**
 * In-process render serialization. MCP clients issue
 * parallel tool calls, and the API allows one keyless render in flight (two
 * keyed) — two parallel render_map calls would otherwise guarantee a 429
 * `concurrency_limit_reached`. A FIFO queue, not retries.
 */
export type TaskRunner = <T>(task: () => Promise<T>) => Promise<T>;

export function createTaskQueue(concurrency: number): TaskRunner {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`Queue concurrency must be a positive integer, got ${concurrency}.`);
  }
  let active = 0;
  const waiting: Array<() => void> = [];

  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active < concurrency) {
      active += 1;
    } else {
      // The finishing task hands its slot over directly, so a caller arriving
      // between the release and the wake-up can never overshoot the limit.
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active -= 1;
    }
  };
}
