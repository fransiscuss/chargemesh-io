import { expect, it, vi } from 'vitest';
import { Pipeline } from '../pipeline/pipeline.js';
import { Router } from './router.js';
function setup(now = () => 10) {
  const charger = { send: vi.fn() },
    primary = { send: vi.fn() },
    observer = vi.fn();
  const pipeline = new Pipeline([], [observer]);
  const router = new Router({
    chargerId: 'id',
    chargerIdentity: 'SIM001',
    connectionId: 'connection',
    version: '1.6',
    upstreamId: 'primary',
    charger,
    primary,
    pipeline,
    now,
  });
  return { router, charger, primary, observer, pipeline };
}
it.each([
  ['charger', '[2, "x", "Heartbeat", {}]'],
  ['charger', '[3,"x",{}]'],
  ['charger', '[4,"x","InternalError","err",{}]'],
  ['upstream', '[2,"x","Reset",{}]'],
  ['upstream', '[3,"x",{}]'],
  ['upstream', '[4,"x","InternalError","err",{}]'],
] as const)('routes %s %s unchanged', async (source, raw) => {
  const { router, charger, primary, pipeline } = setup();
  router.route(source, raw);
  expect((source === 'charger' ? primary : charger).send).toHaveBeenCalledWith(raw);
  expect((source === 'charger' ? charger : primary).send).not.toHaveBeenCalled();
  await pipeline.flush();
});
it('correlates both directions independently, including identical IDs', async () => {
  let now = 10;
  const { router, pipeline, observer } = setup(() => now);
  router.route('charger', '[2,"same","Heartbeat",{}]');
  router.route('upstream', '[2,"same","Reset",{}]');
  now = 35;
  router.route('upstream', '[3,"same",{}]');
  router.route('charger', '[4,"same","InternalError","err",{}]');
  await pipeline.flush();
  expect(observer.mock.calls[2]![0]).toMatchObject({ action: 'Heartbeat', latencyMs: 25 });
  expect(observer.mock.calls[3]![0]).toMatchObject({ action: 'Reset', latencyMs: 25 });
  expect(router.chargerCalls.size).toBe(0);
  expect(router.upstreamCalls.size).toBe(0);
});
it('forwards malformed frames and expires stale calls', async () => {
  let now = 0;
  const { router, primary, pipeline, observer } = setup(() => now);
  router.route('charger', 'bad JSON');
  router.route('charger', '[2,"old","Heartbeat",{}]');
  expect(primary.send).toHaveBeenCalledWith('bad JSON');
  now = 120_001;
  router.sweep();
  expect(router.chargerCalls.size).toBe(0);
  await pipeline.flush();
  expect(observer.mock.calls[0]![1]).toMatchObject({ ok: false });
});
