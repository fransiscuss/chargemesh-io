import type { OcppFrame } from './frame.js';
import type { OcppVersion } from './versions.js';

export type AdapterContext = { chargerIdentity: string; source: 'charger' | 'upstream' };
export interface Adapter {
  from: OcppVersion;
  to: OcppVersion;
  translate(frame: OcppFrame, ctx: AdapterContext): OcppFrame | null;
}

/** Protocol translation is intentionally unavailable in the MVP. */
export function getAdapter(from: OcppVersion, to: OcppVersion): Adapter | null {
  void from;
  void to;
  return null;
}
