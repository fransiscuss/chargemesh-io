import { expect, it } from 'vitest';
import { negotiateSubprotocol, subprotocols } from './versions.js';

it.each(['1.6', '2.0.1'] as const)('negotiates only the configured version %s', (version) => {
  expect(negotiateSubprotocol(['ocpp2.0.1', 'ocpp1.6'], version)).toBe(subprotocols[version]);
  expect(negotiateSubprotocol(['ocpp0.0'], version)).toBeNull();
  expect(negotiateSubprotocol([], version)).toBe(subprotocols[version]);
  expect(negotiateSubprotocol([subprotocols[version].toUpperCase()], version)).toBeNull();
});
