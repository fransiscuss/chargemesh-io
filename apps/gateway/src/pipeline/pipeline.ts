import { serializeFrame } from '@chargemesh/ocpp';
import type { OcppFrame, ParseResult, OcppVersion } from '@chargemesh/ocpp';
import type { Delivery } from '@chargemesh/db';

export type FrameContext = {
  raw: string;
  chargerId: string;
  chargerIdentity: string;
  connectionId: string;
  version: OcppVersion;
  source: 'charger' | 'upstream';
  upstreamId: string | null;
  upstreamRole: 'primary' | 'mirror' | null;
  ts: number;
  action: string | null;
  latencyMs: number | null;
  delivery: Delivery;
  forward: (raw: string) => string[];
};
export type SyncResult =
  { type: 'pass' } | { type: 'rewrite'; frame: OcppFrame } | { type: 'drop'; reason: string };
export type SyncInterceptor = (ctx: FrameContext, frame: ParseResult) => SyncResult;
export type AsyncInterceptor = (ctx: FrameContext, frame: ParseResult) => void | Promise<void>;
export type PipelineLogger = { error: (error: unknown, message: string) => void };

export class Pipeline {
  private readonly pending = new Set<Promise<void>>();
  constructor(
    private readonly sync: SyncInterceptor[] = [],
    private readonly async: AsyncInterceptor[] = [],
    private readonly logger: PipelineLogger = { error: () => undefined },
  ) {}
  run(ctx: FrameContext, parsed: ParseResult): void {
    let current = parsed;
    let outgoing = ctx.raw;
    for (const interceptor of this.sync) {
      const result = interceptor(ctx, current);
      if (result.type === 'drop') {
        ctx.delivery.dropped = result.reason;
        break;
      }
      if (result.type === 'rewrite') {
        outgoing = serializeFrame(result.frame);
        current = { ok: true, frame: result.frame };
        ctx.delivery.rewritten = true;
      }
    }
    if (!ctx.delivery.dropped) {
      try {
        ctx.delivery.forwardedTo = ctx.forward(outgoing);
      } catch (error) {
        ctx.delivery.dropped = 'send_failed';
        this.logger.error(error, 'Forwarding failed');
      }
    }
    // Dispatch after forwarding; serial async observers preserve validator/recorder ordering.
    const work = Promise.resolve().then(async () => {
      for (const interceptor of this.async) {
        try {
          await interceptor(ctx, parsed);
        } catch (error) {
          this.logger.error(error, 'Async interceptor failed');
        }
      }
    });
    this.pending.add(work);
    void work.finally(() => this.pending.delete(work));
  }
  async flush(): Promise<void> {
    while (this.pending.size > 0) await Promise.all(this.pending);
  }
}
