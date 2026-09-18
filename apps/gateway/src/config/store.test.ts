import { afterAll, beforeAll, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { encrypt, chargers, upstreams, chargerUpstreams } from '@chargemesh/db';
import { createTestDb } from '../../../../packages/db/test/createTestDb.js';
import { DbConfigStore } from './store.js';

let database: Awaited<ReturnType<typeof createTestDb>>;
const key = Buffer.alloc(32).toString('base64');
beforeAll(async () => {
  database = await createTestDb();
});
afterAll(async () => {
  await database.close();
});
it('loads primary configuration, honors disabled links, and decrypts gateway credentials', async () => {
  const [charger] = await database.db
    .insert(chargers)
    .values({ identity: 'DB-SIM', ocppVersion: '1.6', authMode: 'gateway' })
    .returning();
  const [upstream] = await database.db
    .insert(upstreams)
    .values({
      name: 'Primary',
      url: 'ws://localhost:9000',
      ocppVersion: '1.6',
      authType: 'basic',
      encSecret: encrypt('default-secret', key),
    })
    .returning();
  await database.db.insert(chargerUpstreams).values({
    chargerId: charger!.id,
    upstreamId: upstream!.id,
    role: 'primary',
    identityOverride: 'OTHER',
  });
  const store = new DbConfigStore(database.db, key);
  expect(await store.get('missing')).toBeUndefined();
  expect(await store.get('DB-SIM')).toMatchObject({
    primary: { identityOverride: 'OTHER', password: 'default-secret' },
  });
  await database.db.update(chargerUpstreams).set({ encPassword: encrypt('link-secret', key) });
  expect(await store.get('DB-SIM')).toMatchObject({ primary: { password: 'link-secret' } });
  await database.db.update(chargerUpstreams).set({ enabled: false });
  expect(await store.get('DB-SIM')).toMatchObject({ primary: null });
  await database.db.update(chargerUpstreams).set({ enabled: true });
  await database.db
    .update(upstreams)
    .set({ ocppVersion: '2.0.1' })
    .where(eq(upstreams.id, upstream!.id));
  await expect(store.get('DB-SIM')).rejects.toThrow('translation');
});
