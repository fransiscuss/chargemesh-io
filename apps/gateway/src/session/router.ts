import { parseFrame, PendingCalls } from '@chargemesh/ocpp';
import type { OcppVersion } from '@chargemesh/ocpp';
import type { Pipeline } from '../pipeline/pipeline.js';

export type Leg = { send: (raw: string) => void };
export type RouterOptions = {
  chargerId: string;
  chargerIdentity: string;
  connectionId: string;
  version: OcppVersion;
  upstreamId: string;
  charger: Leg;
  primary: Leg;
  pipeline: Pipeline;
  now?: () => number;
};
export class Router {
  readonly chargerCalls: PendingCalls;
  readonly upstreamCalls: PendingCalls;
  private readonly now: () => number;
  constructor(private readonly options: RouterOptions) {
    this.now = options.now ?? Date.now;
    this.chargerCalls = new PendingCalls(this.now);
    this.upstreamCalls = new PendingCalls(this.now);
  }
  route(source: 'charger' | 'upstream', raw: string): void {
    const ts = this.now();
    const parsed = parseFrame(raw);
    let action: string | null = null;
    let latencyMs: number | null = null;
    if (parsed.ok) {
      const frame = parsed.frame;
      if (frame.t === 2) {
        action = frame.action;
        (source === 'charger' ? this.chargerCalls : this.upstreamCalls).add(
          frame.id,
          frame.action,
          ts,
        );
      } else {
        const pending = (source === 'charger' ? this.upstreamCalls : this.chargerCalls).resolve(
          frame.id,
        );
        action = pending?.action ?? null;
        latencyMs = pending ? ts - pending.ts : null;
      }
    }
    this.options.pipeline.run(
      {
        raw,
        chargerId: this.options.chargerId,
        chargerIdentity: this.options.chargerIdentity,
        connectionId: this.options.connectionId,
        version: this.options.version,
        source,
        upstreamId: source === 'upstream' ? this.options.upstreamId : null,
        upstreamRole: source === 'upstream' ? 'primary' : null,
        ts,
        action,
        latencyMs,
        delivery: { forwardedTo: [] },
        forward: (outgoing) => {
          (source === 'charger' ? this.options.primary : this.options.charger).send(outgoing);
          return [source === 'charger' ? this.options.upstreamId : 'charger'];
        },
      },
      parsed,
    );
  }
  sweep(): void {
    this.chargerCalls.sweep(this.now(), 120_000);
    this.upstreamCalls.sweep(this.now(), 120_000);
  }
}
