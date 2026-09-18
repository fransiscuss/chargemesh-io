import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { chargers, connections } from '@chargemesh/db';
import type { schema } from '@chargemesh/db';

export type ConnectionDb = PgliteDatabase<typeof schema> | NodePgDatabase<typeof schema>;

export type ConnectionOpen = {
  id: string;
  chargerId: string;
  kind: 'charger' | 'upstream';
  upstreamId?: string | null;
  remoteIp?: string | null;
  subprotocol?: string | null;
};

export type ConnectionClose = {
  closeCode?: number | null;
  closeReason?: string | null;
};

/**
 * Writes `connections` rows on open/close for both legs and maintains
 * `chargers.connected` (charger leg) and `last_seen_at`. Best-effort callers
 * should catch: tracking must never break the proxy path.
 */
export class ConnectionTracker {
  private readonly typed: PgliteDatabase<typeof schema>;
  constructor(
    db: ConnectionDb,
    private readonly now: () => number = Date.now,
  ) {
    // Same insert/update call shapes at runtime on pg and PGlite; normalize to one.
    this.typed = db as PgliteDatabase<typeof schema>;
  }

  async opened(info: ConnectionOpen): Promise<void> {
    const openedAt = new Date(this.now());
    await this.typed.insert(connections).values({
      id: info.id,
      chargerId: info.chargerId,
      kind: info.kind,
      upstreamId: info.upstreamId ?? null,
      openedAt,
      remoteIp: info.remoteIp ?? null,
      subprotocol: info.subprotocol ?? null,
    });
    if (info.kind === 'charger') {
      await this.typed
        .update(chargers)
        .set({ connected: true, lastSeenAt: openedAt })
        .where(eq(chargers.id, info.chargerId));
    } else {
      await this.typed
        .update(chargers)
        .set({ lastSeenAt: openedAt })
        .where(eq(chargers.id, info.chargerId));
    }
  }

  async closed(
    id: string,
    chargerId: string,
    kind: 'charger' | 'upstream',
    close: ConnectionClose = {},
  ): Promise<void> {
    await this.typed
      .update(connections)
      .set({
        closedAt: new Date(this.now()),
        closeCode: close.closeCode ?? null,
        closeReason: close.closeReason ?? null,
      })
      .where(eq(connections.id, id));
    if (kind === 'charger') {
      await this.typed.update(chargers).set({ connected: false }).where(eq(chargers.id, chargerId));
    }
  }
}
