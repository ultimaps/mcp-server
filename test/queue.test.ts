import { describe, expect, it } from 'vitest';

import { createTaskQueue } from '../src/api/queue.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function peakConcurrency(concurrency: number, tasks: number): Promise<number> {
  const run = createTaskQueue(concurrency);
  let active = 0;
  let peak = 0;
  const gates = Array.from({ length: tasks }, deferred);
  const all = gates.map((gate) =>
    run(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await gate.promise;
      active -= 1;
    }),
  );
  for (const gate of gates) {
    await new Promise((r) => setTimeout(r, 1));
    gate.resolve();
  }
  await Promise.all(all);
  return peak;
}

describe('createTaskQueue', () => {
  it('serializes keyless renders', async () => {
    expect(await peakConcurrency(1, 4)).toBe(1);
  });

  it('allows two keyed renders in flight', async () => {
    expect(await peakConcurrency(2, 5)).toBe(2);
  });

  it('runs tasks in FIFO order and releases the slot when a task throws', async () => {
    const run = createTaskQueue(1);
    const order: string[] = [];
    const failing = run(async () => {
      order.push('a');
      throw new Error('boom');
    });
    const next = run(async () => {
      order.push('b');
      return 'ok';
    });

    await expect(failing).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
    expect(order).toEqual(['a', 'b']);
  });

  it('rejects a non-positive concurrency', () => {
    expect(() => createTaskQueue(0)).toThrow();
  });
});
