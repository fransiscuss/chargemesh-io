import { createValidator } from '@chargemesh/ocpp';
import type { OcppVersion } from '@chargemesh/ocpp';
import type { AsyncInterceptor } from '../pipeline/pipeline.js';

/**
 * Async validator interceptor. Runs before the recorder in the pipeline so the
 * record is written with `valid`/`errors` already set on `ctx.validation`.
 */
export function createValidatorInterceptor(): AsyncInterceptor {
  const cache = new Map<OcppVersion, ReturnType<typeof createValidator>>();
  const get = (version: OcppVersion) => {
    let validator = cache.get(version);
    if (!validator) {
      validator = createValidator(version);
      cache.set(version, validator);
    }
    return validator;
  };
  return (ctx, parsed) => {
    if (!parsed.ok) {
      ctx.validation = {
        valid: false,
        errors: [{ keyword: 'parse_error', error: parsed.error }],
      };
      return;
    }
    const frame = parsed.frame;
    if (frame.t === 2) {
      const result = get(ctx.version).validate(frame.action, 'req', frame.payload);
      ctx.validation = { valid: result.valid, errors: result.errors };
      return;
    }
    if (frame.t === 3) {
      if (ctx.action === null) {
        ctx.validation = {
          valid: false,
          errors: [{ keyword: 'unknown_correlation', uniqueId: frame.id }],
        };
        return;
      }
      const result = get(ctx.version).validate(ctx.action, 'conf', frame.payload);
      ctx.validation = { valid: result.valid, errors: result.errors };
      return;
    }
    // CallError carries no schema; a parseable one is valid.
    ctx.validation = { valid: true, errors: null };
  };
}
