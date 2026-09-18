import { expect, it } from 'vitest';
import { parseFrame } from '@chargemesh/ocpp';
import { buildEvent } from './eventBuilder.js';
import { createValidatorInterceptor } from './validator.js';
import { frameContext } from '../../test/helpers.js';

it('maps a CALL to its action with Router-resolved latency untouched', () => {
  const ctx = frameContext();
  const parsed = parseFrame(ctx.raw);
  const event = buildEvent(ctx, parsed);
  expect(event).toMatchObject({
    chargerIdentity: 'SIM001',
    connectionId: 'connection-id',
    source: 'charger',
    msgType: 2,
    uniqueId: 'x',
    action: 'Heartbeat',
    payload: {},
    latencyMs: null,
  });
  expect(event.ts).toBe(new Date(0).toISOString());
});

it('resolves CALLRESULT action and latency from the Router context', () => {
  const ctx = frameContext();
  ctx.source = 'upstream';
  ctx.action = 'BootNotification';
  ctx.latencyMs = 25;
  ctx.raw = '[3, "x", {"status":"Accepted"}]';
  const event = buildEvent(ctx, parseFrame(ctx.raw));
  expect(event).toMatchObject({
    msgType: 3,
    uniqueId: 'x',
    action: 'BootNotification',
    latencyMs: 25,
  });
});

it('leaves an unmatched CALLRESULT with action=null and flags it invalid', () => {
  const ctx = frameContext();
  ctx.source = 'upstream';
  ctx.action = null;
  ctx.latencyMs = null;
  ctx.raw = '[3, "ghost", {}]';
  const parsed = parseFrame(ctx.raw);
  createValidatorInterceptor()(ctx, parsed);
  const event = buildEvent(ctx, parsed);
  expect(event.action).toBeNull();
  expect(event.valid).toBe(false);
  expect(event.errors).toEqual([{ keyword: 'unknown_correlation', uniqueId: 'ghost' }]);
});

it('marks malformed frames valid=false with nullable envelope fields and retained raw', () => {
  const ctx = frameContext();
  ctx.raw = 'this is not JSON';
  ctx.action = null;
  const parsed = parseFrame(ctx.raw);
  createValidatorInterceptor()(ctx, parsed);
  expect(parsed.ok).toBe(false);
  const event = buildEvent(ctx, parsed);
  expect(event).toMatchObject({
    msgType: null,
    uniqueId: null,
    action: null,
    valid: false,
  });
  expect(event.errors).toEqual([{ keyword: 'parse_error', error: 'invalid_json' }]);
});

it('validates CALL payloads and passes CallError through as valid', () => {
  const validate = createValidatorInterceptor();
  const call = frameContext();
  call.raw = '[2, "x", "Heartbeat", {}]';
  const callParsed = parseFrame(call.raw);
  validate(call, callParsed);
  expect(call.validation).toMatchObject({ valid: true, errors: null });

  const missing = frameContext();
  missing.raw = '[2, "x", "BootNotification", {}]';
  const missingParsed = parseFrame(missing.raw);
  validate(missing, missingParsed);
  expect(missing.validation?.valid).toBe(false);
  expect(missing.validation?.errors).not.toBeNull();

  const bad = frameContext();
  bad.raw = '[2, "x", "NoSuchAction", {}]';
  const badParsed = parseFrame(bad.raw);
  validate(bad, badParsed);
  expect(bad.validation).toMatchObject({
    valid: false,
    errors: [{ keyword: 'unknown_action', action: 'NoSuchAction' }],
  });

  const callError = frameContext();
  callError.raw = '[4, "x", "InternalError", "boom", {}]';
  const errorParsed = parseFrame(callError.raw);
  validate(callError, errorParsed);
  const event = buildEvent(callError, errorParsed);
  expect(callError.validation).toMatchObject({ valid: true, errors: null });
  expect(event.payload).toEqual({ code: 'InternalError', description: 'boom', details: {} });
});
