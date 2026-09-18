import { describe, expect, it, vi } from 'vitest';
import { startWorker } from './worker.js';

describe('worker placeholder', () => {
  it('logs startup, stays alive on a heartbeat, and stops cleanly', () => {
    vi.useFakeTimers();
    try {
      const messages: string[] = [];
      const worker = startWorker({ log: (message) => messages.push(message), heartbeatMs: 1000 });
      expect(messages).toEqual(['chargemesh worker started (sinks land in F14)']);
      vi.advanceTimersByTime(60_000);
      worker.stop();
      expect(messages).toEqual([
        'chargemesh worker started (sinks land in F14)',
        'chargemesh worker stopped',
      ]);
      worker.stop();
      expect(messages).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
