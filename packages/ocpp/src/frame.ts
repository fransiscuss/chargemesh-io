export type Payload = Record<string, unknown>;
type BaseFrame = { id: string; raw?: string };
export type Call = BaseFrame & { t: 2; action: string; payload: Payload };
export type CallResult = BaseFrame & { t: 3; payload: Payload };
export type CallError = BaseFrame & { t: 4; code: string; description: string; details: Payload };
export type OcppFrame = Call | CallResult | CallError;
export type ParseResult =
  { ok: true; frame: OcppFrame } | { ok: false; error: string; raw: string };

export function isPayload(value: unknown): value is Payload {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseFrame(raw: string): ParseResult {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'invalid_json', raw };
  }
  const invalid = (error: string): ParseResult => ({ ok: false, error, raw });
  if (!Array.isArray(value)) return invalid('not_array');
  const [t, id, third, fourth, fifth] = value as unknown[];
  if (t !== 2 && t !== 3 && t !== 4) return invalid('unknown_message_type');
  if (value.length !== (t === 2 ? 4 : t === 3 ? 3 : 5)) return invalid('wrong_arity');
  if (typeof id !== 'string') return invalid('invalid_id');
  if (t === 2) {
    if (typeof third !== 'string') return invalid('invalid_action');
    if (!isPayload(fourth)) return invalid('invalid_payload');
    return { ok: true, frame: { t, id, action: third, payload: fourth, raw } };
  }
  if (t === 3) {
    if (!isPayload(third)) return invalid('invalid_payload');
    return { ok: true, frame: { t, id, payload: third, raw } };
  }
  if (typeof third !== 'string' || typeof fourth !== 'string') return invalid('invalid_error');
  if (!isPayload(fifth)) return invalid('invalid_details');
  return { ok: true, frame: { t, id, code: third, description: fourth, details: fifth, raw } };
}

/** Serialize structured fields. Transparent forwarding uses frame.raw directly. */
export function serializeFrame(frame: OcppFrame): string {
  switch (frame.t) {
    case 2:
      return JSON.stringify([2, frame.id, frame.action, frame.payload]);
    case 3:
      return JSON.stringify([3, frame.id, frame.payload]);
    case 4:
      return JSON.stringify([4, frame.id, frame.code, frame.description, frame.details]);
  }
}
