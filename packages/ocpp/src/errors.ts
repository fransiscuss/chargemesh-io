import type { CallError } from './frame.js';
import type { OcppVersion } from './versions.js';

const common = [
  'NotImplemented',
  'NotSupported',
  'InternalError',
  'ProtocolError',
  'SecurityError',
  'PropertyConstraintViolation',
  'TypeConstraintViolation',
] as const;
export const errorCodes = {
  '1.6': [...common, 'FormationViolation', 'OccurenceConstraintViolation', 'GenericError'],
  '2.0.1': [
    ...common,
    'FormatViolation',
    // OCPP 2.0.1 retains this spelling; the corrected spelling belongs to 2.1.
    'OccurenceConstraintViolation',
    'GenericError',
    'MessageTypeNotSupported',
    'RpcFrameworkError',
  ],
} as const;

export function callError(
  id: string,
  code: string,
  description: string,
  version: OcppVersion = '1.6',
): CallError {
  if (!(errorCodes[version] as readonly string[]).includes(code)) {
    throw new Error(`Invalid OCPP ${version} error code: ${code}`);
  }
  return { t: 4, id, code, description, details: {} };
}
