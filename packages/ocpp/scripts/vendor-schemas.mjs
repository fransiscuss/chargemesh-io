import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { URL } from 'node:url';

// Mechanical, byte-for-byte vendoring from the lockfile-pinned development dependency.
const require = createRequire(import.meta.url);
const source = new URL('./', import.meta.resolve('ocpp-rpc'));
const packageRoot = new URL('../', import.meta.url);
const upstream = require('ocpp-rpc/package.json');
if (upstream.version !== '2.2.1')
  throw new Error('Review schema updates before changing the pinned version');
for (const [version, filename] of [
  ['1.6', 'ocpp1_6.json'],
  ['2.0.1', 'ocpp2_0_1.json'],
]) {
  const target = new URL(`schemas/${version}/`, packageRoot);
  await mkdir(target, { recursive: true });
  await copyFile(new URL(`lib/schemas/${filename}`, source), new URL('schemas.json', target));
}
await copyFile(new URL('LICENSE.md', source), new URL('schemas/LICENSE.ocpp-rpc.md', packageRoot));
