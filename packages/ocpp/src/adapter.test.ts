import { expect, it } from 'vitest';
import { getAdapter } from './adapter.js';

it('does not expose protocol translation', () => {
  expect(getAdapter('1.6', '2.0.1')).toBeNull();
  expect(getAdapter('2.0.1', '1.6')).toBeNull();
  expect(getAdapter('1.6', '1.6')).toBeNull();
});
