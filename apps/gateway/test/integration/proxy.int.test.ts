import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import WebSocket, { WebSocketServer } from 'ws';
import { MockCsms, SimCharger, runScenario } from '@chargemesh/sim';
import { createGateway } from '../../src/server.js';
import { MemoryConfigStore } from '../../src/config/store.js';
import { hashPassword } from '../../src/session/auth.js';
import { chargerConfig } from '../helpers.js';

let mock: MockCsms;
let gateway: ReturnType<typeof createGateway>;
let config: ReturnType<typeof chargerConfig>;
let url: string;
const chargers: SimCharger[] = [];
const raws: WebSocket[] = [];
beforeEach(async () => {
  mock = await MockCsms.start();
  config = chargerConfig(mock.url);
  gateway = createGateway({
    store: new MemoryConfigStore([config]),
    allowInsecureWs: true,
    logLevel: 'silent',
    upstreamTimeoutMs: 2000,
  });
  url = await gateway.listen(0, '127.0.0.1');
});
afterEach(async () => {
  for (const charger of chargers.splice(0)) await charger.close();
  for (const raw of raws.splice(0)) raw.terminate();
  await gateway.close();
  await mock.close();
});
async function connect(version: '1.6' | '2.0.1' = '1.6', password?: string) {
  const charger = await SimCharger.connect({
    url,
    id: 'SIM001',
    version,
    ...(password === undefined ? {} : { password }),
  });
  chargers.push(charger);
  return charger;
}
it.each(['1.6', '2.0.1'] as const)(
  'forwards a complete %s session with byte-identical traffic',
  async (version) => {
    config.version = version;
    const outgoing: string[] = [];
    const charger = await SimCharger.connect({
      url,
      id: 'SIM001',
      version,
      password: 'pass:through',
      onFrame: (direction, raw) => {
        if (direction === 'out') outgoing.push(raw);
      },
    });
    chargers.push(charger);
    await runScenario(charger, version, 'full-session');
    expect(
      mock.frames.filter((frame) => frame.direction === 'in').map((frame) => frame.raw),
    ).toEqual(outgoing);
    expect(mock.handshakes.get('SIM001')?.authorization).toBe(
      `Basic ${Buffer.from('SIM001:pass:through').toString('base64')}`,
    );
    const health = await gateway.app.inject({ url: '/healthz' });
    expect(health.json()).toEqual({ ok: true, chargersConnected: 1 });
  },
);
it('routes a primary command and its charger response', async () => {
  await connect();
  expect(
    await mock.sendCall('SIM001', 'RemoteStartTransaction', { idTag: 'TEST-TAG' }),
  ).toMatchObject({ t: 3, payload: { status: 'Accepted' } });
});
it('relays primary 401 before accepting the charger', async () => {
  mock.rejectAuth('SIM001');
  await expect(connect()).rejects.toThrow('401');
  expect(gateway.sessions.size).toBe(0);
});
it('returns 502 for an unreachable primary', async () => {
  config.primary!.url = 'ws://127.0.0.1:1';
  await expect(connect()).rejects.toThrow('502');
});
it('closes the charger with 1011 when the primary drops', async () => {
  const charger = await connect();
  const closed = once(charger.socket, 'close');
  mock.dropConnection('SIM001');
  expect((await closed)[0]).toBe(1011);
  await vi.waitFor(() => expect(gateway.sessions.size).toBe(0));
});
it('returns 404 for unknown and case-mismatched identities', async () => {
  await expect(SimCharger.connect({ url, id: 'missing', version: '1.6' })).rejects.toThrow('404');
  await expect(SimCharger.connect({ url, id: 'sim001', version: '1.6' })).rejects.toThrow('404');
});
it('returns 403 for disabled chargers and 502 for missing primary', async () => {
  config.enabled = false;
  await expect(connect()).rejects.toThrow('403');
  config.enabled = true;
  config.primary = null;
  await expect(connect()).rejects.toThrow('502');
});
it('refuses incompatible subprotocols', async () => {
  await expect(connect('2.0.1')).rejects.toThrow('400');
});
it('supports omitted subprotocols and forwards malformed charger traffic unchanged', async () => {
  const raw = new WebSocket(url + '/SIM001/');
  raws.push(raw);
  await once(raw, 'open');
  raw.send('this is not JSON');
  await vi.waitFor(() =>
    expect(mock.frames.some((frame) => frame.raw === 'this is not JSON')).toBe(true),
  );
  expect(mock.handshakes.get('SIM001')?.protocol).toBe('ocpp1.6');
});
it('rejects malformed identity paths', async () => {
  await expect(SimCharger.connect({ url, id: 'a/b', version: '1.6' })).rejects.toThrow('400');
});
it('authenticates gateway passwords and uses the configured upstream identity and secret', async () => {
  config.authMode = 'gateway';
  config.passwordHash = await hashPassword('charger:secret');
  config.primary!.identityOverride = 'OVERRIDE';
  config.primary!.password = 'upstream:secret';
  await expect(connect()).rejects.toThrow('401');
  await expect(connect('1.6', 'wrong')).rejects.toThrow('401');
  const charger = await connect('1.6', 'charger:secret');
  await charger.call('Heartbeat', {});
  expect(mock.handshakes.get('OVERRIDE')?.authorization).toBe(
    `Basic ${Buffer.from('OVERRIDE:upstream:secret').toString('base64')}`,
  );
});
it('does not accept forged forwarded headers on a direct insecure connection', async () => {
  await gateway.close();
  gateway = createGateway({
    store: new MemoryConfigStore([config]),
    allowInsecureWs: false,
    logLevel: 'silent',
  });
  url = await gateway.listen(0, '127.0.0.1');
  await expect(connect()).rejects.toThrow('403');
  const raw = new WebSocket(url + '/SIM001', 'ocpp1.6', {
    headers: { 'Fly-Forwarded-Proto': 'https' },
  });
  raws.push(raw);
  raw.on('error', () => undefined);
  const [request, response] = await once(raw, 'unexpected-response');
  expect(response.statusCode).toBe(403);
  response.resume();
  request.destroy();
  raw.terminate();
});
it('accepts the TLS edge header only when Fly proxy trust is enabled', async () => {
  await gateway.close();
  gateway = createGateway({
    store: new MemoryConfigStore([config]),
    allowInsecureWs: false,
    trustFlyProxy: true,
    logLevel: 'silent',
  });
  url = await gateway.listen(0, '127.0.0.1');
  const raw = new WebSocket(url + '/SIM001', 'ocpp1.6', {
    headers: { 'Fly-Forwarded-Proto': 'https' },
  });
  raws.push(raw);
  await once(raw, 'open');
  expect(gateway.sessions.size).toBe(1);
});
it('closes active chargers with 1001 on shutdown and is idempotent', async () => {
  const charger = await connect();
  const closed = once(charger.socket, 'close');
  await gateway.close();
  expect((await closed)[0]).toBe(1001);
  await gateway.close();
});
it('buffers early primary traffic and forwards malformed upstream frames', async () => {
  const primary = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(primary, 'listening');
  config.primary!.url = `ws://127.0.0.1:${(primary.address() as AddressInfo).port}`;
  primary.on('connection', (socket) => {
    socket.send('bad upstream frame');
    socket.send('[2, "early", "RemoteStartTransaction", {"idTag":"TEST-TAG"}]');
  });
  const received: string[] = [];
  try {
    const charger = await SimCharger.connect({
      url,
      id: 'SIM001',
      version: '1.6',
      onFrame: (direction, raw) => {
        if (direction === 'in') received.push(raw);
      },
    });
    chargers.push(charger);
    await vi.waitFor(() =>
      expect(received).toEqual([
        'bad upstream frame',
        '[2, "early", "RemoteStartTransaction", {"idTag":"TEST-TAG"}]',
      ]),
    );
    await charger.close();
  } finally {
    for (const client of primary.clients) client.terminate();
    await new Promise<void>((resolve) => primary.close(() => resolve()));
  }
});
it('returns 502 when a primary stalls during its handshake', async () => {
  await gateway.close();
  gateway = createGateway({
    store: new MemoryConfigStore([config]),
    allowInsecureWs: true,
    logLevel: 'silent',
    upstreamTimeoutMs: 100,
  });
  url = await gateway.listen(0, '127.0.0.1');
  const stalled = createServer();
  const sockets: Duplex[] = [];
  stalled.on('upgrade', (_req, socket) => sockets.push(socket));
  stalled.listen(0, '127.0.0.1');
  await once(stalled, 'listening');
  config.primary!.url = `ws://127.0.0.1:${(stalled.address() as AddressInfo).port}`;
  try {
    await expect(connect()).rejects.toThrow('502');
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => stalled.close(() => resolve()));
  }
});

it('aborts an in-flight primary handshake during shutdown', async () => {
  const stalled = createServer();
  const sockets: Duplex[] = [];
  const upgrading = new Promise<void>((resolve) => {
    stalled.on('upgrade', (_request, socket) => {
      sockets.push(socket);
      resolve();
    });
  });
  stalled.listen(0, '127.0.0.1');
  await once(stalled, 'listening');
  config.primary!.url = `ws://127.0.0.1:${(stalled.address() as AddressInfo).port}`;
  try {
    const connecting = expect(connect()).rejects.toThrow('502');
    await upgrading;
    await gateway.close();
    await connecting;
    expect(gateway.sessions.size).toBe(0);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => stalled.close(() => resolve()));
  }
});
