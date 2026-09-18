import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';

export function parseBasicAuth(
  header: string | undefined,
): { username: string; password: string } | null {
  if (!header) return null;
  const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(header);
  if (!match?.[1]) return null;
  const decoded = Buffer.from(match[1], 'base64');
  if (decoded.toString('base64') !== match[1]) return null;
  const value = decoded.toString('utf8');
  const colon = value.indexOf(':');
  return colon < 0 ? null : { username: value.slice(0, colon), password: value.slice(colon + 1) };
}
function derive(
  password: string,
  salt: Buffer,
  length: number,
  N: number,
  r: number,
  p: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, length, { N, r, p, maxmem: 128 * 1024 * 1024 }, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
}
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await derive(password, salt, 32, 16384, 8, 1);
  return ['scrypt', 16384, 8, 1, salt.toString('base64'), hash.toString('base64')].join('$');
}
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const parts = hash.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (
    !N ||
    !r ||
    !p ||
    !Number.isInteger(N) ||
    (N & (N - 1)) !== 0 ||
    N < 1024 ||
    N > 65536 ||
    !Number.isInteger(r) ||
    r < 1 ||
    r > 8 ||
    !Number.isInteger(p) ||
    p < 1 ||
    p > 4
  )
    return false;
  const salt = Buffer.from(parts[4]!, 'base64');
  const expected = Buffer.from(parts[5]!, 'base64');
  if (
    salt.length < 16 ||
    salt.toString('base64') !== parts[4] ||
    expected.length !== 32 ||
    expected.toString('base64') !== parts[5]
  )
    return false;
  try {
    return timingSafeEqual(expected, await derive(password, salt, expected.length, N, r, p));
  } catch {
    return false;
  }
}
export async function authenticateGateway(
  header: string | undefined,
  hash: string | null,
): Promise<boolean> {
  const basic = parseBasicAuth(header);
  return basic !== null && hash !== null && (await verifyPassword(basic.password, hash));
}
