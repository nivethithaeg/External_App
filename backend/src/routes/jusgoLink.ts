import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import type { Ctx } from '../types.js';
import { signToken } from '../middleware/auth.js';
import { badRequest, conflict, HttpError, notFound } from '../errors.js';
import { parse } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { syncAccount } from '../lib/accounts.js';
import { renderEmail } from '../lib/emailTemplate.js';
import { normalizePhone, phoneCandidates, INDIAN_MOBILE } from '../lib/phone.js';
import { openSecret, sealSecret } from '../lib/totp.js';
import { JusgoError, jusgoSignatureValid, type JusgoProfile } from '../lib/jusgo.js';
import { publicUser } from './auth.js';
import { BUSINESS_TYPES, EDITABLE } from './ownerApplication.js';

/*
 * "I'm already registered in JusGo": a venue owner signs up on PlaynX with their JusGo profile and onboarding details.
 *   1. email + JusGo Owner ID → PlaynX emails a code (proves the email before JusGo is contacted)
 *   2. code → PlaynX asks JusGo (customer-link-request); the owner approves it on JusGo
 *   3. JusGo webhook customer.linked (or polling customer-link-status) → PlaynX fetches the profile once,
 *      downloads the documents at once (links last 15 minutes) and keeps them encrypted
 *   4. the owner checks the details, sets a password and the PlaynX owner account is made (or an existing account is linked)
 * Full Aadhaar numbers are never kept: only the last four digits (masked XXXXXXXX1234).
 */

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const OWNER_CODE = /^JGO-[A-Z0-9]{6}$/; // JusGo: "JGO-" + 6 letters or digits
const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const DOC_TYPES: Record<string, string> = { AADHAAR_COPY: 'identity_proof', PROFILE_PHOTO: 'profile_photo', SELF_VERIFICATION: 'self_verification' };
const DOC_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const MAX_DOC_BYTES = 10 * 1024 * 1024;
const password = z.string().min(8).max(72).regex(/[A-Za-z]/, 'Must contain a letter').regex(/[0-9]/, 'Must contain a digit');

/** what we keep from the fetched profile until the account is made (no full Aadhaar) */
interface Kept { missingDocuments?: { type: string; reason: string }[]; profile: Omit<JusgoProfile, 'documents' | 'ids'> & { ids: { pan: string | null; aadhaarLast4: string | null; aadhaarVerified: boolean | null } | null }; documents: { type: string; fileName: string | null; contentType: string; key: string }[] }

const keyOf = (ctx: Ctx) => ctx.cfg.DATA_ENCRYPTION_KEY || ctx.cfg.JWT_SECRET;
const last4 = (a: string | null | undefined) => { const d = (a ?? '').replace(/\D/g, ''); return d.length >= 4 ? d.slice(-4) : null; };
const maskPanShow = (p?: string | null) => (p ? `${p.slice(0, 2)}•••••${p.slice(-2)}` : null);

/** fetch the profile with a one-time code, download its documents and keep it (encrypted). Safe against a webhook and a poll racing. */
export async function claimAndFetch(ctx: Ctx, signupId: string, code: string): Promise<void> {
  const s = (await ctx.db.query(`UPDATE jusgo_link_signups SET status='fetching', updated_at=now() WHERE id=$1 AND status='pending' RETURNING *`, [signupId])).rows[0];
  if (!s || !ctx.jusgo) return; // already being fetched, finished or stopped
  const fail = (msg: string) => ctx.db.query(`UPDATE jusgo_link_signups SET status='failed', failure=$2, updated_at=now() WHERE id=$1`, [signupId, msg]);
  let p: JusgoProfile;
  try { p = await ctx.jusgo.fetchProfile(s.request_id, code); }
  catch (e) {
    const c = e instanceof JusgoError ? e.code : '';
    if (c === 'ALREADY_FETCHED') return void await fail('These JusGo details were already collected. Please start again.');
    if (c === 'UNLINKED') return void await fail('PlaynX was removed from your JusGo account. Please start again.');
    if (c === 'NOT_FOUND') return void await fail('JusGo no longer has this request. Please start again.');
    // an expired or replaced code, or a network problem: back to waiting; the next status check brings a fresh code
    await ctx.db.query(`UPDATE jusgo_link_signups SET status='pending', updated_at=now() WHERE id=$1 AND status='fetching'`, [signupId]);
    return;
  }
  if (p.accountType !== 'VENUE_OWNER') return void await fail('This JusGo account is not a venue owner account. Please sign up normally.');
  if (s.owner_code && (p.publicCode ?? '').toUpperCase() !== String(s.owner_code).toUpperCase()) return void await fail('The JusGo Owner ID does not match this JusGo account. Please check it and try again.');
  // the document links last 15 minutes: download now, store privately (encrypted by the storage layer)
  const documents: Kept['documents'] = []; const missingDocuments: NonNullable<Kept['missingDocuments']> = [];
  for (const d of p.documents ?? []) {
    if (!DOC_TYPES[d.type]) continue;
    if (!d.url) { missingDocuments.push({ type: d.type, reason: 'JusGo did not send a link for it' }); continue; }
    try {
      const f = await ctx.jusgo.download(d.url);
      const type = DOC_MIME.includes(f.contentType) ? f.contentType : DOC_MIME.includes(d.mimeType ?? '') ? d.mimeType! : '';
      if (!type) { missingDocuments.push({ type: d.type, reason: `unsupported file type (${f.contentType})` }); continue; }
      if (f.data.length === 0 || f.data.length > MAX_DOC_BYTES) { missingDocuments.push({ type: d.type, reason: f.data.length ? 'file larger than 10 MB' : 'empty file' }); continue; }
      documents.push({ type: d.type, fileName: d.fileName, contentType: type, key: await ctx.storage.putPrivate(`jusgo/${signupId}`, f.data, type) });
    } catch (err) {
      console.error('[jusgo] document download failed', d.type, (err as Error).message);
      missingDocuments.push({ type: d.type, reason: 'could not be downloaded from JusGo' });
    }
  }
  const { documents: _drop, ids, ...rest } = p;
  const kept: Kept = { profile: { ...rest, ids: ids ? { pan: ids.pan, aadhaarLast4: last4(ids.aadhaar), aadhaarVerified: ids.aadhaarVerified } : null }, documents, missingDocuments };
  await ctx.db.query(`UPDATE jusgo_link_signups SET status='fetched', profile_enc=$2, jusgo_user_id=$3, failure=NULL, updated_at=now() WHERE id=$1`,
    [signupId, sealSecret(JSON.stringify(kept), keyOf(ctx)), p.jusgoUserId]);
  await audit(ctx.db, null, 'jusgo.profile_fetched', 'jusgo_link', signupId, { documents: documents.length, missingDocuments });
}

/** the owner removed PlaynX in JusGo: stop using the data and delete the Aadhaar, PAN and documents that came from JusGo */
export async function unlinkJusgoUser(ctx: Ctx, jusgoUserId: string): Promise<void> {
  const users = (await ctx.db.query(`SELECT id FROM users WHERE jusgo_user_id=$1`, [jusgoUserId])).rows;
  for (const u of users) {
    const docs = (await ctx.db.query(`DELETE FROM owner_documents WHERE owner_id=$1 AND source='jusgo' RETURNING storage_key`, [u.id])).rows;
    for (const d of docs) await ctx.storage.deletePrivate?.(d.storage_key).catch(() => {});
    await ctx.db.query(`UPDATE owner_onboarding SET
        pan_number = CASE WHEN 'pan_number' = ANY(jusgo_imported) THEN NULL ELSE pan_number END,
        aadhaar_masked = CASE WHEN 'aadhaar_masked' = ANY(jusgo_imported) THEN NULL ELSE aadhaar_masked END,
        partners = CASE WHEN 'partners' = ANY(jusgo_imported) THEN '[]'::jsonb ELSE partners END,
        jusgo_imported = '{}' WHERE owner_id=$1`, [u.id]);
    await ctx.db.query(`UPDATE users SET jusgo_user_id=NULL, updated_at=now() WHERE id=$1`, [u.id]);
    await audit(ctx.db, null, 'jusgo.unlinked', 'user', u.id, { removedDocuments: docs.length });
  }
  const pending = (await ctx.db.query(`SELECT id, profile_enc FROM jusgo_link_signups WHERE jusgo_user_id=$1 AND profile_enc IS NOT NULL`, [jusgoUserId])).rows;
  for (const s of pending) {
    try { for (const d of (JSON.parse(openSecret(s.profile_enc, keyOf(ctx), [ctx.cfg.JWT_SECRET])) as Kept).documents) await ctx.storage.deletePrivate?.(d.key).catch(() => {}); } catch { /* nothing readable to delete */ }
  }
  await ctx.db.query(`UPDATE jusgo_link_signups SET profile_enc=NULL, status=CASE WHEN status='completed' THEN status ELSE 'unlinked' END, updated_at=now() WHERE jusgo_user_id=$1`, [jusgoUserId]);
}

/** POST /api/webhooks/jusgo (raw body) */
export async function handleJusgoWebhook(ctx: Ctx, req: Request, res: Response) {
  const raw: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === 'string' ? req.body : '');
  if (!jusgoSignatureValid(raw, req.get('x-jusgo-timestamp'), req.get('x-jusgo-signature'), ctx.cfg.JUSGO_WEBHOOK_SECRET, ctx.now().getTime())) return void res.status(401).json({ error: { code: 'bad_signature', message: 'Invalid signature' } });
  let body: any; try { body = JSON.parse(raw.toString('utf8')); } catch { return void res.status(400).json({ error: { code: 'bad_json', message: 'Invalid JSON' } }); }
  const delivery = req.get('x-jusgo-delivery') || body.id || '';
  const type = String(body.type ?? body.event_type ?? req.get('x-jusgo-event') ?? '');
  if (delivery && (await ctx.db.query('SELECT 1 FROM jusgo_webhook_deliveries WHERE delivery_id=$1', [delivery])).rows[0]) return void res.json({ ok: true, duplicate: true });
  const d = body.data ?? {};
  const signup = d.requestId ? (await ctx.db.query('SELECT id FROM jusgo_link_signups WHERE request_id=$1', [String(d.requestId)])).rows[0] : undefined;
  if (type === 'customer.linked' && signup && d.code) await claimAndFetch(ctx, signup.id, String(d.code));
  else if ((type === 'customer.link_denied' || type === 'customer.link_expired') && signup)
    await ctx.db.query(`UPDATE jusgo_link_signups SET status=$2, updated_at=now() WHERE id=$1 AND status IN ('pending','otp_sent')`, [signup.id, type === 'customer.link_denied' ? 'denied' : 'expired']);
  else if (type === 'customer.unlinked' && d.jusgoUserId) await unlinkJusgoUser(ctx, String(d.jusgoUserId));
  if (delivery) await ctx.db.query('INSERT INTO jusgo_webhook_deliveries (delivery_id, event) VALUES ($1,$2) ON CONFLICT DO NOTHING', [delivery, type]);
  res.json({ ok: true });
}

export function jusgoLinkRoutes(ctx: Ctx) {
  const r = Router();
  const rounds = ctx.cfg.NODE_ENV === 'test' ? 4 : 12;
  const now = () => ctx.now();
  const ready = () => { if (!ctx.jusgo?.configured) throw new HttpError(503, 'Signing up with JusGo is not available right now. Please sign up normally.', 'jusgo_not_configured'); };

  async function load(req: Request) {
    const id = parse(z.uuid(), req.params.id); const token = String(req.get('x-link-token') ?? '');
    const s = (await ctx.db.query('SELECT * FROM jusgo_link_signups WHERE id=$1', [id])).rows[0];
    if (!s || !token || s.access_hash !== sha(token)) throw notFound('This sign-up was not found. Please start again.');
    return s;
  }
  async function sendCode(s: { id: string; email: string }) {
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    await ctx.db.query(`UPDATE jusgo_link_signups SET otp_hash=$2, otp_expires_at=$3, otp_sent_at=$4, otp_attempts=0, updated_at=now() WHERE id=$1`,
      [s.id, sha(`${code}:${s.id}`), new Date(now().getTime() + 10 * 60_000).toISOString(), now().toISOString()]);
    await ctx.mailer.send(s.email, 'Your PlaynX verification code', renderEmail({ appUrl: ctx.mailer.appUrl ?? 'http://localhost:5173', ...ctx.mailer.brand, type: 'otp', title: 'Verification code', role: 'owner',
      text: 'Use this code to continue signing up on PlaynX with your JusGo details:',
      html: `<div style="margin:18px 0 6px;padding:18px;border-radius:16px;background:#F5F0FF;border:1px dashed #A100FF;text-align:center;font:800 36px 'Poppins',Arial,sans-serif;letter-spacing:10px;color:#7200FF">${code}</div><div style="font-size:13px;color:#777B90;text-align:center">It expires in 10 minutes. If you did not ask for it, you can ignore this email.</div>` }));
  }
  async function askJusgo(s: { id: string; email: string; owner_code?: string | null }) {
    try {
      const j = await ctx.jusgo!.requestLink(s.email, s.owner_code); // JusGo matches the email and the Owner ID together
      await ctx.db.query(`UPDATE jusgo_link_signups SET request_id=$2, request_expires_at=$3, request_sent_at=$4, status='pending', failure=NULL, updated_at=now() WHERE id=$1`, [s.id, j.requestId, j.expiresAt, now().toISOString()]);
    } catch (e) {
      if (e instanceof JusgoError && e.code === 'VALIDATION_ERROR') throw badRequest('JusGo did not accept this email or Owner ID. Please check them and start again.', 'jusgo_invalid');
      if (e instanceof JusgoError && e.code === 'RATE_LIMITED') throw new HttpError(429, 'JusGo allows only 3 requests an hour for one email. Please try again later, or sign up normally.', 'jusgo_rate_limited');
      console.error('[jusgo] link request failed', e);
      throw new HttpError(502, 'We could not reach JusGo just now. Please try again in a minute.', 'jusgo_unavailable');
    }
  }
  const owner = (kept: Kept | null) => kept?.profile;
  async function view(s: any) {
    let kept: Kept | null = null;
    if (s.status === 'fetched' && s.profile_enc) { try { kept = JSON.parse(openSecret(s.profile_enc, keyOf(ctx), [ctx.cfg.JWT_SECRET])); } catch { kept = null; } }
    const p = owner(kept);
    const existing = p ? (await ctx.db.query(`SELECT 1 FROM users WHERE lower(email)=lower($1) ${p.mobile && INDIAN_MOBILE.test(normalizePhone(p.mobile)) ? 'OR phone = ANY($2)' : ''} LIMIT 1`,
      p.mobile && INDIAN_MOBILE.test(normalizePhone(p.mobile)) ? [s.email, phoneCandidates(p.mobile)] : [s.email])).rows[0] : undefined;
    return {
      id: s.id, status: s.status, email: s.email, ownerCode: s.owner_code, failure: s.failure ?? null,
      otpResendAt: s.otp_sent_at ? new Date(new Date(s.otp_sent_at).getTime() + 60_000).toISOString() : null,
      expiresAt: s.request_expires_at, resendAt: s.request_sent_at ? new Date(new Date(s.request_sent_at).getTime() + 60_000).toISOString() : null,
      existingAccount: !!existing,
      profile: p ? {
        publicCode: p.publicCode, name: p.name, email: p.email ?? s.email, mobile: p.mobile, dateOfBirth: p.dateOfBirth, turfPhone: p.turfPhone, address: p.address,
        business: p.business ? { accountType: p.business.accountType, legalName: p.business.legalName, gstin: p.business.gstin, address: p.business.address,
          partners: (p.business.details?.people ?? []).map((x) => String(x.values?.name ?? '')).filter(Boolean) } : null,
        panMasked: maskPanShow(p.ids?.pan), aadhaarMasked: p.ids?.aadhaarLast4 ? `XXXXXXXX${p.ids.aadhaarLast4}` : null, aadhaarVerified: p.ids?.aadhaarVerified ?? null,
        verification: p.verification?.status ?? null,
        documents: kept!.documents.map((d) => ({ type: d.type, fileName: d.fileName })),
        missingDocuments: (kept!.missingDocuments ?? []).map((d) => d.type), // JusGo had them but they could not be copied: upload them in the application
      } : null,
    };
  }

  /** 1. email + JusGo Owner ID: a PlaynX code goes to the email */
  r.post('/', async (req, res) => {
    ready();
    const b = parse(z.object({ email: z.email().max(254).transform((x) => x.trim().toLowerCase()), ownerCode: z.string().trim().transform((x) => x.toUpperCase()).pipe(z.string().regex(OWNER_CODE, 'Enter your JusGo Owner ID, e.g. JGO-7X9QVZ')) }), req.body);
    const recent = (await ctx.db.query(`SELECT count(*)::int AS n FROM jusgo_link_signups WHERE lower(email)=$1 AND created_at > $2`, [b.email, new Date(now().getTime() - 3600_000).toISOString()])).rows[0].n;
    if (recent >= 5) throw new HttpError(429, 'Too many tries for this email. Please try again in an hour.', 'jusgo_too_many');
    const token = crypto.randomBytes(32).toString('base64url');
    const s = (await ctx.db.query(`INSERT INTO jusgo_link_signups (email, owner_code, access_hash) VALUES ($1,$2,$3) RETURNING *`, [b.email, b.ownerCode, sha(token)])).rows[0];
    await sendCode(s);
    res.status(201).json({ token, signup: await view((await ctx.db.query('SELECT * FROM jusgo_link_signups WHERE id=$1', [s.id])).rows[0]) });
  });

  r.post('/:id/otp/resend', async (req, res) => {
    const s = await load(req);
    if (s.status !== 'otp_sent') throw badRequest('Your email is already confirmed', 'already_verified');
    if (s.otp_sent_at && now().getTime() - new Date(s.otp_sent_at).getTime() < 60_000) throw new HttpError(429, 'Please wait a minute before asking for another code.', 'otp_cooldown');
    await sendCode(s);
    res.json({ signup: await view((await ctx.db.query('SELECT * FROM jusgo_link_signups WHERE id=$1', [s.id])).rows[0]) });
  });

  /** 2. the PlaynX code: only then is JusGo asked */
  r.post('/:id/otp/verify', async (req, res) => {
    ready();
    const s = await load(req);
    const { code } = parse(z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code') }), req.body);
    if (s.status !== 'otp_sent') throw badRequest('Your email is already confirmed', 'already_verified');
    if (!s.otp_expires_at || new Date(s.otp_expires_at) < now()) throw badRequest('This code has expired. Ask for a new one.', 'otp_expired');
    if (s.otp_attempts >= 5) throw new HttpError(429, 'Too many attempts. Ask for a new code.', 'otp_locked');
    await ctx.db.query('UPDATE jusgo_link_signups SET otp_attempts=otp_attempts+1 WHERE id=$1', [s.id]);
    if (!crypto.timingSafeEqual(Buffer.from(sha(`${code}:${s.id}`)), Buffer.from(s.otp_hash ?? ''.padEnd(64, '0')))) throw badRequest('Incorrect code', 'otp_invalid');
    await ctx.db.query(`UPDATE jusgo_link_signups SET otp_verified_at=now(), otp_hash=NULL, updated_at=now() WHERE id=$1`, [s.id]);
    await askJusgo(s);
    res.json({ signup: await view((await ctx.db.query('SELECT * FROM jusgo_link_signups WHERE id=$1', [s.id])).rows[0]) });
  });

  /** "Resend": a new JusGo request (JusGo sends one email per request) */
  r.post('/:id/resend', async (req, res) => {
    ready();
    const s = await load(req);
    if (!s.otp_verified_at) throw badRequest('Confirm your email first', 'otp_required');
    if (!['pending', 'expired', 'denied', 'failed'].includes(s.status)) throw badRequest('Nothing to resend', 'not_waiting');
    if (s.request_sent_at && now().getTime() - new Date(s.request_sent_at).getTime() < 60_000) throw new HttpError(429, 'Please wait a minute before sending again.', 'resend_cooldown');
    await askJusgo(s);
    res.json({ signup: await view((await ctx.db.query('SELECT * FROM jusgo_link_signups WHERE id=$1', [s.id])).rows[0]) });
  });

  /** 3. the page asks every 3 s; when no webhook has arrived, JusGo's status is checked and an approval is fetched */
  r.get('/:id', async (req, res) => {
    let s = await load(req);
    if (s.status === 'pending' && s.request_id && ctx.jusgo) {
      if (s.request_expires_at && new Date(s.request_expires_at) < now()) {
        await ctx.db.query(`UPDATE jusgo_link_signups SET status='expired', updated_at=now() WHERE id=$1 AND status='pending'`, [s.id]);
      } else {
        try {
          const st = await ctx.jusgo.linkStatus(s.request_id);
          if (st.status === 'APPROVED' && st.code) await claimAndFetch(ctx, s.id, st.code);
          else if (st.status === 'APPROVED' && st.fetched) await ctx.db.query(`UPDATE jusgo_link_signups SET status='failed', failure='These JusGo details were already collected. Please start again.' WHERE id=$1 AND status='pending'`, [s.id]);
          else if (st.status === 'DENIED' || st.status === 'EXPIRED') await ctx.db.query(`UPDATE jusgo_link_signups SET status=$2, updated_at=now() WHERE id=$1 AND status='pending'`, [s.id, st.status === 'DENIED' ? 'denied' : 'expired']);
        } catch (e) { console.error('[jusgo] status check failed', (e as Error).message); }
      }
      s = (await ctx.db.query('SELECT * FROM jusgo_link_signups WHERE id=$1', [s.id])).rows[0];
    }
    res.json({ signup: await view(s) });
  });

  /** 4. finish: a new PlaynX owner account with the JusGo details, or link the account this email / mobile already has */
  r.post('/:id/complete', async (req, res) => {
    const s = await load(req);
    if (s.status !== 'fetched' || !s.profile_enc) throw badRequest('Your JusGo details are not ready yet', 'not_ready');
    const kept: Kept = JSON.parse(openSecret(s.profile_enc, keyOf(ctx), [ctx.cfg.JWT_SECRET]));
    const p = kept.profile;
    const mobile = p.mobile && INDIAN_MOBILE.test(normalizePhone(p.mobile)) ? normalizePhone(p.mobile) : null;
    const byEmail = (await ctx.db.query('SELECT * FROM users WHERE lower(email)=lower($1)', [s.email])).rows[0];
    const byMobile = !byEmail && mobile ? (await ctx.db.query('SELECT * FROM users WHERE phone = ANY($1)', [phoneCandidates(mobile)])).rows[0] : undefined;
    const existing = byEmail ?? byMobile;
    const clear = async (userId: string | null, keepDocs: boolean) => {
      if (!keepDocs) for (const d of kept.documents) await ctx.storage.deletePrivate?.(d.key).catch(() => {});
      await ctx.db.query(`UPDATE jusgo_link_signups SET status='completed', profile_enc=NULL, user_id=$2, updated_at=now() WHERE id=$1`, [s.id, userId]);
    };

    if (existing) {
      if (existing.jusgo_user_id && existing.jusgo_user_id !== p.jusgoUserId) throw conflict('This PlaynX account is already linked to a different JusGo account.');
      const other = (await ctx.db.query('SELECT id FROM users WHERE jusgo_user_id=$1 AND id <> $2', [p.jusgoUserId, existing.id])).rows[0];
      if (other) throw conflict('This JusGo account is already linked to another PlaynX account.');
      let filled = false;
      await ctx.db.tx(async (q) => {
        await q.query('UPDATE users SET jusgo_user_id=$2, updated_at=now() WHERE id=$1', [existing.id, p.jusgoUserId]);
        const ob = existing.role === 'owner' ? (await q.query('SELECT status FROM owner_onboarding WHERE owner_id=$1', [existing.id])).rows[0] : undefined;
        if (ob && EDITABLE.includes(ob.status)) { await fillOnboarding(q, existing.id, kept, true); filled = true; }
      });
      await clear(existing.id, filled);
      await audit(ctx.db, req, 'jusgo.linked_existing', 'user', existing.id, { filled });
      // no sign-in here: the person logs in to their existing account as usual
      return void res.json({ linkedExisting: true, role: existing.role, onboardingFilled: filled });
    }

    const b = parse(z.object({ password, fullName: z.string().trim().min(2).max(100).optional(), acceptTerms: z.literal(true, 'Please accept the terms to continue') }), req.body);
    const name = (b.fullName ?? p.name ?? [p.firstName, p.lastName].filter(Boolean).join(' ')).trim() || s.email;
    const user = await ctx.db.tx(async (q) => {
      const u = (await q.query(`INSERT INTO users (email, phone, password_hash, full_name, role, email_verified, jusgo_user_id) VALUES ($1,$2,$3,$4,'owner',true,$5) RETURNING *`,
        [s.email, mobile, await bcrypt.hash(b.password, rounds), name.slice(0, 100), p.jusgoUserId])).rows[0];
      await q.query(`INSERT INTO owner_onboarding (owner_id, business_name) VALUES ($1,$2)`, [u.id, p.business?.legalName ?? name]);
      await fillOnboarding(q, u.id, kept, false);
      await audit(q, null, 'user.register_jusgo', 'user', u.id, { jusgoUserId: p.jusgoUserId });
      return u;
    });
    await clear(user.id, true);
    await syncAccount(ctx.db, user.id);
    await ctx.notifier.notifyAdmins('users', { title: 'New turf owner registered', body: `${user.full_name} signed up with their JusGo details and is completing the application.`, type: 'admin_owner_registered', email: true, data: { link: '/admin/applications' } });
    res.status(201).json({ token: signToken(ctx, user), user: publicUser(user) });
  });

  return r;
}

/** copy the JusGo onboarding details into the PlaynX application; with onlyEmpty, never overwrite what the owner already typed */
async function fillOnboarding(q: { query: (sql: string, p?: any[]) => Promise<{ rows: any[] }> }, ownerId: string, kept: Kept, onlyEmpty: boolean) {
  const p = kept.profile; const a = p.address; const bz = p.business;
  const type = bz?.accountType ? bz.accountType.toLowerCase() : null;
  const pan = p.ids?.pan && PAN.test(p.ids.pan.toUpperCase()) ? p.ids.pan.toUpperCase() : null;
  const people = (bz?.details?.people ?? []).map((x) => ({ name: x.values?.name ?? null, pan: x.values?.pan ?? null, aadhaarLast4: last4(String(x.values?.aadhaar ?? '')), phone: x.values?.phone ?? null })).filter((x) => x.name);
  const fields: Record<string, unknown> = {
    account_type: type && (BUSINESS_TYPES as readonly string[]).includes(type) ? type : null,
    business_name: bz?.legalName ?? null, legal_full_name: p.name ?? null, gstin: bz?.gstin ?? null, pan_number: pan,
    address_line1: a?.line1 ?? bz?.address ?? null, address_line2: a?.line2 ?? null, city: a?.city ?? null, state: a?.state ?? null, postal_code: a?.pincode ?? null,
    date_of_birth: p.dateOfBirth ?? null, turf_phone: p.turfPhone ?? null,
    aadhaar_masked: p.ids?.aadhaarLast4 ? `XXXXXXXX${p.ids.aadhaarLast4}` : null,
    partners: people.length ? JSON.stringify(people) : null,
  };
  const set = Object.entries(fields).filter(([, v]) => v !== null);
  if (set.length) {
    const cols = set.map(([k], i) => (onlyEmpty ? `${k} = COALESCE(${k === 'partners' ? `NULLIF(${k}, '[]'::jsonb)` : k}, $${i + 2}${k === 'partners' ? '::jsonb' : k === 'date_of_birth' ? '::date' : ''})` : `${k} = $${i + 2}${k === 'partners' ? '::jsonb' : k === 'date_of_birth' ? '::date' : ''}`));
    await q.query(`UPDATE owner_onboarding SET ${cols.join(', ')}${fields.aadhaar_masked ? `, identity_type='aadhaar_masked'` : ''},
        jusgo_imported = (SELECT array_agg(DISTINCT x) FROM unnest(jusgo_imported || $${set.length + 2}::text[]) x) WHERE owner_id=$1`,
      [ownerId, ...set.map(([, v]) => v), set.map(([k]) => k)]);
  }
  for (const d of kept.documents) {
    const docType = DOC_TYPES[d.type];
    if (onlyEmpty && (await q.query(`SELECT 1 FROM owner_documents WHERE owner_id=$1 AND doc_type=$2 AND status <> 'replaced'`, [ownerId, docType])).rows[0]) continue;
    await q.query(`UPDATE owner_documents SET status='replaced' WHERE owner_id=$1 AND doc_type=$2 AND status <> 'replaced'`, [ownerId, docType]);
    await q.query(`INSERT INTO owner_documents (owner_id, doc_type, storage_key, content_type, source) VALUES ($1,$2,$3,$4,'jusgo')`, [ownerId, docType, d.key, d.contentType]);
  }
}
