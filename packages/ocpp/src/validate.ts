import { Ajv } from 'ajv';
import type { ErrorObject } from 'ajv';
import formats from 'ajv-formats';
import * as uriResolver from 'uri-js';
import schemas16 from '../schemas/1.6/schemas.json' with { type: 'json' };
import schemas201 from '../schemas/2.0.1/schemas.json' with { type: 'json' };
import type { OcppVersion } from './versions.js';

export type ValidationResult = {
  valid: boolean;
  errors: Array<ErrorObject | { keyword: 'unknown_action'; action: string }> | null;
};

export function createValidator(version: OcppVersion) {
  // OCA schemas contain annotation keywords outside the core JSON Schema vocabulary.
  // The vendored collection uses legacy urn:Action.req IDs; uri-js accepts them.
  const ajv = new Ajv({ allErrors: true, strict: false, multipleOfPrecision: 8, uriResolver });
  formats.default(ajv);
  ajv.addSchema(version === '1.6' ? schemas16 : schemas201);
  return {
    validate(action: string, kind: 'req' | 'conf', payload: unknown): ValidationResult {
      const validate = ajv.getSchema(`urn:${action}.${kind}`);
      if (!validate) return { valid: false, errors: [{ keyword: 'unknown_action', action }] };
      const valid = validate(payload) === true;
      return { valid, errors: valid ? null : structuredClone(validate.errors ?? []) };
    },
  };
}
