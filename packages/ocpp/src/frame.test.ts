import { describe, expect, it } from 'vitest';
import { parseFrame, serializeFrame } from './frame.js';

describe('frame codec', () => {
  it.each([
    '[2, "x", "Heartbeat", {}]',
    '[3, "x", {"currentTime":"2026-09-18T00:00:00Z"}]',
    '[4, "x", "NotSupported", "read-only", {}]',
  ])('parses and serializes %s', (raw) => {
    const parsed = parseFrame(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.frame.raw).toBe(raw);
    expect(JSON.parse(serializeFrame(parsed.frame))).toEqual(JSON.parse(raw));
  });
  it.each([
    'no json',
    '{}',
    'null',
    '[]',
    '[5,"x",{}]',
    '[2,"x","Heartbeat"]',
    '[3,"x",{},0]',
    '[4,"x","InternalError","err"]',
    '[2,1,"Heartbeat",{}]',
    '[2,"x",42,{}]',
    '[2,"x","Heartbeat",null]',
    '[2,"x","Heartbeat",[]]',
    '[3,"x","payload"]',
    '[4,"x",2,"err",{}]',
    '[4,"x","InternalError",0,{}]',
    '[4,"x","InternalError","err",[]]',
  ])('rejects invalid structure %s while preserving raw', (raw) => {
    expect(parseFrame(raw)).toMatchObject({ ok: false, raw, error: expect.any(String) });
  });
  it('serializes rewritten fields even when the original raw exists', () => {
    const parsed = parseFrame('[2, "x", "MeterValues", {"transactionId":42}]');
    if (!parsed.ok || parsed.frame.t !== 2) throw new Error('invalid test frame');
    expect(serializeFrame({ ...parsed.frame, payload: { transactionId: 9001 } })).toBe(
      '[2,"x","MeterValues",{"transactionId":9001}]',
    );
  });
  it('leaves schema validation to the validator', () => {
    expect(parseFrame('[2,"x","VendorExtension",{"unknown":true}]').ok).toBe(true);
  });
});
