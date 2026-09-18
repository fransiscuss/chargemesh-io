import { randomUUID } from 'node:crypto';
import type { OcppVersion, Payload } from '@chargemesh/ocpp';
import type { Response } from './rpcPeer.js';

export type ScenarioCharger = { call(action: string, payload: Payload): Promise<Response> };
export type ScenarioOptions = { now?: () => number; idGenerator?: () => string; idTag?: string };
export async function runScenario(
  charger: ScenarioCharger,
  version: OcppVersion,
  scenario: 'boot' | 'full-session',
  options: ScenarioOptions = {},
): Promise<Response[]> {
  const now = options.now ?? Date.now;
  const timestamp = () => new Date(now()).toISOString();
  const responses: Response[] = [];
  const call = async (action: string, payload: Payload) => {
    const response = await charger.call(action, payload);
    responses.push(response);
    if (response.t === 4)
      throw new Error(`${action} failed: ${response.code}: ${response.description}`);
    return response.payload;
  };
  const boot = await call(
    'BootNotification',
    version === '1.6'
      ? { chargePointVendor: 'ChargeMesh', chargePointModel: 'SIM-16' }
      : { chargingStation: { vendorName: 'ChargeMesh', model: 'SIM-201' }, reason: 'PowerUp' },
  );
  if (boot.status !== 'Accepted') throw new Error(`Boot rejected: ${String(boot.status)}`);
  if (scenario === 'boot') return responses;
  if (version === '1.6') {
    const idTag = options.idTag ?? 'TEST-TAG';
    await call('StatusNotification', { connectorId: 1, errorCode: 'NoError', status: 'Available' });
    const auth = await call('Authorize', { idTag });
    if ((auth.idTagInfo as { status?: string } | undefined)?.status !== 'Accepted')
      throw new Error('Authorization rejected');
    const start = await call('StartTransaction', {
      connectorId: 1,
      idTag,
      meterStart: 0,
      timestamp: timestamp(),
    });
    if (
      typeof start.transactionId !== 'number' ||
      (start.idTagInfo as { status?: string } | undefined)?.status !== 'Accepted'
    )
      throw new Error('Transaction rejected');
    for (const value of ['100', '200', '300']) {
      await call('MeterValues', {
        connectorId: 1,
        transactionId: start.transactionId,
        meterValue: [
          {
            timestamp: timestamp(),
            sampledValue: [{ value, measurand: 'Energy.Active.Import.Register', unit: 'Wh' }],
          },
        ],
      });
    }
    await call('StopTransaction', {
      transactionId: start.transactionId,
      meterStop: 300,
      timestamp: timestamp(),
      idTag,
    });
  } else {
    await call('StatusNotification', {
      timestamp: timestamp(),
      connectorStatus: 'Available',
      evseId: 1,
      connectorId: 1,
    });
    const transactionId = (options.idGenerator ?? randomUUID)();
    for (const [seqNo, eventType] of ['Started', 'Updated', 'Ended'].entries()) {
      await call('TransactionEvent', {
        eventType,
        seqNo,
        timestamp: timestamp(),
        triggerReason:
          seqNo === 0 ? 'Authorized' : seqNo === 1 ? 'MeterValuePeriodic' : 'StopAuthorized',
        transactionInfo: { transactionId },
        evse: { id: 1, connectorId: 1 },
      });
    }
  }
  return responses;
}
