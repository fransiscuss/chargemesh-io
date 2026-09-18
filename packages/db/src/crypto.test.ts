import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decrypt, encrypt } from './crypto.js';

describe('credential encryption', () => {
  const key = randomBytes(32);
  it.each(['secret:password', '', 'Unicode 🔌 密码'])('round-trips %j', (plain) => {
    expect(decrypt(encrypt(plain, key), key.toString('base64'))).toBe(plain);
  });
  it('uses a fresh IV for every encryption', () => {
    expect(encrypt('secret', key)).not.toBe(encrypt('secret', key));
  });
  it.each([1, 2, 3])('rejects tampering with envelope part %i', (index) => {
    const parts = encrypt('secret', key).split(':');
    const bytes = Buffer.from(parts[index]!, 'base64');
    bytes[0] = bytes[0]! ^ 1;
    parts[index] = bytes.toString('base64');
    expect(() => decrypt(parts.join(':'), key)).toThrow();
  });
  it('rejects the wrong key', () => {
    expect(() => decrypt(encrypt('secret', key), randomBytes(32))).toThrow();
  });
  it.each(['', 'v2:a:b:c', 'v1:a:b', 'v1:a:b:c:d', 'v1:?:?:?', 'v1:YQ==:YQ==:YQ=='])(
    'rejects malformed envelopes: %j',
    (value) => {
      expect(() => decrypt(value, key)).toThrow();
    },
  );
  it.each([Buffer.alloc(31), Buffer.alloc(33), 'not base64'])(
    'rejects invalid keys',
    (invalidKey) => {
      expect(() => encrypt('secret', invalidKey)).toThrow();
      expect(() => decrypt(encrypt('secret', key), invalidKey)).toThrow();
    },
  );
});
