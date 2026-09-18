import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BatchWriter } from './batchWriter.js';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function stringSink() {
  const batches: string[][] = [];
  const sink = vi.fn(async (rows: string[]): Promise<number[]> => {
    batches.push([...rows]);
    return rows.map((_, index) => batches.length * 1000 + index);
  });
  return { batches, sink };
}

it('flushes at 200 rows', async () => {
  const { batches, sink } = stringSink();
  const writer = new BatchWriter(sink, { flushIntervalMs: 60_000 });
  try {
    const pending = Array.from({ length: 200 }, (_, i) => writer.write(`row-${i}`));
    await writer.flush();
    expect(sink).toHaveBeenCalledTimes(1);
    expect(batches[0]).toHaveLength(200);
    await expect(Promise.all(pending)).resolves.toHaveLength(200);
  } finally {
    await writer.close();
  }
});

it('flushes after 1s', async () => {
  const { sink } = stringSink();
  const writer = new BatchWriter(sink, { flushIntervalMs: 1_000 });
  try {
    const pending = writer.write('row-0');
    expect(sink).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sink).toHaveBeenCalledTimes(1);
    await expect(pending).resolves.toBe(1000);
  } finally {
    await writer.close();
  }
});

it('drops the oldest on overflow and increments the counter', async () => {
  const { batches, sink } = stringSink();
  const counter = { inc: vi.fn() };
  const logger = { warn: vi.fn(), error: vi.fn() };
  const writer = new BatchWriter(sink, {
    flushIntervalMs: 60_000,
    maxQueue: 3,
    counter,
    logger,
  });
  try {
    const first = writer.write('row-0');
    // Attach a handler now so the overflow rejection is never unhandled.
    const rejection = expect(first).rejects.toThrow('overflow');
    void writer.write('row-1');
    void writer.write('row-2');
    void writer.write('row-3');
    await rejection;
    expect(writer.droppedTotal).toBe(1);
    expect(counter.inc).toHaveBeenCalledWith(1);
    expect(logger.warn).toHaveBeenCalledOnce();
    await writer.flush();
    expect(batches).toEqual([['row-1', 'row-2', 'row-3']]);
  } finally {
    await writer.close();
  }
});

it('retries after a failure with backoff', async () => {
  const sink = vi.fn(async (rows: string[]): Promise<number[]> => {
    if (sink.mock.calls.length === 1) throw new Error('db down');
    return rows.map(() => 7);
  });
  const logger = { warn: vi.fn(), error: vi.fn() };
  const writer = new BatchWriter(sink, {
    flushIntervalMs: 60_000,
    initialRetryMs: 100,
    maxRetryMs: 1_000,
    logger,
  });
  try {
    const pending = writer.write('row-0');
    const flushing = writer.flush();
    // Let the first attempt fail, then advance past the 100ms backoff.
    await vi.advanceTimersByTimeAsync(100);
    await flushing;
    expect(sink).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledOnce();
    await expect(pending).resolves.toBe(7);
  } finally {
    await writer.close();
  }
});

it('flush() drains everything across multiple batches', async () => {
  const { batches, sink } = stringSink();
  const writer = new BatchWriter(sink, { flushIntervalMs: 60_000, maxBatch: 200 });
  try {
    const pending = Array.from({ length: 450 }, (_, i) => writer.write(`row-${i}`));
    await writer.flush();
    expect(sink).toHaveBeenCalledTimes(3);
    expect(batches.map((batch) => batch.length)).toEqual([200, 200, 50]);
    await expect(Promise.all(pending)).resolves.toHaveLength(450);
    expect(writer.size).toBe(0);
  } finally {
    await writer.close();
  }
});
