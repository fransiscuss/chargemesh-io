import { expect, it } from 'vitest';
import { callError, errorCodes } from './errors.js';

it.each(['1.6', '2.0.1'] as const)('accepts the %s error code set', (version) => {
  for (const code of errorCodes[version]) {
    expect(callError('x', code, 'failure', version)).toEqual({
      t: 4,
      id: 'x',
      code,
      description: 'failure',
      details: {},
    });
  }
});
it('defaults to 1.6 and rejects incompatible or unknown codes', () => {
  expect(callError('x', 'NotSupported', 'read-only').code).toBe('NotSupported');
  expect(() => callError('x', 'FormatViolation', 'bad', '1.6')).toThrow();
  expect(() => callError('x', 'FormationViolation', 'bad', '2.0.1')).toThrow();
  expect(() => callError('x', 'OccurrenceConstraintViolation', 'bad', '2.0.1')).toThrow();
  expect(() => callError('x', 'MadeUp', 'bad')).toThrow();
});
