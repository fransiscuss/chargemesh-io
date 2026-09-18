import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function decodeBase64(value: string): Buffer {
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64') !== value) throw new Error('Invalid base64 encoding');
  return decoded;
}

/** Keys are 32 raw bytes or their canonical base64 representation. */
function readKey(key: string | Buffer): Buffer {
  const bytes = typeof key === 'string' ? decodeBase64(key) : key;
  if (bytes.length !== 32) throw new Error('Encryption key must contain exactly 32 bytes');
  return bytes;
}

export function encrypt(plain: string, key: string | Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', readKey(key), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

export function decrypt(encrypted: string, key: string | Buffer): string {
  const parts = encrypted.split(':');
  const [version, ivPart, tagPart, ctPart] = parts;
  if (
    parts.length !== 4 ||
    version !== 'v1' ||
    ivPart === undefined ||
    tagPart === undefined ||
    ctPart === undefined
  ) {
    throw new Error('Malformed ciphertext or unsupported encryption version');
  }
  const iv = decodeBase64(ivPart);
  const tag = decodeBase64(tagPart);
  const ciphertext = decodeBase64(ctPart);
  if (iv.length !== 12 || tag.length !== 16)
    throw new Error('Invalid IV or authentication tag length');
  const decipher = createDecipheriv('aes-256-gcm', readKey(key), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
