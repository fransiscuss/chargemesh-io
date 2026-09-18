import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createValidator } from './validate.js';
import { parseFrame } from './frame.js';
import schemas16 from '../schemas/1.6/schemas.json' with { type: 'json' };
import schemas201 from '../schemas/2.0.1/schemas.json' with { type: 'json' };

describe.each(['1.6', '2.0.1'] as const)('OCPP %s validation', (version) => {
  const validator = createValidator(version);
  const directory = new URL(`../test/fixtures/${version}/`, import.meta.url);
  it.each(readdirSync(directory))('validates request and response in %s', (filename) => {
    const [request, response] = JSON.parse(
      readFileSync(new URL(filename, directory), 'utf8'),
    ) as unknown[];
    const call = parseFrame(JSON.stringify(request));
    const result = parseFrame(JSON.stringify(response));
    if (!call.ok || call.frame.t !== 2 || !result.ok || result.frame.t !== 3)
      throw new Error('Invalid fixture');
    expect(validator.validate(call.frame.action, 'req', call.frame.payload)).toEqual({
      valid: true,
      errors: null,
    });
    expect(validator.validate(call.frame.action, 'conf', result.frame.payload)).toEqual({
      valid: true,
      errors: null,
    });
  });
  it('reports missing fields and invalid enums without mutating payloads', () => {
    const missing = validator.validate('BootNotification', 'req', {});
    expect(missing.valid).toBe(false);
    expect(missing.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ keyword: 'required' })]),
    );
    const payload = Object.freeze({
      status: 'Invalid',
      currentTime: '2026-09-18T00:00:00Z',
      interval: 60,
    });
    const result = validator.validate('BootNotification', 'conf', payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ keyword: 'enum' })]),
    );
    expect(missing.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ keyword: 'required' })]),
    );
  });
  it('rejects unknown actions and invalid timestamps', () => {
    expect(validator.validate('NotAnAction', 'req', {})).toEqual({
      valid: false,
      errors: [{ keyword: 'unknown_action', action: 'NotAnAction' }],
    });
    expect(
      validator.validate('BootNotification', 'conf', {
        status: 'Accepted',
        currentTime: 'yesterday',
        interval: 60,
      }).valid,
    ).toBe(false);
  });
  it('can compile every vendored action schema', () => {
    for (const schema of version === '1.6' ? schemas16 : schemas201) {
      const [action, kind] = schema.$id.slice(4).split('.');
      expect(() => validator.validate(action!, kind as 'req' | 'conf', {})).not.toThrow();
    }
  });
});
