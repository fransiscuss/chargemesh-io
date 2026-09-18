import { expect, it } from 'vitest';
import { shutdown } from './shutdown.js';
it('stops accepting, closes with 1001, flushes, then exits', async () => {
  const order: string[] = [];
  await shutdown({
    stopAccepting: () => {
      order.push('stop');
    },
    closeSessions: async (code) => {
      expect(code).toBe(1001);
      order.push('close');
    },
    flush: async () => {
      order.push('flush');
    },
    exit: () => {
      order.push('exit');
    },
  });
  expect(order).toEqual(['stop', 'close', 'flush', 'exit']);
});
