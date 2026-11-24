import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import type { Ctx } from '../types.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { parse } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { normalizePhone, INDIAN_MOBILE, INDIAN_MOBILE_MESSAGE } from '../lib/phone.js';
import { checkedFile, upload } from '../lib/upload.js';
import { sendStoredFile } from '../lib/private-file.js';

export const BUSINESS_TYPES = ['individual', 'sole_proprietorship', 'partnership_pvt_ltd', 'partnership', 'private_limited', 'opc', 'llp', 'trust_society'] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];
export const DOC_TYPES = ['pan_card', 'identity_proof', 'address_proof', 'business_registration', 'partnership_deed', 'incorporation_certificate', 'authorization_letter', 'profile_photo', 'self_verification'] as const;
export const EDITABLE = ['incomplete', 'info_required', 'resubmission_required'];
export const TERMS_VERSION = '2026-11';

/** Documents every application needs, by business type. Sole proprietors' registration proof is optional ("if applicable"). */
export const REQUIRED_DOCS: Record<BusinessType, string[]> = {
  // JusGo's Documents step (the Aadhaar card number and a copy of the Aadhaar card / government ID) and the live self-verification photo. The PAN is typed once, on the account type form.
  individual: ['identity_proof', 'self_verification'], partnership_pvt_ltd: ['identity_proof', 'self_verification'], sole_proprietorship: ['identity_proof', 'self_verification'], partnership: ['identity_proof', 'self_verification'],
  private_limited: ['identity_proof', 'self_verification'], llp: ['identity_proof', 'self_verification'], opc: ['identity_proof', 'self_verification'], trust_society: ['identity_proof', 'self_verification'],
};
/** Which section of the application each document belongs to. */
export const IDENTITY_DOCS = ['pan_card', 'identity_proof', 'address_proof', 'authorization_letter', 'self_verification'];
export const BUSINESS_DOCS = ['business_registration', 'partnership_deed', 'incorporation_certificate'];
export const sectionOfDoc = (t: string) => (BUSINESS_DOCS.includes(t) ? 'business' : IDENTITY_DOCS.includes(t) ? 'identity' : null);
export const DOC_LABEL: Record<string, string> = {
  pan_card: 'PAN card', identity_proof: 'Aadhaar / Government ID copy', address_proof: 'Business address proof', business_registration: 'Business registration proof',
  partnership_deed: 'Partnership deed', incorporation_certificate: 'Certificate of incorporation', authorization_letter: 'Authorization letter', profile_photo: 'Profile photograph', self_verification: 'Self verification photo',
};

const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/, CIN = /^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/, LLPIN = /^[A-Z]{3}-[0-9]{4}$/, GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const maskPan = (p?: string | null) => (p ? `${p.slice(0, 2)}•••••${p.slice(-2)}` : null);
const up = (s: string) => s.trim().toUpperCase();

/** Owner account status is derived (never stored) so it can't drift from the facts it summarises. */
export function accountStatus(u: { is_active: boolean; email_verified: boolean; phone_verified: boolean }, p: { verification_status: string; application_status: string }, phoneRequired: boolean) {
  if (!u.is_active) return 'suspended';
  if (p.verification_status === 'rejected' || p.application_status === 'rejected') return 'rejected';
  if (p.application_status === 'approved' && p.verification_status === 'verified') return 'active';
  if (!u.email_verified) return 'registered';
  if (phoneRequired && !u.phone_verified) return 'contact_verification_pending';
  if (p.application_status === 'incomplete') return 'profile_incomplete';
  return 'verification_pending';
}

const base = { state: z.string().trim().min(2, 'Select the state').max(60), city: z.string().trim().min(2, 'Select the city').max(80), pincode: z.string().trim().regex(/^[1-9][0-9]{5}$/, 'Enter a valid 6-digit PIN code'),
  businessName: z.string().trim().min(2).max(150), pan: z.string().transform(up).pipe(z.string().regex(PAN, 'Enter a valid PAN, e.g. ABCDE1234F')).optional(),
  address: z.string().trim().min(5).max(300), gstin: z.string().transform(up).pipe(z.string().regex(GSTIN, 'Enter a valid GSTIN')).optional().or(z.literal('').transform(() => undefined)) };
const name = z.string().trim().min(2).max(100).regex(/^[\p{L}][\p{L} .'-]*$/u, 'Use letters only');
const phoneNo = z.string().trim().regex(INDIAN_MOBILE, INDIAN_MOBILE_MESSAGE);
const optPhone = phoneNo.optional().or(z.literal('').transform(() => undefined));
const UDYAM = /^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$/;
const extras = {
  udyamNumber: z.string().transform(up).pipe(z.string().regex(UDYAM, 'Enter a valid Udyam number, e.g. UDYAM-TN-00-0000000')).optional().or(z.literal('').transform(() => undefined)),
  otherInfo: z.string().trim().max(500).optional().or(z.literal('').transform(() => undefined)),
};
const partner = z.object({
  name, pan: z.string().transform(up).pipe(z.string().regex(PAN, 'Enter a valid PAN, e.g. ABCDE1234F')),
  aadhaar: z.string().transform((x) => x.replace(/\s/g, '')).pipe(z.string().regex(/^[0-9]{12}$/, 'Enter the 12-digit Aadhaar number')), phone: phoneNo,
});
const adult = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter your date of birth').refine((d) => { const t = new Date(d + 'T00:00:00Z'); const lim = new Date(); lim.setUTCFullYear(lim.getUTCFullYear() - 18); return !Number.isNaN(+t) && t <= lim; }, 'You must be at least 18 years old');
export const businessSchema = z.discriminatedUnion('businessType', [
  z.object({ businessType: z.literal('individual'), ...base, businessName: base.businessName.optional(), representativeName: name, dob: adult, phone: phoneNo }),
  z.object({ businessType: z.literal('partnership_pvt_ltd'), ...base, representativeName: name, phone: phoneNo,
    registrationNumber: z.string().transform(up).pipe(z.string().regex(CIN, 'Enter a valid 21-character CIN')).optional().or(z.literal('').transform(() => undefined)),
    partners: z.array(partner).min(1, 'Add at least one partner or director').max(20), ...extras }),
  z.object({ businessType: z.literal('sole_proprietorship'), ...base, representativeName: name, phone: optPhone, ...extras }),
  z.object({ businessType: z.literal('partnership'), ...base, representativeName: name, designation: z.string().trim().min(2).max(60) }),
  z.object({ businessType: z.literal('private_limited'), ...base, representativeName: name, designation: z.string().trim().min(2).max(60), registrationNumber: z.string().transform(up).pipe(z.string().regex(CIN, 'Enter a valid 21-character CIN')) }),
  z.object({ businessType: z.literal('opc'), ...base, representativeName: name, designation: z.string().trim().max(60).optional(), registrationNumber: z.string().transform(up).pipe(z.string().regex(CIN, 'Enter a valid 21-character CIN')) }),
  z.object({ businessType: z.literal('trust_society'), ...base, representativeName: name, designation: z.string().trim().min(2).max(60), registrationNumber: z.string().transform(up).pipe(z.string().regex(/^[A-Z0-9][A-Z0-9/.\- ]{3,39}$/, 'Enter the registration number exactly as on the certificate')) }),
  z.object({ businessType: z.literal('llp'), ...base, representativeName: name, designation: z.string().trim().max(60).optional(), registrationNumber: z.string().transform(up).pipe(z.string().regex(LLPIN, 'Enter a valid LLPIN, e.g. AAB-1234')) }),
]);

export function ownerApplicationRoutes(ctx: Ctx) {
  const r = Router();
  r.use('/application', authenticate(ctx), requireRole('owner'));
  const uid = (req: any) => req.user!.id as string;
  const phoneRequired = ctx.cfg.REQUIRE_PHONE_VERIFICATION === 'true';

  async function load(id: string) {
    const row = (await ctx.db.query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.email_verified, u.phone_verified, u.is_active, u.password_set, p.*, to_char(p.dob, 'YYYY-MM-DD') AS dob_text, u.account_code AS owner_code FROM users u JOIN owner_profiles p ON p.user_id=u.id WHERE u.id=$1`, [id])).rows[0];
    if (!row) throw notFound('Owner not found');
    return row;
  }
  const assertEditable = (p: any) => { if (!EDITABLE.includes(p.application_status)) throw conflict('Your application can\'t be edited right now. Wait for the review or for a correction request.', 'not_editable'); };
  const currentDocs = (id: string) => ctx.db.query(`SELECT id, doc_type, status, note, created_at, reviewed_at FROM owner_documents WHERE owner_id=$1 AND status <> 'replaced' ORDER BY created_at DESC`, [id]);

  /** What's still needed before the application can be submitted. */
  async function missingItems(p: any): Promise<{ type: 'field' | 'document' | 'contact'; key: string; message: string }[]> {
    const m: { type: 'field' | 'document' | 'contact'; key: string; message: string }[] = [];
    if (!p.email_verified) m.push({ type: 'contact', key: 'email', message: 'Verify your email address' });
    if (phoneRequired && !p.phone_verified) m.push({ type: 'contact', key: 'phone', message: 'Verify your mobile number' });
    const t = p.business_type as BusinessType | null;
    if (!t) m.push({ type: 'field', key: 'businessType', message: 'Choose your business type' });
    else {
      if (!p.business_name) m.push({ type: 'field', key: 'businessName', message: 'Enter the business name' });
      if (!p.pan) m.push({ type: 'field', key: 'pan', message: 'Enter the PAN' });
      if (!p.address) m.push({ type: 'field', key: 'address', message: 'Enter the business address' });
      if (EDITABLE.includes(p.application_status)) { // applications submitted before these fields existed are not re-blocked
        if (!p.business_state) m.push({ type: 'field', key: 'state', message: 'Select the state of the business address' });
        if (!p.business_city) m.push({ type: 'field', key: 'city', message: 'Select the city of the business address' });
        if (!p.business_pincode) m.push({ type: 'field', key: 'pincode', message: 'Enter the PIN code of the business address' });
      }
      if (!p.representative_name) m.push({ type: 'field', key: 'representativeName', message: 'Enter the authorized person\'s name' });
      if (['partnership', 'private_limited', 'trust_society'].includes(t) && !p.designation) m.push({ type: 'field', key: 'designation', message: 'Enter the designation' });
      if (['private_limited', 'opc', 'llp', 'trust_society'].includes(t) && !p.registration_number) m.push({ type: 'field', key: 'registrationNumber', message: t === 'llp' ? 'Enter the LLPIN' : t === 'trust_society' ? 'Enter the trust or society registration number' : 'Enter the CIN' });
    }
    if (!p.aadhaar_masked && EDITABLE.includes(p.application_status)) m.push({ type: 'field', key: 'identity', message: 'Enter the Aadhaar card number' }); // applications submitted before this field existed are not re-blocked
    const docs = (await currentDocs(p.id)).rows;
    for (const need of t ? REQUIRED_DOCS[t] : ['identity_proof', 'self_verification']) {
      if (need === 'self_verification' && !EDITABLE.includes(p.application_status)) continue; // applications decided before the photo was asked for are not re-blocked
      const d = docs.find((x: any) => x.doc_type === need);
      if (!d) m.push({ type: 'document', key: need, message: `Upload: ${DOC_LABEL[need]}` });
      else if (d.status === 'rejected') m.push({ type: 'document', key: need, message: `Replace the rejected ${DOC_LABEL[need]}${d.note ? `: ${d.note}` : ''}` });
    }
    return m;
  }

  r.get('/application', async (req, res) => {
    const p = await load(uid(req));
    const [docs, events, venueRows, missing] = await Promise.all([
      currentDocs(p.id),
      ctx.db.query('SELECT kind, from_status, to_status, note, items, created_at FROM application_events WHERE owner_id=$1 ORDER BY created_at DESC, id DESC LIMIT 40', [p.id]),
      ctx.db.query(`SELECT v.id, v.name, v.status, v.city, (SELECT count(*)::int FROM venue_images i WHERE i.venue_id=v.id AND i.area_id IS NULL AND i.kind='image') AS images,
          (SELECT count(*)::int FROM venue_documents d WHERE d.venue_id=v.id AND d.doc_type='Electricity bill' AND d.status <> 'rejected') AS electricity_bills FROM venues v WHERE v.owner_id=$1 ORDER BY v.created_at`, [p.id]),
      p.application_status === 'approved' ? Promise.resolve([]) : missingItems(p),
    ]);
    const correction = ['info_required', 'resubmission_required'].includes(p.application_status)
      ? events.rows.find((e: any) => ['info_requested', 'resubmission_requested'].includes(e.kind)) ?? null : null;
    const flagged = new Set<string>((correction?.items ?? []).map((i: any) => `${i.type}:${i.key}`));
    const t = p.business_type as BusinessType | null;
    const submitted = p.application_status !== 'incomplete';
    const sections = {
      contact: p.email_verified && (!phoneRequired || p.phone_verified) ? 'verified' : 'pending',
      business: p.business_verified_at ? 'verified' : p.application_status === 'approved' ? 'approved' : [...flagged].some((k) => k.startsWith('field:') && k !== 'field:identity') ? 'changes_requested' : !t || (missing as any[]).some((x) => x.type === 'field' && x.key !== 'identity') ? 'incomplete' : submitted ? 'under_review' : 'complete',
      identity: p.identity_verified_at ? 'verified' : p.application_status === 'approved' ? 'approved' : docs.rows.some((d: any) => d.status === 'rejected') || flagged.has('field:identity') ? 'changes_requested' : (missing as any[]).some((x) => x.key === 'identity' || ['pan_card', 'identity_proof', 'address_proof'].includes(x.key)) ? 'incomplete' : submitted ? 'under_review' : 'complete',
    };
    res.json({
      accountStatus: accountStatus(p, p, phoneRequired),
      application: { reference: p.application_ref, status: p.application_status, submittedAt: p.submitted_at, termsAcceptedAt: p.terms_accepted_at, editable: EDITABLE.includes(p.application_status) },
      contact: { email: p.email, phone: p.phone, emailVerified: p.email_verified, phoneVerified: p.phone_verified, phoneRequired, phoneOtpAvailable: !!ctx.cfg.SMS_WEBHOOK_URL },
      owner: { fullName: p.full_name, ownerCode: p.owner_code ?? null },
      business: { type: p.business_type, name: p.business_name, panMasked: maskPan(p.pan), hasPan: !!p.pan, gstin: p.gstin, address: p.address, state: p.business_state, city: p.business_city, pincode: p.business_pincode, registrationNumber: p.registration_number, representativeName: p.representative_name, designation: p.designation,
        dob: p.dob_text ?? null, addressLine2: p.address_line2, country: p.country, phone: p.business_phone, udyamNumber: p.udyam_number, otherInfo: p.other_info, partners: p.partners ?? [] },
      identity: { type: p.identity_type, consentGiven: !!p.identity_consent_at, aadhaarMasked: p.aadhaar_masked ?? null },
      personal: { passwordSet: p.password_set !== false, done: !!(p.password_set !== false && p.dob_text && p.representative_name && p.business_phone && p.address && p.business_state && p.business_city && p.business_pincode) }, // the personal-details step: its answers fill in the later steps
      documents: docs.rows.map((d: any) => ({ id: d.id, docType: d.doc_type, label: DOC_LABEL[d.doc_type], status: d.status, note: d.note, uploadedAt: d.created_at })),
      requiredDocs: (t ? REQUIRED_DOCS[t] : REQUIRED_DOCS.sole_proprietorship).map((k) => ({ docType: k, label: DOC_LABEL[k] })),
      venues: venueRows.rows, sections, missing, correction: correction ? { kind: correction.kind, note: correction.note, items: correction.items, at: correction.created_at } : null,
      events: events.rows,
    });
  });

  r.put('/application/business', async (req, res) => {
    const p = await load(uid(req)); assertEditable(p);
    const b = parse(businessSchema, req.body);
    const full = b as any;
    await ctx.db.query(
      `UPDATE owner_profiles SET business_type=$2, business_name=$3, pan=COALESCE($4, pan), address=$5, gstin=$6, registration_number=$7, representative_name=$8, designation=$9, business_state=$10, business_city=$11, business_pincode=$12,
         dob=COALESCE($13::date, dob), business_phone=COALESCE($14, business_phone), udyam_number=$15, other_info=$16, partners=$17::jsonb, business_verified_at=NULL WHERE user_id=$1`,
      [p.id, b.businessType, b.businessName ?? b.representativeName, b.pan ?? null, b.address, b.gstin ?? p.gstin ?? null, full.registrationNumber ?? null, b.representativeName, full.designation ?? (b.businessType === 'llp' ? 'Designated Partner' : null), b.state, b.city, b.pincode,
        full.dob ?? null, full.phone ?? null, full.udyamNumber ?? null, full.otherInfo ?? null,
        JSON.stringify((full.partners ?? []).map((x: any) => ({ name: x.name, pan: x.pan, aadhaarLast4: String(x.aadhaar).slice(-4), phone: x.phone })))]);
    await audit(ctx.db, req, 'application.business_saved', 'user', p.id, { businessType: b.businessType });
    res.json({ saved: true });
  });

  /** Personal details (after the email is verified): who the owner is and where the turf is. The business and identity steps start from these answers. */
  r.put('/application/personal', async (req, res) => {
    const p = await load(uid(req)); assertEditable(p);
    const b = parse(z.object({
      legalName: name, dob: adult, phone: phoneNo, addressLine1: z.string().trim().min(5, 'Enter the address').max(300), addressLine2: z.string().trim().max(200).optional(),
      state: base.state, city: base.city, pincode: base.pincode, country: z.string().trim().min(2).max(60).default('India'),
    }), req.body);
    await ctx.db.query(
      `UPDATE owner_profiles SET representative_name=$2, dob=$3::date, business_phone=$4, address=$5, address_line2=$6, business_state=$7, business_city=$8, business_pincode=$9, country=$10, business_verified_at=NULL WHERE user_id=$1`,
      [p.id, b.legalName, b.dob, normalizePhone(b.phone), b.addressLine1, b.addressLine2 || null, b.state, b.city, b.pincode, b.country]);
    await audit(ctx.db, req, 'application.personal_saved', 'user', p.id, {});
    res.json({ saved: true });
  });

  r.put('/application/identity', async (req, res) => {
    const p = await load(uid(req)); assertEditable(p);
    // the Aadhaar number is typed here and kept masked (XXXXXXXX1234); leave it out to keep the one already saved
    const b = parse(z.object({ aadhaarNumber: z.string().transform((x) => x.replace(/\s/g, '')).pipe(z.string().regex(/^[0-9]{12}$/, 'Enter the 12-digit Aadhaar number')).optional() }), req.body);
    if (!b.aadhaarNumber && !p.aadhaar_masked) throw badRequest('Enter the 12-digit Aadhaar number', 'validation_error', { field: 'aadhaarNumber' });
    if (b.aadhaarNumber) await ctx.db.query(`UPDATE owner_onboarding SET aadhaar_masked=$2, identity_type='aadhaar_masked', identity_verified_at=NULL WHERE owner_id=$1`, [p.id, `XXXXXXXX${b.aadhaarNumber.slice(-4)}`]);
    else await ctx.db.query(`UPDATE owner_onboarding SET identity_type='aadhaar_masked' WHERE owner_id=$1 AND identity_type IS DISTINCT FROM 'aadhaar_masked'`, [p.id]);
    await audit(ctx.db, req, 'application.identity_saved', 'user', p.id, { aadhaarChanged: !!b.aadhaarNumber });
    res.json({ saved: true });
  });

  /** Upload (or replace) an identity/business document. Files go to private storage and are never given a public URL. */
  r.post('/application/documents', upload.single('file'), async (req, res) => {
    const p = await load(uid(req)); assertEditable(p);
    const { docType } = parse(z.object({ docType: z.enum(DOC_TYPES) }), req.body);
    const f = checkedFile(req.file, ['profile_photo', 'self_verification'].includes(docType) ? ['image/jpeg', 'image/png', 'image/webp'] : ['image/jpeg', 'image/png', 'application/pdf']);
    const key = await ctx.storage.putPrivate(`owner-docs/${p.id}`, f.buffer, f.type);
    const doc = await ctx.db.tx(async (q) => {
      const old = await q.query(`UPDATE owner_documents SET status='replaced' WHERE owner_id=$1 AND doc_type=$2 AND status <> 'replaced' RETURNING id`, [p.id, docType]);
      const d = (await q.query(`INSERT INTO owner_documents (owner_id, doc_type, storage_key, content_type) VALUES ($1,$2,$3,$4) RETURNING id, doc_type, status, created_at`, [p.id, docType, key, f.type])).rows[0];
      const sec = sectionOfDoc(docType); // a replaced document must be re-checked
      if (sec) await q.query(`UPDATE owner_profiles SET ${sec}_verified_at=NULL WHERE user_id=$1`, [p.id]);
      if (old.rows.length && p.application_status !== 'incomplete')
        await q.query(`INSERT INTO application_events (owner_id, kind, note, items, actor_id) VALUES ($1,'document_replaced',$2,$3,$1)`, [p.id, `${DOC_LABEL[docType]} replaced`, JSON.stringify([{ type: 'document', key: docType }])]);
      return d;
    });
    res.status(201).json({ document: { id: doc.id, docType: doc.doc_type, label: DOC_LABEL[doc.doc_type], status: doc.status, uploadedAt: doc.created_at } });
  });

  r.get('/application/documents/:id/file', async (req, res) => {
    const d = (await ctx.db.query('SELECT owner_id, storage_key FROM owner_documents WHERE id=$1', [parse(z.uuid(), req.params.id)])).rows[0];
    if (!d) throw notFound('Document not found');
    if (d.owner_id !== uid(req)) throw forbidden();
    await sendStoredFile(ctx, res, `key:${d.storage_key}`);
  });

  /** Submit (or re-submit after corrections). Generates the application reference on first submission. */
  r.post('/application/submit', async (req, res) => {
    const p = await load(uid(req)); assertEditable(p);
    parse(z.object({ acceptTerms: z.literal(true, { message: 'Accept the Terms, Privacy Policy and Venue Owner Agreement' }), declaration: z.literal(true, { message: 'Confirm that the details are accurate' }) }), req.body);
    const missing = await missingItems(p);
    if (missing.length) throw badRequest(`Complete these before submitting: ${missing.map((m) => m.message).join('; ')}`, 'incomplete_application', { missing });
    const resubmit = p.application_status !== 'incomplete';
    let ref: string = p.application_ref;
    if (!ref) {
      for (let i = 0; i < 5 && !ref; i++) {
        const cand = `KOA-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        if (!(await ctx.db.query('SELECT 1 FROM owner_profiles WHERE application_ref=$1', [cand])).rows[0]) ref = cand;
      }
    }
    await ctx.db.tx(async (q) => {
      await q.query(`UPDATE owner_profiles SET application_status='submitted', application_ref=$2, submitted_at=COALESCE(submitted_at, now()), terms_accepted_at=now(), identity_consent_at=COALESCE(identity_consent_at, now()), terms_version=$3,
          verification_status = CASE WHEN verification_status='rejected' THEN 'pending' ELSE verification_status END WHERE user_id=$1`, [p.id, ref, TERMS_VERSION]);
      await q.query(`INSERT INTO application_events (owner_id, kind, from_status, to_status, note, actor_id) VALUES ($1,$2,$3,'submitted',$4,$1)`, [p.id, resubmit ? 'resubmitted' : 'submitted', p.application_status, resubmit ? 'Owner resubmitted after corrections' : 'Application submitted']);
      await audit(q, req, resubmit ? 'application.resubmit' : 'application.submit', 'user', p.id, { reference: ref });
    });
    await ctx.notifier.notifyAdmins('users', { title: resubmit ? 'Owner application resubmitted' : 'New owner application submitted', type: 'admin_application_submitted', email: true,
      body: `${p.full_name} (${p.business_name}) ${resubmit ? 'resubmitted' : 'submitted'} application ${ref}.`, data: { link: `/admin/applications?owner=${p.id}` } });
    await ctx.notifier.notify(p.id, { title: 'Application submitted', type: 'application', email: true, data: { link: '/owner/application' },
      body: `Your KickOff venue owner application ${ref} has been submitted. Our verification team will review it and notify you about the status.` });
    res.json({ reference: ref, status: 'submitted', message: 'Your KICKOFF Venue Owner application has been submitted successfully. Our verification team will review your information and notify you about the approval status.' });
  });

  return r;
}
