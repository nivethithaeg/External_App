import crypto from 'node:crypto';

/*
 * Time-based one-time codes (RFC 6238) as used by Google Authenticator, Microsoft Authenticator and others:
 * SHA-1, 6 digits, a new code every 30 seconds. Also the small encryption helper that keeps the shared secret
 * unreadable in the database.
 */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0; const out: number[] = [];
  for (const ch of clean) { value = (value << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}

export const newTotpSecret = () => base32Encode(crypto.randomBytes(20)); // 160-bit secret, 32 characters
export const STEP_SECONDS = 30;
export const stepAt = (ms: number) => Math.floor(ms / 1000 / STEP_SECONDS);

/** the 6-digit code for one 30-second step */
export function totpCode(secret: string, step: number): string {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, '0');
}

/**
 * Checks a code against the current step and one step either side (phone clocks drift).
 * Returns the matching step, or null. A step at or before `lastStep` is refused, so a code cannot be used twice.
 */
export function verifyTotp(secret: string, code: string, nowMs: number, lastStep?: number | null): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = stepAt(nowMs);
  for (const s of [now, now - 1, now + 1]) {
    if (lastStep != null && s <= lastStep) continue;
    const a = Buffer.from(totpCode(secret, s)), b = Buffer.from(code);
    if (crypto.timingSafeEqual(a, b)) return s;
  }
  return null;
}

export const otpauthUrl = (secret: string, account: string, issuer = 'PlaynX') =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;

/* AES-256-GCM for small secrets kept in the database: "v1:iv:tag:data" in base64url */
const keyOf = (material: string) => crypto.createHash('sha256').update(`playnx-secret-box:${material}`).digest();
export function sealSecret(plain: string, material: string): string {
  const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', keyOf(material), iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), data.toString('base64url')].join(':');
}
/** opens with the first key that fits: the current key, then older ones (for example the JWT_SECRET fallback before a key was set) */
export function openSecret(sealed: string, material: string, older: string[] = []): string {
  const [v, iv, tag, data] = sealed.split(':');
  if (v !== 'v1') throw new Error('Unknown secret format');
  let last: unknown;
  for (const m of [material, ...older]) {
    try {
      const d = crypto.createDecipheriv('aes-256-gcm', keyOf(m), Buffer.from(iv, 'base64url'));
      d.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
    } catch (e) { last = e; }
  }
  throw last;
}
