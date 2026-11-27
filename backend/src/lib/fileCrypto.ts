import crypto from 'node:crypto';
import type { Storage } from './storage.js';

/*
 * Private files (identity and business documents) are encrypted before they are stored: AES-256-GCM with a key from
 * DATA_ENCRYPTION_KEY. Files saved before this existed have no header and are read as they are.
 */
const MAGIC = Buffer.from('PXENC1');
const keyOf = (material: string) => crypto.createHash('sha256').update(`playnx-files:${material}`).digest();

export function encryptFile(data: Buffer, material: string): Buffer {
  const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', keyOf(material), iv);
  const body = Buffer.concat([c.update(data), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), body]);
}
export const isEncryptedFile = (data: Buffer) => data.length > MAGIC.length + 28 && data.subarray(0, MAGIC.length).equals(MAGIC);
/** decrypts with the first key that fits (the current key, then older ones such as the JWT_SECRET fallback) */
export function decryptFile(data: Buffer, material: string, older: string[] = []): Buffer {
  if (!isEncryptedFile(data)) return data;
  const iv = data.subarray(6, 18), tag = data.subarray(18, 34), body = data.subarray(34);
  let last: unknown;
  for (const m of [material, ...older]) {
    try { const d = crypto.createDecipheriv('aes-256-gcm', keyOf(m), iv); d.setAuthTag(tag); return Buffer.concat([d.update(body), d.final()]); } catch (e) { last = e; }
  }
  throw last;
}

/** the same storage, with private files encrypted on the way in and decrypted on the way out */
export function withFileEncryption(s: Storage, material: string, older: string[] = []): Storage {
  return {
    ...s,
    putPrivate: (folder, data, contentType) => s.putPrivate(folder, encryptFile(data, material), contentType),
    getPrivate: async (key) => { const f = await s.getPrivate(key); return { ...f, data: decryptFile(f.data, material, older) }; },
  };
}
