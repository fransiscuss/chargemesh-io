import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { startHeartbeat } from './heartbeat.js';
afterEach(() => vi.useRealTimers());
it('pings every 30 seconds and terminates after two missed pongs', () => {
  vi.useFakeTimers();
  const leg = Object.assign(new EventEmitter(), { ping: vi.fn(), terminate: vi.fn() });
  const stop = startHeartbeat(leg);
  vi.advanceTimersByTime(30_000);
  expect(leg.ping).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(30_000);
  expect(leg.terminate).not.toHaveBeenCalled();
  vi.advanceTimersByTime(30_000);
  expect(leg.terminate).toHaveBeenCalledOnce();
  stop();
  expect(vi.getTimerCount()).toBe(0);
});
it('resets missed counts on pong and releases listeners on stop', () => {
  vi.useFakeTimers();
  const leg = Object.assign(new EventEmitter(), { ping: vi.fn(), terminate: vi.fn() });
  const stop = startHeartbeat(leg);
  for (let i = 0; i < 5; i++) {
    vi.advanceTimersByTime(30_000);
    leg.emit('pong');
  }
  expect(leg.terminate).not.toHaveBeenCalled();
  stop();
  expect(leg.listenerCount('pong')).toBe(0);
});
