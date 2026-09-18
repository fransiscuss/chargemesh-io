import { expect, it } from 'vitest';
import { getTransactionId, setTransactionId, isFaultStatus } from './fields.js';

it.each(['StopTransaction', 'MeterValues'])(
  'rewrites %s without mutating the shared payload',
  (action) => {
    const payload = Object.freeze({ transactionId: 42, connectorId: 1 });
    expect(getTransactionId(action, payload)).toBe(42);
    expect(setTransactionId(action, payload, 9001)).toEqual({
      transactionId: 9001,
      connectorId: 1,
    });
    expect(payload.transactionId).toBe(42);
  },
);
it('reads transaction IDs on StartTransaction and TransactionEvent', () => {
  expect(getTransactionId('StartTransaction', { transactionId: 42 })).toBe(42);
  expect(getTransactionId('TransactionEvent', { transactionInfo: { transactionId: 'abc' } })).toBe(
    'abc',
  );
  expect(
    getTransactionId('TransactionEvent', { transactionInfo: { transactionId: 42 } }),
  ).toBeUndefined();
});
it.each([
  ['Heartbeat', {}],
  ['MeterValues', {}],
  ['MeterValues', null],
  ['MeterValues', []],
  ['TransactionEvent', { transactionInfo: { transactionId: 'abc' } }],
])('does not invent a transaction ID for %s', (action, payload) => {
  expect(setTransactionId(action as string, payload, 1)).toBe(payload);
});
it('handles absent and irrelevant transaction IDs', () => {
  expect(getTransactionId('Heartbeat', { transactionId: 1 })).toBeUndefined();
  expect(getTransactionId('MeterValues', null)).toBeUndefined();
  expect(getTransactionId('MeterValues', {})).toBeUndefined();
});
it.each([
  ['1.6', 'StatusNotification', { status: 'Faulted', errorCode: 'NoError' }, true],
  ['1.6', 'StatusNotification', { status: 'Available', errorCode: 'GroundFailure' }, true],
  ['1.6', 'StatusNotification', { status: 'Available', errorCode: 'NoError' }, false],
  ['1.6', 'StatusNotification', {}, false],
  ['1.6', 'Heartbeat', { status: 'Faulted' }, false],
  ['1.6', 'StatusNotification', null, false],
  ['2.0.1', 'StatusNotification', { connectorStatus: 'Faulted' }, true],
  ['2.0.1', 'StatusNotification', { connectorStatus: 'Available' }, false],
] as const)('detects faults: %s %s %j', (version, action, payload, expected) => {
  expect(isFaultStatus(version, action, payload)).toBe(expected);
});
