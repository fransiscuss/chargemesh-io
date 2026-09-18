import { SimCharger, runScenario } from '@chargemesh/sim';
import { createGateway, MemoryConfigStore } from '../dist/index.js';

const gateway = createGateway({
  allowInsecureWs: true,
  logLevel: 'silent',
  store: new MemoryConfigStore([
    {
      id: 'local-qa-charger',
      identity: 'SIM001',
      version: '1.6',
      enabled: true,
      authMode: 'passthrough',
      passwordHash: null,
      primary: {
        id: 'local-steve',
        url: 'ws://localhost:8180/steve/websocket/CentralSystemService',
        identityOverride: null,
        password: null,
      },
    },
  ]),
});
const url = await gateway.listen(0, '127.0.0.1');
let charger;
try {
  charger = await SimCharger.connect({ url, id: 'SIM001', version: '1.6' });
  const responses = await runScenario(charger, '1.6', 'full-session');
  if (responses.length !== 8) throw new Error('Incomplete SteVe session');
  console.info('Gateway → SteVe: completed all eight simulator calls');
} finally {
  await charger?.close();
  await gateway.close();
}
