import { isPayload } from './frame.js';
import type { OcppVersion } from './versions.js';

export function getTransactionId(action: string, payload: unknown): number | string | undefined {
  if (!isPayload(payload)) return undefined;
  if (action === 'TransactionEvent' && isPayload(payload.transactionInfo)) {
    const id = payload.transactionInfo.transactionId;
    return typeof id === 'string' ? id : undefined;
  }
  if (!['StartTransaction', 'StopTransaction', 'MeterValues'].includes(action)) return undefined;
  return typeof payload.transactionId === 'number' ? payload.transactionId : undefined;
}

/** Copy on rewrite: another mirror and the primary must retain their own payload. */
export function setTransactionId<T>(action: string, payload: T, id: number): T {
  if (
    !['StopTransaction', 'MeterValues'].includes(action) ||
    !isPayload(payload) ||
    typeof payload.transactionId !== 'number'
  )
    return payload;
  return { ...payload, transactionId: id };
}

export function isFaultStatus(version: OcppVersion, action: string, payload: unknown): boolean {
  if (action !== 'StatusNotification' || !isPayload(payload)) return false;
  if (version === '2.0.1') return payload.connectorStatus === 'Faulted';
  return (
    payload.status === 'Faulted' ||
    (typeof payload.errorCode === 'string' && payload.errorCode !== 'NoError')
  );
}
