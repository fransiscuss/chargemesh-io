import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createValidator } from '@chargemesh/ocpp';
import { MockCsms } from './mockCsms.js';
import { SimCharger } from './simCharger.js';
import { runScenario } from './scenarios.js';

let mock: MockCsms;
let charger: SimCharger | undefined;
beforeEach(async () => {
  mock = await MockCsms.start();
});
afterEach(async () => {
  vi.useRealTimers();
  await charger?.close();
  charger = undefined;
  await mock.close();
});

it.each(['1.6', '2.0.1'] as const)('completes a valid full-session in %s', async (version) => {
  mock.setResponse('StartTransaction', { transactionId: 9001, idTagInfo: { status: 'Accepted' } });
  charger = await SimCharger.connect({ url: mock.url, id: 'SIM001', version });
  const responses = await runScenario(charger, version, 'full-session', {
    now: () => Date.parse('2026-09-18T00:00:00Z'),
    idGenerator: () => 'transaction-201',
  });
  expect(responses).toHaveLength(version === '1.6' ? 8 : 5);
  const validator = createValidator(version);
  const actions = new Map<string, string>();
  for (const captured of mock.frames) {
    if (!captured.parsed.ok) throw new Error('Unparseable scenario frame');
    const frame = captured.parsed.frame;
    if (frame.t === 2) {
      actions.set(frame.id, frame.action);
      expect(validator.validate(frame.action, 'req', frame.payload).valid).toBe(true);
      if (frame.action === 'StopTransaction' || frame.action === 'MeterValues')
        expect(frame.payload.transactionId).toBe(9001);
    } else if (frame.t === 3) {
      expect(validator.validate(actions.get(frame.id)!, 'conf', frame.payload).valid).toBe(true);
    }
  }
  const calls = mock.frames.flatMap(({ parsed }) =>
    parsed.ok && parsed.frame.t === 2 ? [parsed.frame] : [],
  );
  expect(calls.map((call) => call.action)).toEqual(
    version === '1.6'
      ? [
          'BootNotification',
          'StatusNotification',
          'Authorize',
          'StartTransaction',
          'MeterValues',
          'MeterValues',
          'MeterValues',
          'StopTransaction',
        ]
      : [
          'BootNotification',
          'StatusNotification',
          'TransactionEvent',
          'TransactionEvent',
          'TransactionEvent',
        ],
  );
  if (version === '2.0.1') {
    expect(calls.slice(2).map((call) => call.payload.eventType)).toEqual([
      'Started',
      'Updated',
      'Ended',
    ]);
    expect(calls.slice(2).map((call) => call.payload.seqNo)).toEqual([0, 1, 2]);
  }
});
it('answers CSMS calls with Accepted and supports custom handlers', async () => {
  charger = await SimCharger.connect({ url: mock.url, id: 'SIM001', version: '1.6' });
  expect(
    await mock.sendCall('SIM001', 'RemoteStartTransaction', { idTag: 'TEST-TAG' }),
  ).toMatchObject({ t: 3, payload: { status: 'Accepted' } });
  charger.onCall('Reset', () => ({ status: 'Rejected' }));
  expect(await mock.sendCall('SIM001', 'Reset', { type: 'Soft' })).toMatchObject({
    t: 3,
    payload: { status: 'Rejected' },
  });
  charger.onCall('Fail', () => {
    throw new Error('private details');
  });
  expect(await mock.sendCall('SIM001', 'Fail', {})).toMatchObject({
    t: 4,
    code: 'InternalError',
    description: 'Handler failed',
  });
});
it('rejects an unanswered call on timeout using fake timers', async () => {
  mock.setResponse('Heartbeat', () => null);
  charger = await SimCharger.connect({
    url: mock.url,
    id: 'SIM001',
    version: '1.6',
    timeoutMs: 100,
  });
  vi.useFakeTimers();
  const result = expect(charger.call('Heartbeat', {})).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(100);
  await result;
});
it('supports the boot-only scenario and delays responses', async () => {
  mock.setDelay('BootNotification', 20);
  charger = await SimCharger.connect({ url: mock.url, id: 'SIM001', version: '1.6' });
  expect(await runScenario(charger, '1.6', 'boot')).toHaveLength(1);
});
it('fails rejected boot and authorization scenarios', async () => {
  mock.setResponse('BootNotification', { status: 'Rejected' });
  charger = await SimCharger.connect({ url: mock.url, id: 'SIM001', version: '1.6' });
  await expect(runScenario(charger, '1.6', 'boot')).rejects.toThrow('Boot rejected');
  mock.setResponse('BootNotification', { status: 'Accepted' });
  mock.setResponse('Authorize', { idTagInfo: { status: 'Blocked' } });
  await expect(runScenario(charger, '1.6', 'full-session')).rejects.toThrow(
    'Authorization rejected',
  );
});
it('rejects unsupported URLs before opening a socket', async () => {
  await expect(
    SimCharger.connect({ url: 'http://localhost', id: 'x', version: '1.6' }),
  ).rejects.toThrow('ws://');
});
