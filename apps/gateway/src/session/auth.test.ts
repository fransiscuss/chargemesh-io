import { beforeAll, expect, it } from 'vitest';
import { authenticateGateway, hashPassword, parseBasicAuth, verifyPassword } from './auth.js';
let hash: string;
beforeAll(async () => {
  hash = await hashPassword('with:colon');
});
const basic = (value: string) => `Basic ${Buffer.from(value).toString('base64')}`;
it('verifies correct passwords and rejects wrong/missing credentials', async () => {
  expect(await authenticateGateway(basic('SIM001:with:colon'), hash)).toBe(true);
  expect(await authenticateGateway(basic('SIM001:wrong'), hash)).toBe(false);
  expect(await authenticateGateway(undefined, hash)).toBe(false);
  expect(await authenticateGateway(basic('SIM001:with:colon'), null)).toBe(false);
});
it('preserves colons and rejects malformed Basic headers', () => {
  expect(parseBasicAuth(basic('user:with:colon'))).toEqual({
    username: 'user',
    password: 'with:colon',
  });
  for (const value of [
    'Bearer abc',
    'Basic ?',
    'Basic Zg',
    'Basic ' + Buffer.from('no colon').toString('base64'),
  ])
    expect(parseBasicAuth(value)).toBeNull();
});
it.each([
  'bad',
  'scrypt$0$8$1$a$b',
  'scrypt$16383$8$1$a$b',
  'scrypt$16384$999$1$a$b',
  'scrypt$16384$8$1$a$b',
])('rejects malformed hashes', async (value) =>
  expect(await verifyPassword('secret', value)).toBe(false),
);
