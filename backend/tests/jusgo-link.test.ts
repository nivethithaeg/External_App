import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import { registerUser, setup, uniq, type TestEnv } from './helpers.js';
import { jusgoSignatureValid, type JusgoProfile } from '../src/lib/jusgo.js';
import { isEncryptedFile } from '../src/lib/fileCrypto.js';

const SECRET = 'whsec_test_secret';
const API_KEY = 'jsg_test_clientid.supersecretvalue';
let env: TestEnv;
beforeAll(async () => { env = await setup({ JUSGO_WEBHOOK_SECRET: SECRET, JUSGO_API_KEY: API_KEY }); });

const otpOf = (email: string) => /(\d{6})/.exec(env.emails.filter((m) => m.to === email).at(-1)!.html.replace(/<[^>]+>/g, ' '))![1];
const PDF = Buffer.from('%PDF-1.4 aadhaar copy contents');
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6]);

function profile(email: string, over: Partial<JusgoProfile> = {}): JusgoProfile {
  const tag = crypto.randomUUID();
  env.jusgo.files.set(`https://files.jusgo.test/${tag}/aadhaar.pdf`, { data: PDF, contentType: 'application/pdf' });
  env.jusgo.files.set(`https://files.jusgo.test/${tag}/photo.jpg`, { data: JPG, contentType: 'image/jpeg' });
  return {
    jusgoUserId: crypto.randomUUID(), publicCode: 'JGO-7X9QVZ', accountType: 'VENUE_OWNER', name: 'Arun Kumar', firstName: 'Arun', lastName: 'K', email,
    mobile: `+9198${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, dateOfBirth: '1990-04-01', turfPhone: null, registeredAt: '2026-11-23T05:34:48Z',
    address: { line1: '12 Cross Street', line2: null, city: 'Erode', state: 'Tamil Nadu', pincode: '638001', country: 'IN' },
    business: { accountType: 'INDIVIDUAL', legalName: 'Arun Kumar', gstin: null, address: '12 Cross Street, Erode', details: { fields: {}, people: [] } },
    ids: { pan: 'ABCDE1234F', aadhaar: '234567891098', aadhaarVerified: true, verifiedAt: '2026-11-23T06:00:00Z' },
    verification: { status: 'APPROVED', applicationReference: 'JG-APP-1', submittedAt: null, reviewedAt: null },
    documents: [
      { type: 'AADHAAR_COPY', fileName: 'aadhaar.pdf', mimeType: 'application/pdf', url: `https://files.jusgo.test/${tag}/aadhaar.pdf`, expiresAt: null },
      { type: 'PROFILE_PHOTO', fileName: 'photo.jpg', mimeType: 'image/jpeg', url: `https://files.jusgo.test/${tag}/photo.jpg`, expiresAt: null },
      { type: 'SELF_VERIFICATION', fileName: 'gone.jpg', mimeType: 'image/jpeg', url: null, expiresAt: null }, // signing failed at JusGo
    ],
    ...over,
  };
}
function webhook(type: string, data: Record<string, unknown>, opts: { ts?: number; secret?: string; delivery?: string } = {}) {
  const body = JSON.stringify({ id: opts.delivery ?? crypto.randomUUID(), type, event_type: type, schema_version: 1, data });
  const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
  const sig = 'v1=' + crypto.createHmac('sha256', opts.secret ?? SECRET).update(`${ts}.${body}`).digest('hex');
  return request(env.app).post('/api/webhooks/jusgo').set('Content-Type', 'application/json').set('X-JusGo-Event', type).set('X-JusGo-Timestamp', ts)
    .set('X-JusGo-Signature', sig).set('X-JusGo-Delivery', opts.delivery ?? crypto.randomUUID()).send(body);
}
/** start + PlaynX code: returns the signup id, its token and the JusGo request id */
async function startLink(email: string, ownerCode = 'JGO-7X9QVZ') {
  const s = (await request(env.app).post('/api/auth/jusgo-link').send({ email, ownerCode }).expect(201)).body;
  const h = { 'X-Link-Token': s.token };
  await request(env.app).post(`/api/auth/jusgo-link/${s.signup.id}/otp/verify`).set(h).send({ code: otpOf(email) }).expect(200);
  return { id: s.signup.id as string, h, requestId: env.jusgo.last() };
}
const poll = (id: string, h: Record<string, string>) => request(env.app).get(`/api/auth/jusgo-link/${id}`).set(h).expect(200).then((r) => r.body.signup);

describe('JusGo webhook signature', () => {
  it('accepts the right signature within 5 minutes, and nothing else', () => {
    const body = '{"a":1}'; const ts = String(Math.floor(Date.now() / 1000));
    const sig = 'v1=' + crypto.createHmac('sha256', SECRET).update(`${ts}.${body}`).digest('hex');
    expect(jusgoSignatureValid(Buffer.from(body), ts, sig, SECRET)).toBe(true);
    expect(jusgoSignatureValid(Buffer.from(body + ' '), ts, sig, SECRET)).toBe(false); // body changed
    expect(jusgoSignatureValid(Buffer.from(body), ts, sig, 'whsec_other')).toBe(false);
    expect(jusgoSignatureValid(Buffer.from(body), String(Number(ts) - 301), 'v1=' + crypto.createHmac('sha256', SECRET).update(`${Number(ts) - 301}.${body}`).digest('hex'), SECRET)).toBe(false); // too old
    expect(jusgoSignatureValid(Buffer.from(body), ts, undefined, SECRET)).toBe(false);
  });
  it('the endpoint rejects bad and stale signatures', async () => {
    await webhook('customer.link_expired', { requestId: 'x' }, { secret: 'whsec_wrong' }).expect(401);
    await webhook('customer.link_expired', { requestId: 'x' }, { ts: Math.floor(Date.now() / 1000) - 400 }).expect(401);
    await webhook('customer.link_expired', { requestId: 'x' }).expect(200);
  });
});

describe('sign up with JusGo details', () => {
  it('a wrong PlaynX code stops everything: JusGo is never contacted', async () => {
    const email = `${uniq('jg')}@test.dev`;
    const s = (await request(env.app).post('/api/auth/jusgo-link').send({ email, ownerCode: 'jgo-7x9qvz' }).expect(201)).body;
    expect(s.signup.ownerCode).toBe('JGO-7X9QVZ');
    const before = env.jusgo.calls.length;
    await request(env.app).post(`/api/auth/jusgo-link/${s.signup.id}/otp/verify`).set({ 'X-Link-Token': s.token }).send({ code: otpOf(email) === '000000' ? '111111' : '000000' }).expect(400);
    expect(env.jusgo.calls.length).toBe(before);
    await request(env.app).get(`/api/auth/jusgo-link/${s.signup.id}`).set({ 'X-Link-Token': 'wrong' }).expect(404); // another browser cannot read it
    await request(env.app).post('/api/auth/jusgo-link').send({ email, ownerCode: 'nope' }).expect(400);
    await request(env.app).post('/api/auth/jusgo-link').send({ email, ownerCode: 'JGO-7X9QVZ1' }).expect(400); // JGO- + exactly 6
  });

  it('webhook approval: the profile is fetched once, documents are downloaded and kept encrypted, and the owner account is made', async () => {
    const email = `${uniq('jg')}@test.dev`; const p = profile(email); env.jusgo.profiles.set(email, p);
    const { id, h, requestId } = await startLink(email);
    expect(env.jusgo.calls).toContain(`request:${email}`);
    expect(env.jusgo.requests.get(requestId)!.ownerCode).toBe('JGO-7X9QVZ'); // JusGo matches email + Owner ID together
    let v = await poll(id, h); expect(v.status).toBe('pending'); expect(new Date(v.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const code = env.jusgo.approve(requestId);
    const delivery = crypto.randomUUID();
    await webhook('customer.linked', { requestId, code, codeExpiresAt: new Date(Date.now() + 600_000).toISOString() }, { delivery }).expect(200);
    await webhook('customer.linked', { requestId, code }, { delivery }).expect(200).then((r) => expect(r.body.duplicate).toBe(true)); // a retry of the same delivery
    await webhook('customer.linked', { requestId, code }).expect(200); // a second delivery: JusGo says ALREADY_FETCHED, nothing breaks
    expect(env.jusgo.calls.filter((c) => c === `fetch:${requestId}`).length).toBe(1);

    v = await poll(id, h);
    expect(v.status).toBe('fetched');
    expect(v.profile).toMatchObject({ name: 'Arun Kumar', publicCode: 'JGO-7X9QVZ', panMasked: 'AB•••••4F', aadhaarMasked: 'XXXXXXXX1098', verification: 'APPROVED' });
    expect(v.profile.documents.map((d: any) => d.type).sort()).toEqual(['AADHAAR_COPY', 'PROFILE_PHOTO']); // the null link is skipped
    expect(JSON.stringify(v)).not.toContain('234567891098'); // never the full Aadhaar
    const row = (await env.db.query('SELECT profile_enc FROM jusgo_link_signups WHERE id=$1', [id])).rows[0];
    expect(row.profile_enc).not.toContain('Arun'); expect(row.profile_enc).not.toContain('ABCDE1234F');
    const stored = [...env.privateFiles.entries()].filter(([k]) => k.startsWith(`jusgo/${id}`));
    expect(stored.length).toBe(2);
    for (const [, f] of stored) { expect(isEncryptedFile(f.data)).toBe(true); expect(f.data.includes(PDF)).toBe(false); }

    await request(env.app).post(`/api/auth/jusgo-link/${id}/complete`).set(h).send({ password: 'short', acceptTerms: true }).expect(400);
    const done = await request(env.app).post(`/api/auth/jusgo-link/${id}/complete`).set(h).send({ password: 'OwnerPass123', acceptTerms: true }).expect(201);
    expect(done.body.user.role).toBe('owner'); expect(done.body.token).toBeTruthy();
    const ob = (await env.db.query(`SELECT * FROM owner_onboarding WHERE owner_id=$1`, [done.body.user.id])).rows[0];
    expect(ob).toMatchObject({ account_type: 'individual', pan_number: 'ABCDE1234F', aadhaar_masked: 'XXXXXXXX1098', address_line1: '12 Cross Street', city: 'Erode', postal_code: '638001', legal_full_name: 'Arun Kumar' });
    expect(ob.jusgo_imported).toEqual(expect.arrayContaining(['pan_number', 'aadhaar_masked']));
    const u = (await env.db.query('SELECT jusgo_user_id, email_verified FROM users WHERE id=$1', [done.body.user.id])).rows[0];
    expect(u).toEqual({ jusgo_user_id: p.jusgoUserId, email_verified: true });
    const docs = (await env.db.query(`SELECT doc_type, source FROM owner_documents WHERE owner_id=$1 ORDER BY doc_type`, [done.body.user.id])).rows;
    expect(docs).toEqual([{ doc_type: 'identity_proof', source: 'jusgo' }, { doc_type: 'profile_photo', source: 'jusgo' }]);
    // the document opens decrypted for the owner
    const doc = (await env.db.query(`SELECT id FROM owner_documents WHERE owner_id=$1 AND doc_type='identity_proof'`, [done.body.user.id])).rows[0];
    const file = await request(env.app).get(`/api/owner/application/documents/${doc.id}/file`).set({ Authorization: `Bearer ${done.body.token}` }).buffer(true).parse((res, cb) => { const ch: Buffer[] = []; res.on('data', (c: Buffer) => ch.push(c)); res.on('end', () => cb(null, Buffer.concat(ch))); });
    expect(file.status).toBe(200); expect(Buffer.compare(file.body, PDF)).toBe(0); // decrypted for the owner
    expect((await env.db.query('SELECT profile_enc, status FROM jusgo_link_signups WHERE id=$1', [id])).rows[0]).toEqual({ profile_enc: null, status: 'completed' });
    expect(JSON.stringify(done.body)).not.toContain(API_KEY);
  });

  it('polling fallback: with no webhook, the status check brings a code and the profile is fetched', async () => {
    const email = `${uniq('jg')}@test.dev`; env.jusgo.profiles.set(email, profile(email));
    const { id, h, requestId } = await startLink(email);
    env.jusgo.approve(requestId); // approved on JusGo, but the webhook never arrives
    const v = await poll(id, h);
    expect(v.status).toBe('fetched'); expect(v.profile.name).toBe('Arun Kumar');
    expect(JSON.stringify(v)).not.toContain(API_KEY);
  });

  it('denied and expired requests fall back to the normal sign-up', async () => {
    const e1 = `${uniq('jg')}@test.dev`; const a = await startLink(e1);
    await webhook('customer.link_denied', { requestId: a.requestId }).expect(200);
    expect((await poll(a.id, a.h)).status).toBe('denied');
    const e2 = `${uniq('jg')}@test.dev`; const b = await startLink(e2);
    await webhook('customer.link_expired', { requestId: b.requestId }).expect(200);
    expect((await poll(b.id, b.h)).status).toBe('expired');
    const e3 = `${uniq('jg')}@test.dev`; const c = await startLink(e3);
    env.clock.offsetMs += 16 * 60_000; // nobody answered in 15 minutes
    expect((await poll(c.id, c.h)).status).toBe('expired');
    env.clock.offsetMs -= 16 * 60_000;
    await request(env.app).post(`/api/auth/jusgo-link/${c.id}/complete`).set(c.h).send({ password: 'OwnerPass123', acceptTerms: true }).expect(400);
  });

  it('refuses a JusGo account whose Owner ID does not match, or that is not a venue owner', async () => {
    const e1 = `${uniq('jg')}@test.dev`; env.jusgo.profiles.set(e1, profile(e1, { publicCode: 'JGO-OTHER1' }));
    const a = await startLink(e1); env.jusgo.approve(a.requestId);
    const v = await poll(a.id, a.h); expect(v.status).toBe('failed'); expect(v.failure).toMatch(/Owner ID does not match/);
    const e2 = `${uniq('jg')}@test.dev`; env.jusgo.profiles.set(e2, profile(e2, { accountType: 'CUSTOMER', address: null, business: null, documents: [] }));
    const b = await startLink(e2); env.jusgo.approve(b.requestId);
    expect((await poll(b.id, b.h)).failure).toMatch(/not a venue owner/);
  });

  it('an email that already has a PlaynX account is linked, not duplicated, and no one is signed in by it', async () => {
    const o = await registerUser(env, 'owner');
    env.jusgo.profiles.set(o.email, profile(o.email));
    const { id, h, requestId } = await startLink(o.email); env.jusgo.approve(requestId);
    const v = await poll(id, h); expect(v.existingAccount).toBe(true);
    const r = await request(env.app).post(`/api/auth/jusgo-link/${id}/complete`).set(h).send({}).expect(200);
    expect(r.body).toMatchObject({ linkedExisting: true, role: 'owner' }); expect(r.body.token).toBeUndefined();
    expect((await env.db.query('SELECT count(*)::int AS n FROM users WHERE lower(email)=lower($1)', [o.email])).rows[0].n).toBe(1);
    expect((await env.db.query('SELECT jusgo_user_id FROM users WHERE id=$1', [o.id])).rows[0].jusgo_user_id).toBeTruthy();
    expect((await env.db.query('SELECT pan_number FROM owner_onboarding WHERE owner_id=$1', [o.id])).rows[0].pan_number).toBe('ABCDE1234F'); // filled because it was empty
  });

  it('customer.unlinked removes the Aadhaar, PAN and documents that came from JusGo', async () => {
    const email = `${uniq('jg')}@test.dev`; const p = profile(email); env.jusgo.profiles.set(email, p);
    const { id, h, requestId } = await startLink(email); env.jusgo.approve(requestId); await poll(id, h);
    const done = (await request(env.app).post(`/api/auth/jusgo-link/${id}/complete`).set(h).send({ password: 'OwnerPass123', acceptTerms: true }).expect(201)).body;
    const keys = (await env.db.query(`SELECT storage_key FROM owner_documents WHERE owner_id=$1`, [done.user.id])).rows.map((x: any) => x.storage_key);
    expect(keys.every((k: string) => env.privateFiles.has(k))).toBe(true);

    await webhook('customer.unlinked', { jusgoUserId: p.jusgoUserId, requestId }).expect(200);
    expect((await env.db.query(`SELECT count(*)::int AS n FROM owner_documents WHERE owner_id=$1 AND source='jusgo'`, [done.user.id])).rows[0].n).toBe(0);
    expect(keys.some((k: string) => env.privateFiles.has(k))).toBe(false); // the files are gone too
    const ob = (await env.db.query(`SELECT pan_number, aadhaar_masked, legal_full_name, jusgo_imported FROM owner_onboarding WHERE owner_id=$1`, [done.user.id])).rows[0];
    expect(ob).toEqual({ pan_number: null, aadhaar_masked: null, legal_full_name: 'Arun Kumar', jusgo_imported: [] }); // the name stays: the account needs it
    expect((await env.db.query('SELECT jusgo_user_id FROM users WHERE id=$1', [done.user.id])).rows[0].jusgo_user_id).toBeNull();
  });

  it('JusGo rate limits are passed on clearly', async () => {
    const email = `${uniq('jg')}@test.dev`;
    const s = (await request(env.app).post('/api/auth/jusgo-link').send({ email, ownerCode: 'JGO-7X9QVZ' }).expect(201)).body;
    env.jusgo.rateLimited = true;
    const r = await request(env.app).post(`/api/auth/jusgo-link/${s.signup.id}/otp/verify`).set({ 'X-Link-Token': s.token }).send({ code: otpOf(email) }).expect(429);
    env.jusgo.rateLimited = false;
    expect(r.body.error.code).toBe('jusgo_rate_limited');
  });
});

describe('encryption keys', () => {
  it('files and secrets saved under the old key still open after a new key is set', async () => {
    const { encryptFile, decryptFile } = await import('../src/lib/fileCrypto.js');
    const { sealSecret, openSecret } = await import('../src/lib/totp.js');
    const enc = encryptFile(PDF, 'old-jwt-secret');
    expect(() => decryptFile(enc, 'new-key')).toThrow();
    expect(Buffer.compare(decryptFile(enc, 'new-key', ['old-jwt-secret']), PDF)).toBe(0);
    expect(openSecret(sealSecret('ABC', 'old-jwt-secret'), 'new-key', ['old-jwt-secret'])).toBe('ABC');
  });
});

describe('JusGo documents', () => {
  it('a document that cannot be downloaded is reported as missing; the rest still comes across', async () => {
    const email = `${uniq('jg')}@test.dev`; const p = profile(email);
    env.jusgo.files.delete(p.documents![1].url!); // the photo link no longer works
    env.jusgo.profiles.set(email, p);
    const { id, h, requestId } = await startLink(email); env.jusgo.approve(requestId);
    const v = await poll(id, h);
    expect(v.status).toBe('fetched');
    expect(v.profile.documents.map((d: any) => d.type)).toEqual(['AADHAAR_COPY']);
    expect(v.profile.missingDocuments.sort()).toEqual(['PROFILE_PHOTO', 'SELF_VERIFICATION']); // one failed, one had no link
  });

  it('the real client resolves relative links against JusGo, retries network errors and never logs the signed link', async () => {
    const { createJusgoClient } = await import('../src/lib/jusgo.js');
    const c = createJusgoClient({ JUSGO_API_URL: 'https://api.jusgo.test/functions/v1/partner-api', JUSGO_API_KEY: 'jsg_test_a.b' });
    const real = globalThis.fetch; const seen: string[] = []; let fails = 2;
    globalThis.fetch = (async (u: any) => { seen.push(String(u)); if (fails-- > 0) { const e: any = new TypeError('fetch failed'); e.cause = { code: 'ECONNRESET', message: 'socket hang up' }; throw e; } return new Response(PDF, { headers: { 'content-type': 'application/pdf' } }); }) as any;
    try {
      const f = await c.download('/storage/v1/object/sign/docs/a.pdf?token=SECRET');
      expect(Buffer.compare(f.data, PDF)).toBe(0); expect(f.contentType).toBe('application/pdf');
      expect(seen).toHaveLength(3); expect(seen[0]).toBe('https://api.jusgo.test/storage/v1/object/sign/docs/a.pdf?token=SECRET');
      fails = 99;
      const err = await c.download('https://files.jusgo.test/x.pdf?token=SECRET').catch((e) => e);
      expect(err.message).toContain('files.jusgo.test'); expect(err.message).toContain('ECONNRESET'); expect(err.message).not.toContain('SECRET');
    } finally { globalThis.fetch = real; }
  }, 20000);
});
