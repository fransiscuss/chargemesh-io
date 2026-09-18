import { expect, it } from 'vitest';
import { parseIdentity } from './identity.js';
it.each([
  ['/ocpp/ABC', 'ABC'],
  ['/ocpp/abc/', 'abc'],
  ['/ocpp/EV%3A01/?q=1', 'EV:01'],
])('normalizes %s', (path, id) => expect(parseIdentity(path)).toBe(id));
it.each([
  '/ocpp/',
  '/ocpp//',
  '/ocpp/a/b',
  '/ocpp/a%2Fb',
  '/ocpp/%',
  '/else/a',
  '/ocpp/%00',
  '/ocpp/a%5Cb',
])('rejects %s', (path) => expect(() => parseIdentity(path)).toThrow());
