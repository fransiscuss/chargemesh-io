import type { ChargerConfig } from '../src/config/store.js';
import type { FrameContext } from '../src/pipeline/pipeline.js';
import type { OcppVersion } from '@chargemesh/ocpp';
export function chargerConfig(url: string, version: OcppVersion = '1.6'): ChargerConfig {
  return {
    id: 'charger-id',
    identity: 'SIM001',
    version,
    enabled: true,
    authMode: 'passthrough',
    passwordHash: null,
    primary: { id: 'primary-id', url, identityOverride: null, password: null },
  };
}
export function frameContext(): FrameContext {
  return {
    raw: '[2, "x", "Heartbeat", {}]',
    chargerId: 'charger-id',
    chargerIdentity: 'SIM001',
    connectionId: 'connection-id',
    version: '1.6',
    source: 'charger',
    upstreamId: null,
    upstreamRole: null,
    ts: 0,
    action: 'Heartbeat',
    latencyMs: null,
    delivery: { forwardedTo: [] },
    forward: () => ['primary-id'],
  };
}
