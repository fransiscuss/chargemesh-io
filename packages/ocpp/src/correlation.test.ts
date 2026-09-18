import { afterEach, expect, it, vi } from 'vitest';
import { PendingCalls } from './correlation.js';

afterEach(() => vi.useRealTimers());
it('resolves once and handles missing IDs', () => {
  const calls = new PendingCalls(() => 123);
  calls.add('x', 'Heartbeat');
  expect(calls.size).toBe(1);
  expect(calls.resolve('x')).toEqual({ action: 'Heartbeat', ts: 123 });
  expect(calls.resolve('x')).toBeUndefined();
  expect(calls.size).toBe(0);
});
it('expires only entries older than the cutoff', () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const calls = new PendingCalls(() => Date.now());
  calls.add('old', 'Heartbeat');
  vi.setSystemTime(100);
  calls.add('boundary', 'Heartbeat', 100);
  calls.add('new', 'Heartbeat', 150);
  calls.sweep(200, 100);
  expect(calls.resolve('old')).toBeUndefined();
  expect(calls.resolve('boundary')).toEqual({ action: 'Heartbeat', ts: 100 });
  expect(calls.resolve('new')).toEqual({ action: 'Heartbeat', ts: 150 });
});
it('supports its default clock and sweep window', () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const calls = new PendingCalls();
  calls.add('x', 'Heartbeat');
  vi.setSystemTime(120_001);
  calls.sweep();
  expect(calls.size).toBe(0);
});
