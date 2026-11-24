/** Indian mobile numbers are stored in E.164 form (+91XXXXXXXXXX) so "9876543210" and "+919876543210" are the same account. */
export function normalizePhone(raw: string): string {
  const d = raw.replace(/[\s-]/g, '');
  if (/^91[6-9]\d{9}$/.test(d)) return '+' + d;
  return /^\d{10}$/.test(d) ? '+91' + d : d;
}
/** Every spelling an existing row might use (older rows may hold the bare 10 digits). */
export function phoneCandidates(raw: string): string[] {
  const n = normalizePhone(raw);
  return n.startsWith('+91') && n.length === 13 ? [n, n.slice(3)] : [n];
}

/**
 * A valid Indian mobile number: 10 digits starting with 6, 7, 8 or 9 (^[6-9]\d{9}$). The stored +91 form (and 91 in front) is accepted too,
 * because that is how numbers are saved and shown back; the number after it must follow the same rule.
 */
export const INDIAN_MOBILE = /^(?:\+?91)?[6-9]\d{9}$/;
export const INDIAN_MOBILE_MESSAGE = 'Enter a valid 10-digit mobile number starting with 6, 7, 8 or 9, e.g. 9876543210';
