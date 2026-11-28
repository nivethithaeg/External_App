import crypto from 'node:crypto';
import { JusgoError, type JusgoChange, type JusgoClient, type JusgoProfile } from '../src/lib/jusgo.js';

/** An in-memory JusGo partner API that behaves like the real one for the customer-link calls. */
export function createJusgoFake() {
  const requests = new Map<string, { email: string; ownerCode?: string | null; status: 'PENDING' | 'APPROVED' | 'DENIED' | 'EXPIRED'; code?: string; fetched: boolean; expiresAt: string }>();
  const profiles = new Map<string, JusgoProfile>(); // by email
  const files = new Map<string, { data: Buffer; contentType: string }>(); // by url
  const calls: string[] = [];
  const pending: JusgoChange[] = []; // what GET /v1/changes hands over next
  const newCode = () => `jcl_${crypto.randomBytes(24).toString('hex')}`;
  const fake: JusgoClient & { requests: typeof requests; profiles: typeof profiles; files: typeof files; calls: string[]; rateLimited: boolean; approve(id: string): string; deny(id: string): void; last(): string; pending: JusgoChange[] } = {
    configured: true, requests, profiles, files, calls, rateLimited: false, pending,
    async changes(limit = 200) { calls.push('changes'); const page = pending.splice(0, limit); return { changes: page, hasMore: pending.length > 0, nextAfter: null }; },
    async requestLink(email, ownerCode) {
      calls.push(`request:${email}`); if (ownerCode) calls.push(`ownerCode:${ownerCode}`);
      if (fake.rateLimited) throw new JusgoError(429, 'RATE_LIMITED', 'Too many');
      const id = crypto.randomUUID(); const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
      requests.set(id, { email, ownerCode, status: 'PENDING', fetched: false, expiresAt });
      return { requestId: id, expiresAt, status: 'PENDING' };
    },
    async linkStatus(id) {
      calls.push(`status:${id}`);
      const r = requests.get(id); if (!r) throw new JusgoError(404, 'NOT_FOUND', 'Not found');
      if (r.status === 'APPROVED' && !r.fetched) { r.code = newCode(); return { requestId: id, status: 'APPROVED', code: r.code, codeExpiresAt: new Date(Date.now() + 600_000).toISOString() }; } // each call replaces the code
      return { requestId: id, status: r.status, expiresAt: r.expiresAt, fetched: r.fetched };
    },
    async fetchProfile(id, code) {
      calls.push(`fetch:${id}`);
      const r = requests.get(id); if (!r) throw new JusgoError(404, 'NOT_FOUND', 'Not found');
      if (r.status !== 'APPROVED') throw new JusgoError(409, 'NOT_APPROVED', 'Not approved');
      if (r.fetched) throw new JusgoError(410, 'ALREADY_FETCHED', 'Already fetched');
      if (code !== r.code) throw new JusgoError(401, 'INVALID_CODE', 'Invalid code');
      r.fetched = true;
      const p = profiles.get(r.email); if (!p) throw new JusgoError(404, 'NOT_FOUND', 'No profile');
      return p;
    },
    async download(url) { calls.push(`download:${url}`); const f = files.get(url); if (!f) throw new JusgoError(404, 'DOWNLOAD_FAILED', 'gone'); return f; },
    approve(id) { const r = requests.get(id)!; r.status = 'APPROVED'; r.code = newCode(); return r.code; },
    deny(id) { requests.get(id)!.status = 'DENIED'; },
    last() { return [...requests.keys()].at(-1)!; },
  };
  return fake;
}
export type JusgoFake = ReturnType<typeof createJusgoFake>;
