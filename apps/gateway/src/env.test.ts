import { expect, it } from 'vitest';
import { parseEnv } from './env.js';
it('reports missing required variables without exposing values', () => {
  expect(() => parseEnv({})).toThrow('DATABASE_URL');
  expect(() => parseEnv({})).toThrow('CREDENTIALS_ENC_KEY');
});
it('validates keys, booleans, defaults and database URLs', () => {
  const env = {
    DATABASE_URL: 'postgres://localhost/test',
    CREDENTIALS_ENC_KEY: Buffer.alloc(32).toString('base64'),
    INTERNAL_API_SECRET: 'a'.repeat(32),
    STREAM_TOKEN_SECRET: 'b'.repeat(32),
    DASHBOARD_ORIGIN: 'https://app.example.com',
  };
  expect(parseEnv(env)).toMatchObject({ ALLOW_INSECURE_WS: false, RETENTION_DAYS: 30, PORT: 8080 });
  expect(parseEnv({ ...env, ALLOW_INSECURE_WS: 'true' }).ALLOW_INSECURE_WS).toBe(true);
  expect(() => parseEnv({ ...env, CREDENTIALS_ENC_KEY: 'bad' })).toThrow('32-byte');
  expect(() => parseEnv({ ...env, DATABASE_URL: 'https://example.com' })).toThrow('PostgreSQL');
});
