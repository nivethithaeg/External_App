import type { Config } from '../config.js';
import { HttpError, unauthorized } from '../errors.js';

export interface GoogleProfile { email: string; name: string }
export interface GoogleVerifier { verify(idToken: string): Promise<GoogleProfile> }

/** Verifies a Google Identity Services ID token via Google's tokeninfo endpoint (checks signature, expiry, audience). */
export function createGoogleVerifier(cfg: Config): GoogleVerifier {
  return {
    async verify(idToken) {
      if (!cfg.GOOGLE_CLIENT_ID) throw new HttpError(503, 'Google sign-in is not configured', 'google_unavailable');
      const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
      if (!res.ok) throw unauthorized('Invalid Google sign-in');
      const j: any = await res.json();
      const issuerOk = j.iss === 'accounts.google.com' || j.iss === 'https://accounts.google.com';
      const verified = j.email_verified === true || j.email_verified === 'true';
      if (j.aud !== cfg.GOOGLE_CLIENT_ID || !issuerOk || !verified || !j.email || Number(j.exp) * 1000 < Date.now()) throw unauthorized('Invalid Google sign-in');
      return { email: String(j.email).toLowerCase(), name: String(j.name || j.email.split('@')[0]) };
    },
  };
}
