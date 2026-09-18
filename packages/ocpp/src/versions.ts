export type OcppVersion = '1.6' | '2.0.1';
export const subprotocols = { '1.6': 'ocpp1.6', '2.0.1': 'ocpp2.0.1' } as const;

export function negotiateSubprotocol(offered: string[], configured: OcppVersion): string | null {
  const protocol = subprotocols[configured];
  return offered.length === 0 || offered.includes(protocol) ? protocol : null;
}
