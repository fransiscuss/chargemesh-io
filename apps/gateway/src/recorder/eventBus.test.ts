import { expect, it, vi } from 'vitest';
import { InProcessEventBus } from './eventBus.js';
import type { OcppEvent } from './eventBuilder.js';

function event(overrides: Partial<OcppEvent> = {}): OcppEvent {
  return {
    id: '1',
    chargerIdentity: 'SIM001',
    connectionId: 'connection-id',
    ts: new Date(0).toISOString(),
    source: 'charger',
    upstreamId: null,
    upstreamRole: null,
    msgType: 2,
    uniqueId: 'x',
    action: 'Heartbeat',
    payload: {},
    valid: true,
    errors: null,
    delivery: { forwardedTo: ['primary-id'] },
    latencyMs: null,
    ...overrides,
  };
}

it('filters by charger and action', () => {
  const bus = new InProcessEventBus();
  const seen = vi.fn();
  bus.subscribe({ chargerIdentity: 'SIM001', action: 'Heartbeat' }, seen);
  bus.publish(event());
  bus.publish(event({ action: 'MeterValues' }));
  bus.publish(event({ chargerIdentity: 'OTHER' }));
  bus.publish(event({ uniqueId: 'y', action: null }));
  expect(seen).toHaveBeenCalledTimes(1);
  expect(seen).toHaveBeenCalledWith(event());
});

it('unsubscribe stops delivery', () => {
  const bus = new InProcessEventBus();
  const seen = vi.fn();
  const unsubscribe = bus.subscribe({}, seen);
  bus.publish(event());
  unsubscribe();
  bus.publish(event());
  expect(seen).toHaveBeenCalledTimes(1);
  expect(bus.subscriberCount).toBe(0);
});

it('a slow or throwing subscriber does not block the others', async () => {
  const bus = new InProcessEventBus();
  const order: string[] = [];
  bus.subscribe({}, () => {
    throw new Error('boom');
  });
  bus.subscribe({}, async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    order.push('slow');
  });
  bus.subscribe({}, () => {
    order.push('fast');
  });
  bus.publish(event());
  expect(order).toEqual(['fast']);
  await vi.waitFor(() => expect(order).toContain('slow'));
});
