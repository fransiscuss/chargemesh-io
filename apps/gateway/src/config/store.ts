import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { chargers, chargerUpstreams, upstreams, decrypt } from '@chargemesh/db';
import type { schema } from '@chargemesh/db';
import type { OcppVersion } from '@chargemesh/ocpp';

export type PrimaryConfig = {
  id: string;
  url: string;
  identityOverride: string | null;
  password: string | null;
};
export type ChargerConfig = {
  id: string;
  identity: string;
  version: OcppVersion;
  enabled: boolean;
  authMode: 'passthrough' | 'gateway';
  passwordHash: string | null;
  primary: PrimaryConfig | null;
};
export interface ConfigStore {
  get(identity: string): Promise<ChargerConfig | undefined>;
}

export class MemoryConfigStore implements ConfigStore {
  constructor(readonly chargers: ChargerConfig[]) {}
  async get(identity: string): Promise<ChargerConfig | undefined> {
    return this.chargers.find((charger) => charger.identity === identity);
  }
}

export class DbConfigStore implements ConfigStore {
  constructor(
    private readonly db: Pick<NodePgDatabase<typeof schema>, 'select'>,
    private readonly key: string,
  ) {}
  async get(identity: string): Promise<ChargerConfig | undefined> {
    const [charger] = await this.db.select().from(chargers).where(eq(chargers.identity, identity));
    if (!charger) return undefined;
    const [link] = await this.db
      .select({ link: chargerUpstreams, upstream: upstreams })
      .from(chargerUpstreams)
      .innerJoin(upstreams, eq(chargerUpstreams.upstreamId, upstreams.id))
      .where(
        and(
          eq(chargerUpstreams.chargerId, charger.id),
          eq(chargerUpstreams.role, 'primary'),
          eq(chargerUpstreams.enabled, true),
          eq(upstreams.enabled, true),
        ),
      );
    if (link && link.upstream.ocppVersion !== charger.ocppVersion)
      throw new Error('Protocol translation is not available');
    const encrypted =
      link?.link.encPassword ??
      (link?.upstream.authType === 'basic' ? link.upstream.encSecret : null);
    return {
      id: charger.id,
      identity: charger.identity,
      version: charger.ocppVersion,
      enabled: charger.enabled,
      authMode: charger.authMode,
      passwordHash: charger.passwordHash,
      primary: link
        ? {
            id: link.upstream.id,
            url: link.upstream.url,
            identityOverride: link.link.identityOverride,
            password:
              charger.authMode === 'gateway' && encrypted ? decrypt(encrypted, this.key) : null,
          }
        : null,
    };
  }
}
