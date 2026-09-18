import { afterEach, beforeEach, expect, it } from 'vitest';
import { MockCsms } from './mockCsms.js';
import { SimCharger } from './simCharger.js';

let mock: MockCsms;
let charger: SimCharger | undefined;
beforeEach(async () => {
  mock = await MockCsms.start({ now: () => 0 });
});
afterEach(async () => {
  await charger?.close();
  charger = undefined;
  await mock.close();
});

it('accepts Basic auth and protocol, records both directions with timestamps', async () => {
  charger = await SimCharger.connect({
    url: mock.url,
    id: 'SIM001',
    version: '1.6',
    password: 'with:colon',
    idGenerator: () => 'call-1',
  });
  expect(mock.handshakes.get('SIM001')).toEqual({
    authorization: `Basic ${Buffer.from('SIM001:with:colon').toString('base64')}`,
    protocol: 'ocpp1.6',
  });
  await charger.call('Heartbeat', {});
  expect(mock.frames).toHaveLength(2);
  expect(mock.frames[0]).toMatchObject({
    identity: 'SIM001',
    direction: 'in',
    raw: '[2,"call-1","Heartbeat",{}]',
    ts: 0,
  });
  expect(mock.frames[1]).toMatchObject({
    direction: 'out',
    parsed: {
      ok: true,
      frame: { t: 3, id: 'call-1', payload: { currentTime: '1970-01-01T00:00:00.000Z' } },
    },
  });
});
it('returns configurable replies including a custom transaction ID', async () => {
  mock.setResponse('StartTransaction', { transactionId: 9001, idTagInfo: { status: 'Accepted' } });
  charger = await SimCharger.connect({ url: mock.url, id: 'SIM001', version: '1.6' });
  expect(await charger.call('StartTransaction', {})).toMatchObject({
    t: 3,
    payload: { transactionId: 9001 },
  });
  mock.setResponse('VendorAction', async (call) => ({ echo: call.payload }));
  expect(await charger.call('VendorAction', { value: 7 })).toMatchObject({
    t: 3,
    payload: { echo: { value: 7 } },
  });
});
it('returns HTTP 401 before an upgrade for rejected identities', async () => {
  mock.rejectAuth('DENIED');
  await expect(SimCharger.connect({ url: mock.url, id: 'DENIED', version: '1.6' })).rejects.toThrow(
    '401',
  );
  expect(mock.handshakes.has('DENIED')).toBe(false);
});
it('can drop a connection and reports missing identities', async () => {
  charger = await SimCharger.connect({ url: mock.url, id: 'SIM001', version: '1.6' });
  const closed = new Promise<void>((resolve) => charger!.socket.once('close', () => resolve()));
  mock.dropConnection('SIM001');
  await closed;
  await expect(mock.sendCall('missing', 'Reset', {})).rejects.toThrow('not connected');
});
