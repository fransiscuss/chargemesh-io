export function parseIdentity(path: string): string {
  const pathname = path.split('?')[0] ?? '';
  if (!pathname.startsWith('/ocpp/')) throw new Error('Invalid OCPP path');
  let identity: string;
  try {
    identity = decodeURIComponent(pathname.slice('/ocpp/'.length).replace(/\/$/, ''));
  } catch {
    throw new Error('Invalid identity encoding');
  }
  if (
    !identity ||
    identity.includes('/') ||
    identity.includes('\\') ||
    Array.from(identity).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  )
    throw new Error('Invalid charger identity');
  return identity;
}
