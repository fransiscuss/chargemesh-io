export type BatchWriterSink<T, R> = (rows: T[]) => Promise<R[]>;

export type BatchWriterCounter = { inc: (n?: number) => void };
export type BatchWriterLogger = {
  warn: (message: string, meta?: unknown) => void;
  error: (error: unknown, message: string) => void;
};

export type BatchWriterOptions = {
  maxBatch?: number;
  flushIntervalMs?: number;
  maxQueue?: number;
  initialRetryMs?: number;
  maxRetryMs?: number;
  logger?: BatchWriterLogger;
  counter?: BatchWriterCounter;
};

type QueueEntry<T, R> = {
  row: T;
  resolve: (id: R) => void;
  reject: (error: unknown) => void;
};

/**
 * Bounded async batch writer. Rows resolve with their sink-assigned ids once
 * the batch insert succeeds. Flushes every `flushIntervalMs` or when
 * `maxBatch` rows are queued; `flush()` drains everything with backoff retries.
 */
export class BatchWriter<T, R> {
  private readonly maxBatch: number;
  private readonly maxQueue: number;
  private readonly initialRetryMs: number;
  private readonly maxRetryMs: number;
  private readonly logger: BatchWriterLogger | undefined;
  private readonly counter: BatchWriterCounter | undefined;
  private readonly queue: QueueEntry<T, R>[] = [];
  private readonly timer: ReturnType<typeof setInterval>;
  private active: Promise<void> | null = null;
  private retryAttempt = 0;
  private dropped = 0;
  private closed = false;
  private soon: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly sink: BatchWriterSink<T, R>,
    options: BatchWriterOptions = {},
  ) {
    this.maxBatch = options.maxBatch ?? 200;
    this.maxQueue = options.maxQueue ?? 10_000;
    this.initialRetryMs = options.initialRetryMs ?? 200;
    this.maxRetryMs = options.maxRetryMs ?? 5_000;
    this.logger = options.logger;
    this.counter = options.counter;
    const intervalMs = options.flushIntervalMs ?? 1_000;
    this.timer = setInterval(() => {
      void this.flush().catch((error: unknown) => {
        this.logger?.error(error, 'Recorder background flush failed');
      });
    }, intervalMs);
    (this.timer as unknown as { unref?: () => void }).unref?.();
  }

  get size(): number {
    return this.queue.length;
  }

  get droppedTotal(): number {
    return this.dropped;
  }

  write(row: T): Promise<R> {
    if (this.closed) return Promise.reject(new Error('BatchWriter is closed'));
    if (this.queue.length >= this.maxQueue) {
      const oldest = this.queue.shift();
      // The queue is at capacity, so the shift above always yields an entry.
      oldest?.reject(new Error('recorder queue overflow: dropped oldest event'));
      this.dropped += 1;
      this.counter?.inc(1);
      this.logger?.warn('Recorder queue overflow, dropping oldest event', {
        droppedTotal: this.dropped,
      });
    }
    const promise = new Promise<R>((resolve, reject) => {
      this.queue.push({ row, resolve, reject });
    });
    if (this.queue.length >= this.maxBatch) {
      void this.flush();
    } else if (!this.closed && this.soon === null) {
      // Resolve stragglers on the next tick so pipeline.flush() never waits a
      // full interval; under load the size trigger above batches up to maxBatch.
      this.soon = setTimeout(() => {
        this.soon = null;
        void this.flush().catch((error: unknown) => {
          this.logger?.error(error, 'Recorder background flush failed');
        });
      }, 0);
    }
    return promise;
  }

  /** Drain the queue, retrying failed batches with exponential backoff. */
  flush(): Promise<void> {
    this.active ??= this.drain().finally(() => {
      this.active = null;
    });
    return this.active;
  }

  async close(): Promise<void> {
    this.closed = true;
    clearInterval(this.timer);
    if (this.soon !== null) {
      clearTimeout(this.soon);
      this.soon = null;
    }
    await this.flush();
  }

  private async drain(): Promise<void> {
    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, this.maxBatch);
      try {
        const ids = await this.sink(batch.map((entry) => entry.row));
        batch.forEach((entry, index) => entry.resolve(ids[index] as R));
        this.retryAttempt = 0;
      } catch (error) {
        this.queue.unshift(...batch);
        const delayMs = Math.min(this.initialRetryMs * 2 ** this.retryAttempt, this.maxRetryMs);
        this.retryAttempt += 1;
        this.logger?.error(error, 'Recorder batch write failed, retrying');
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
}

/** Process-wide `recorder_dropped_total` counter for the Prometheus-style metric. */
export function createDropCounter(): BatchWriterCounter & { get: () => number } {
  let total = 0;
  return {
    inc: (n = 1) => {
      total += n;
    },
    get: () => total,
  };
}
