import type { ParseResult } from '@chargemesh/ocpp';
import type { Delivery } from '@chargemesh/db';
import type { FrameContext } from '../pipeline/pipeline.js';

/**
 * Canonical event envelope (§3.3).
 *
 * `msgType`/`uniqueId` are nullable so malformed frames can be retained: the DB
 * columns are nullable and `raw` always holds the original bytes (see spec open
 * questions). Externally a malformed frame is an event with `msgType: null`,
 * `uniqueId: null`, `action: null` and `valid: false`.
 */
export type OcppEvent = {
  id: string;
  chargerIdentity: string;
  connectionId: string;
  ts: string;
  source: 'charger' | 'upstream';
  upstreamId: string | null;
  upstreamRole: 'primary' | 'mirror' | null;
  msgType: 2 | 3 | 4 | null;
  uniqueId: string | null;
  action: string | null;
  payload: unknown;
  valid: boolean;
  errors: unknown[] | null;
  delivery: Delivery;
  latencyMs: number | null;
};

export type NewOcppEvent = Omit<OcppEvent, 'id'>;

/** Pure mapping from a pipeline context to the recordable event (without id). */
export function buildEvent(ctx: FrameContext, parsed: ParseResult): NewOcppEvent {
  if (!parsed.ok) {
    return {
      chargerIdentity: ctx.chargerIdentity,
      connectionId: ctx.connectionId,
      ts: new Date(ctx.ts).toISOString(),
      source: ctx.source,
      upstreamId: ctx.upstreamId,
      upstreamRole: ctx.upstreamRole,
      msgType: null,
      uniqueId: null,
      action: null,
      payload: null,
      valid: false,
      errors: ctx.validation?.errors ?? [{ keyword: 'parse_error', error: parsed.error }],
      delivery: ctx.delivery,
      latencyMs: ctx.latencyMs,
    };
  }
  const frame = parsed.frame;
  return {
    chargerIdentity: ctx.chargerIdentity,
    connectionId: ctx.connectionId,
    ts: new Date(ctx.ts).toISOString(),
    source: ctx.source,
    upstreamId: ctx.upstreamId,
    upstreamRole: ctx.upstreamRole,
    msgType: frame.t,
    uniqueId: frame.id,
    // Router-resolved: CALL action, or the correlated action (and latency) for 3/4.
    action: ctx.action,
    payload:
      frame.t === 4
        ? { code: frame.code, description: frame.description, details: frame.details }
        : frame.payload,
    valid: ctx.validation?.valid ?? true,
    errors: ctx.validation?.errors ?? null,
    delivery: ctx.delivery,
    latencyMs: ctx.latencyMs,
  };
}
