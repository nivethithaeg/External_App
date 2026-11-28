import crypto from 'node:crypto';
import type { Config } from '../config.js';

/*
 * JusGo partner API, customer-link part ("Share my JusGo details"), as documented in JusGo docs/PARTNER_API.md.
 * The API key and webhook secret stay on this server; nothing here is ever sent to a browser.
 */

export interface JusgoAddress { line1: string | null; line2: string | null; city: string | null; state: string | null; pincode: string | null; country: string | null }
export interface JusgoDocument { type: 'AADHAAR_COPY' | 'PROFILE_PHOTO' | 'SELF_VERIFICATION' | string; fileName: string | null; mimeType: string | null; url: string | null; expiresAt: string | null }
export interface JusgoProfile {
  jusgoUserId: string; publicCode: string | null; accountType: 'VENUE_OWNER' | 'CUSTOMER' | string;
  name: string | null; firstName: string | null; lastName: string | null; email: string | null; mobile: string | null;
  dateOfBirth: string | null; turfPhone: string | null; registeredAt: string | null;
  address: JusgoAddress | null;
  business: { accountType: string | null; legalName: string | null; gstin: string | null; address: string | null; details: { fields?: Record<string, unknown>; people?: { id?: string; values?: Record<string, unknown> }[] } | null } | null;
  ids: { pan: string | null; aadhaar: string | null; aadhaarVerified: boolean | null; verifiedAt: string | null } | null;
  verification: { status: string | null; applicationReference: string | null; submittedAt: string | null; reviewedAt: string | null } | null;
  documents: JusgoDocument[] | null;
}
export type LinkStatus = { requestId: string; status: 'PENDING' | 'APPROVED' | 'DENIED' | 'EXPIRED'; expiresAt?: string; fetched?: boolean; code?: string; codeExpiresAt?: string };

/** a JusGo API error, with JusGo's error code (ALREADY_FETCHED, CODE_EXPIRED, RATE_LIMITED, ...) */
export class JusgoError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export interface JusgoClient {
  configured: boolean;
  /** with ownerCode, JusGo only asks the venue owner whose Owner ID it is, and only if the email is that same account's */
  requestLink(email: string, ownerCode?: string | null): Promise<{ requestId: string; expiresAt: string; status: string }>;
  linkStatus(requestId: string): Promise<LinkStatus>;
  fetchProfile(requestId: string, code: string): Promise<JusgoProfile>;
  /** downloads a signed document link (valid 15 minutes) */
  download(url: string): Promise<{ data: Buffer; contentType: string }>;
  /** GET /v1/changes: what this app has not received yet, oldest first */
  changes(limit?: number): Promise<{ changes: JusgoChange[]; hasMore: boolean; nextAfter?: string | null }>;
  /** GET /v1/venues: the linked venues and courts; a court's externalId is our playing area id once paired */
  venues(): Promise<{ venues: { id: string; externalId?: string | null; name: string; playingAreas: { id: string; externalId?: string | null; name: string; status?: string }[] }[] }>;
  /** GET /v1/playing-areas/{id}/availability: busy times on one court from every channel (at most 31 days) */
  availability(courtId: string, from: string, to: string): Promise<{ busy: { start: string; end: string }[] }>;
}

/** One change from JusGo, in the shape of GET /v1/changes (a webhook body is turned into this shape too). */
export interface JusgoChange {
  eventId: string; type: string; entityType?: string | null; entityId?: string | null;
  venueId?: string | null; playingAreaId?: string | null; externalVenueId?: string | null; externalPlayingAreaId?: string | null;
  createdAt?: string | null; changedFields?: string[]; previousValues?: Record<string, any>; newValues?: Record<string, any>;
  booking?: { id: string; playing_area_id?: string; start?: string; end?: string; status?: string; channel?: string; is_yours?: boolean;
    external_playing_area_id?: string | null } | null;
}

export function createJusgoClient(cfg: Pick<Config, 'JUSGO_API_URL' | 'JUSGO_API_KEY'>): JusgoClient {
  const base = cfg.JUSGO_API_URL.replace(/\/+$/, '');
  const call = async <T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> => {
    if (!cfg.JUSGO_API_KEY) throw new JusgoError(503, 'NOT_CONFIGURED', 'JusGo is not set up on this server');
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, { method, headers: { 'X-Api-Key': cfg.JUSGO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    } catch (e) { throw new JusgoError(502, 'NETWORK', `JusGo could not be reached: ${(e as Error).message}`); }
    const text = await res.text();
    let json: any = null; try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    if (!res.ok) throw new JusgoError(res.status, json?.error?.code ?? `HTTP_${res.status}`, json?.error?.message ?? `JusGo answered ${res.status}`);
    return json as T;
  };
  return {
    configured: !!cfg.JUSGO_API_KEY,
    requestLink: (email, ownerCode) => call('POST', '/v1/customer-link-request', ownerCode ? { email, ownerCode } : { email }),
    linkStatus: (requestId) => call('GET', `/v1/customer-link-status?requestId=${encodeURIComponent(requestId)}`),
    fetchProfile: async (requestId, code) => (await call<{ profile: JusgoProfile }>('POST', '/v1/customer-link-fetch', { requestId, code })).profile,
    changes: (limit = 200) => call('GET', `/v1/changes?limit=${limit}`),
    venues: () => call('GET', '/v1/venues'),
    availability: (courtId, from, to) => call('GET', `/v1/playing-areas/${encodeURIComponent(courtId)}/availability?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
    async download(url) {
      // a relative link (/storage/...) is resolved against the JusGo address; up to 3 tries, the link lasts 15 minutes
      let target: URL;
      try { target = new URL(url, base + '/'); } catch { throw new JusgoError(400, 'BAD_URL', 'The document link from JusGo is not a valid address'); }
      let last: unknown;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const res = await fetch(target, { signal: AbortSignal.timeout(30_000) });
          if (!res.ok) throw new JusgoError(res.status, 'DOWNLOAD_FAILED', `Document download failed: ${target.host} answered ${res.status}`);
          return { data: Buffer.from(await res.arrayBuffer()), contentType: (res.headers.get('content-type') ?? 'application/octet-stream').split(';')[0].trim() };
        } catch (e) {
          last = e;
          if (e instanceof JusgoError && e.status >= 400 && e.status < 500) break; // expired or refused: trying again will not help
          if (attempt < 3) await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
      if (last instanceof JusgoError) throw last;
      const cause = (last as any)?.cause; // never log the signed link itself, only where it points
      throw new JusgoError(502, 'DOWNLOAD_FAILED', `Could not reach ${target.protocol}//${target.host} for the document: ${cause?.code ?? ''} ${cause?.message ?? (last as Error)?.message ?? ''}`.trim());
    },
  };
}

/**
 * A webhook from JusGo is genuine when X-JusGo-Signature = "v1=" + hex HMAC-SHA256(secret, "<timestamp>.<raw body>")
 * and the timestamp is within 5 minutes. Compared in constant time.
 */
export function jusgoSignatureValid(rawBody: Buffer | string, timestamp: string | undefined, signature: string | undefined, secret: string, nowMs = Date.now()): boolean {
  if (!secret || !timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > 300) return false;
  const want = 'v1=' + crypto.createHmac('sha256', secret).update(`${timestamp}.`).update(typeof rawBody === 'string' ? Buffer.from(rawBody) : rawBody).digest('hex');
  return signature.length === want.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(want));
}
