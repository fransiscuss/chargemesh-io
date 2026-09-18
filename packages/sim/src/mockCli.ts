import { MockCsms } from './mockCsms.js';

const port = Number(process.env.PORT ?? 9000);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid PORT');
const mock = await MockCsms.start({ port, host: '0.0.0.0' });
console.info(`Mock CSMS listening on ${mock.url}`);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    void mock.close();
  });
