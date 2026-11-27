import { Router } from 'express';
import { z } from 'zod';
import type { Ctx } from '../types.js';
import { authenticate, requirePermission, requireRole } from '../middleware/auth.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { parse } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { sendStoredFile } from '../lib/private-file.js';
import { BANK_COLUMNS, FIELD_LABEL, describeChange } from '../lib/ownerProfile.js';
import { BUSINESS_DOCS, DOC_LABEL, IDENTITY_DOCS, REQUIRED_DOCS, saveBusiness, sectionOfDoc, type BusinessType } from './ownerApplication.js';

const REVIEW = ['submitted', 'under_review', 'info_required', 'resubmission_required'];

export function adminApplicationRoutes(ctx: Ctx) {
  const r = Router();
  r.use(['/applications', '/owner-documents', '/profile-changes', '/business-changes'], authenticate(ctx), requireRole('admin'), requirePermission('users')); // scoped: this router shares the /api/admin mount

  // ---- changes an approved owner made to sensitive profile details; nothing goes live until it is approved here
  // ---------------- business type changes asked for by approved owners
  r.get('/business-changes', async (req, res) => {
    const status = parse(z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(), req.query.status);
    const { rows } = await ctx.db.query(
      `SELECT c.id, c.status, c.from_type AS "fromType", c.to_type AS "toType", c.details, c.reason, c.review_note AS "reviewNote", c.created_at AS "createdAt", c.reviewed_at AS "reviewedAt",
              u.id AS "ownerId", u.full_name AS "ownerName", u.email AS "ownerEmail", u.account_code AS "ownerCode", p.business_name AS "currentBusinessName"
         FROM business_change_requests c JOIN users u ON u.id=c.owner_id LEFT JOIN owner_profiles p ON p.user_id=c.owner_id
        WHERE ($1::text IS NULL OR c.status=$1) ORDER BY (c.status='pending') DESC, c.created_at DESC LIMIT 200`, [status ?? null]);
    res.json({ changes: rows });
  });
  r.post('/business-changes/:id/decision', async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    const b = parse(z.object({ decision: z.enum(['approve', 'reject']), note: z.string().trim().max(300).optional() })
      .refine((x) => x.decision === 'approve' || (x.note && x.note.length >= 3), { message: 'Tell the owner why it was rejected', path: ['note'] }), req.body);
    const c = await ctx.db.tx(async (q) => {
      const c = (await q.query(`UPDATE business_change_requests SET status=$2, review_note=$3, reviewed_by=$4, reviewed_at=now() WHERE id=$1 AND status='pending' RETURNING *`,
        [id, b.decision === 'approve' ? 'approved' : 'rejected', b.note ?? null, req.user!.id])).rows[0];
      if (!c) throw notFound('No business type change waiting with this id');
      if (b.decision === 'approve') await saveBusiness(q, c.owner_id, c.details, true); // the admin has checked the new details
      return c;
    });
    await audit(ctx.db, req, b.decision === 'approve' ? 'admin.business_type_change_approved' : 'admin.business_type_change_rejected', 'user', c.owner_id, { from: c.from_type, to: c.to_type, note: b.note ?? null });
    const t = (x: string | null) => String(x ?? '').replace(/_/g, ' ');
    await ctx.notifier.notify(c.owner_id, { title: b.decision === 'approve' ? 'Business type changed' : 'Business type change not approved', type: 'application', email: true, data: { link: '/owner/account/business' },
      body: b.decision === 'approve' ? `Your business type is now ${t(c.to_type)}. Your business details have been updated.` : `Your request to change your business type to ${t(c.to_type)} was rejected: ${b.note}. Your business details stay as they were.` });
    res.json({ id, status: c.status });
  });

  r.get('/profile-changes', async (req, res) => {
    const status = z.enum(['pending', 'all']).default('pending').parse(req.query.status ?? 'pending');
    const { rows } = await ctx.db.query(
      `SELECT c.id, c.changes AS fields, c.status, c.review_note AS note, c.created_at AS requested_at, c.reviewed_at, u.id AS owner_id, u.full_name, u.email, u.phone, to_jsonb(p) AS current
         FROM owner_profile_change_requests c JOIN users u ON u.id=c.owner_id JOIN owner_profiles p ON p.user_id=u.id
        WHERE c.status <> 'withdrawn' AND ($1::text = 'all' OR c.status='pending') ORDER BY (c.status='pending') DESC, c.created_at DESC LIMIT 200`, [status]);
    res.json({ changes: rows.map(({ fields, current, ...c }: any) => ({ ...c, businessName: current.business_name, changes: describeChange({ fields }, current) })) });
  });

  r.post('/profile-changes/:id/approve', async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    const out = await ctx.db.tx(async (q) => {
      const c = (await q.query(`SELECT * FROM owner_profile_change_requests WHERE id=$1 FOR UPDATE`, [id])).rows[0];
      if (!c) throw notFound('Request not found');
      if (c.status !== 'pending') throw conflict(`This request was already ${c.status}`, 'already_decided');
      const cols = Object.keys(c.changes as Record<string, string>);
      if (cols.some((k) => !Object.keys(FIELD_LABEL).includes(k))) throw badRequest('Unknown field in request'); // column names are interpolated below, so only known ones pass
      const bank = cols.some((k) => BANK_COLUMNS.includes(k));
      await q.query(`UPDATE owner_profiles SET ${cols.map((k, i) => `${k}=$${i + 2}`).join(', ')}${bank ? ', bank_verified=false' : ''} WHERE user_id=$1`, [c.owner_id, ...cols.map((k) => c.changes[k])]);
      await q.query(`UPDATE owner_profile_change_requests SET status='approved', reviewed_by=$2, reviewed_at=now(), updated_at=now() WHERE id=$1`, [id, req.user!.id]);
      await audit(q, req, 'owner_profile.change_approved', 'user', c.owner_id, { fields: cols });
      return { ownerId: c.owner_id as string, cols, bank };
    });
    await ctx.notifier.notify(out.ownerId, { title: 'Your profile changes were approved', type: 'application', email: true, data: { link: '/owner/account/business' },
      body: `${out.cols.map((k) => FIELD_LABEL[k]).join(', ')} ${out.cols.length === 1 ? 'is' : 'are'} now updated on your account.${out.bank ? ' New payout details are verified by PlaynX finance before the next settlement.' : ''}` });
    if (out.bank) await ctx.notifier.notifyAdmins('payouts', { title: 'Owner bank details need verification', body: "An owner's new payout details were approved. Verify them before paying out.", type: 'admin_bank_changed', email: true, data: { link: '/admin/owners' } });
    res.json({ approved: true });
  });

  r.post('/profile-changes/:id/reject', async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    const b = parse(z.object({ note: z.string().trim().min(3, 'Tell the owner why').max(300) }), req.body);
    const c = (await ctx.db.query(`UPDATE owner_profile_change_requests SET status='rejected', review_note=$2, reviewed_by=$3, reviewed_at=now(), updated_at=now() WHERE id=$1 AND status='pending' RETURNING owner_id, changes AS fields`, [id, b.note, req.user!.id])).rows[0];
    if (!c) throw conflict('This request is no longer pending', 'already_decided');
    await audit(ctx.db, req, 'owner_profile.change_rejected', 'user', c.owner_id, { fields: Object.keys(c.fields), note: b.note });
    await ctx.notifier.notify(c.owner_id, { title: 'Your profile changes were not approved', type: 'application', email: true, data: { link: '/owner/account/business' },
      body: `Your request to change ${Object.keys(c.fields).map((k) => FIELD_LABEL[k]).join(', ')} was not approved. Reason: ${b.note}. Your existing details are unchanged.` });
    res.json({ rejected: true });
  });

  r.get('/applications', async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : 'active_review';
    const { rows } = await ctx.db.query(
      `SELECT u.id AS owner_id, u.full_name, u.email, u.phone, u.is_active, p.business_name, p.business_type, p.application_ref, p.application_status, p.verification_status, p.submitted_at, u.created_at,
         (SELECT count(*)::int FROM venues v WHERE v.owner_id=u.id) AS venues,
         (SELECT count(*)::int FROM owner_documents d WHERE d.owner_id=u.id AND d.status='pending') AS pending_documents
       FROM users u JOIN owner_profiles p ON p.user_id=u.id
      WHERE ($1='all' OR ($1='active_review' AND p.application_status = ANY($2)) OR p.application_status=$1) ORDER BY COALESCE(p.submitted_at, u.created_at) DESC LIMIT 300`, [status, REVIEW]);
    res.json({ applications: rows });
  });

  r.get('/applications/:ownerId', async (req, res) => {
    const id = parse(z.uuid(), req.params.ownerId);
    const o = (await ctx.db.query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.email_verified, u.phone_verified, u.is_active, u.created_at, p.* FROM users u JOIN owner_profiles p ON p.user_id=u.id WHERE u.id=$1`, [id])).rows[0];
    if (!o) throw notFound('Owner not found');
    const [docs, venues, events] = await Promise.all([
      ctx.db.query(`SELECT id, doc_type, status, note, content_type, created_at, reviewed_at FROM owner_documents WHERE owner_id=$1 ORDER BY created_at DESC`, [id]),
      ctx.db.query(`SELECT v.id, v.name, v.status, v.city, v.category,
          (SELECT count(*)::int FROM venue_images i WHERE i.venue_id=v.id) AS media, (SELECT count(*)::int FROM venue_documents d WHERE d.venue_id=v.id) AS documents FROM venues v WHERE v.owner_id=$1 ORDER BY v.created_at`, [id]),
      ctx.db.query(`SELECT e.kind, e.from_status, e.to_status, e.note, e.items, e.created_at, a.full_name AS actor FROM application_events e LEFT JOIN users a ON a.id=e.actor_id WHERE e.owner_id=$1 ORDER BY e.created_at DESC, e.id DESC`, [id]),
    ]);
    const { storage_key: _k, password_hash: _p, ...pub } = o as any;
    res.json({ owner: pub, documents: docs.rows.map((d: any) => ({ ...d, label: DOC_LABEL[d.doc_type] })), venues: venues.rows, events: events.rows });
  });

  /** Verification staff view identity documents here; every view is audit-logged and the file is never public. */
  r.get('/owner-documents/:id/file', async (req, res) => {
    const d = (await ctx.db.query('SELECT id, owner_id, storage_key FROM owner_documents WHERE id=$1', [parse(z.uuid(), req.params.id)])).rows[0];
    if (!d) throw notFound('Document not found');
    await audit(ctx.db, req, 'owner_document.view', 'owner_document', d.id, { owner: d.owner_id });
    await sendStoredFile(ctx, res, `key:${d.storage_key}`);
  });

  r.patch('/owner-documents/:id', async (req, res) => {
    const b = parse(z.object({ status: z.enum(['approved', 'rejected']), note: z.string().trim().max(300).optional() })
      .refine((x) => x.status !== 'rejected' || !!x.note, { message: 'Tell the owner what is wrong with the document', path: ['note'] }), req.body);
    const d = (await ctx.db.query(`UPDATE owner_documents SET status=$2, note=$3, reviewed_by=$4, reviewed_at=now() WHERE id=$1 AND status <> 'replaced' RETURNING id, owner_id, doc_type, status, note`, [parse(z.uuid(), req.params.id), b.status, b.note ?? null, req.user!.id])).rows[0];
    if (!d) throw notFound('Document not found or already replaced');
    await ctx.db.query(`INSERT INTO application_events (owner_id, kind, note, items, actor_id) VALUES ($1,'document_reviewed',$2,$3,$4)`,
      [d.owner_id, `${DOC_LABEL[d.doc_type]} ${b.status}${b.note ? `: ${b.note}` : ''}`, JSON.stringify(b.status === 'rejected' ? [{ type: 'document', key: d.doc_type, reason: b.note }] : []), req.user!.id]);
    await audit(ctx.db, req, `owner_document.${b.status}`, 'owner_document', d.id, { owner: d.owner_id, docType: d.doc_type });
    const sec = sectionOfDoc(d.doc_type);
    if (b.status === 'rejected' && sec) await ctx.db.query(`UPDATE owner_profiles SET ${sec}_verified_at=NULL WHERE user_id=$1`, [d.owner_id]);
    const started = await ctx.db.query(`UPDATE owner_profiles SET application_status='under_review' WHERE user_id=$1 AND application_status='submitted' RETURNING 1`, [d.owner_id]);
    if (started.rows.length) await ctx.db.query(`INSERT INTO application_events (owner_id, kind, from_status, to_status, note, actor_id) VALUES ($1,'review_started','submitted','under_review','Review started',$2)`, [d.owner_id, req.user!.id]);
    if (b.status === 'approved') await ctx.notifier.notify(d.owner_id, { title: 'Document approved', type: 'application', data: { link: '/owner/application' },
      body: `Your ${DOC_LABEL[d.doc_type]} was approved.` });
    if (b.status === 'rejected') await ctx.notifier.notify(d.owner_id, { title: 'Document rejected', type: 'application', email: true, data: { link: '/owner/application' },
      body: `Your ${DOC_LABEL[d.doc_type]} was rejected. Reason: ${b.note}. Please upload a corrected copy.` });
    res.json({ document: d });
  });

  /** Verify (or un-verify) the Business or Identity section on its own. Each owner-facing status card follows this. */
  r.post('/applications/:ownerId/sections', async (req, res) => {
    const id = parse(z.uuid(), req.params.ownerId);
    const b = parse(z.object({ section: z.enum(['business', 'identity']), verified: z.boolean(), note: z.string().trim().max(300).optional() }), req.body);
    const o = (await ctx.db.query('SELECT business_type, application_status, identity_type, identity_consent_at, representative_name, pan, address, business_name, registration_number FROM owner_profiles WHERE user_id=$1', [id])).rows[0];
    if (!o) throw notFound('Owner not found');
    if (!['submitted', 'under_review', 'info_required', 'resubmission_required', 'approved'].includes(o.application_status)) throw conflict('Only a submitted application can be reviewed');
    if (b.verified) {
      const docs = (await ctx.db.query(`SELECT doc_type, status FROM owner_documents WHERE owner_id=$1 AND status <> 'replaced'`, [id])).rows as { doc_type: string; status: string }[];
      const group = b.section === 'identity' ? IDENTITY_DOCS : BUSINESS_DOCS;
      const required = ((REQUIRED_DOCS[o.business_type as BusinessType] ?? []) as string[]).filter((t) => group.includes(t));
      const problems: string[] = [];
      for (const t of required) if (!docs.find((d) => d.doc_type === t)) problems.push(`${DOC_LABEL[t]} has not been uploaded`);
      for (const d of docs.filter((d) => group.includes(d.doc_type) && d.status !== 'approved')) problems.push(`${DOC_LABEL[d.doc_type]} is ${d.status}. Approve it first`);
      if (b.section === 'identity' && !o.identity_consent_at) problems.push('The owner has not given identity verification consent');
      if (b.section === 'business' && (!o.business_type || !o.business_name || !o.pan || !o.address)) problems.push('Business details are incomplete');
      if (problems.length) throw conflict(`Can't verify ${b.section} yet: ${problems.join('; ')}`, 'section_not_ready');
    }
    await ctx.db.tx(async (q) => {
      await q.query(`UPDATE owner_profiles SET ${b.section}_verified_at = ${b.verified ? 'now()' : 'NULL'}, application_status = CASE WHEN application_status='submitted' THEN 'under_review' ELSE application_status END WHERE user_id=$1`, [id]);
      await q.query(`INSERT INTO application_events (owner_id, kind, note, actor_id) VALUES ($1,$2,$3,$4)`, [id, b.verified ? 'section_verified' : 'section_unverified', `${b.section === 'identity' ? 'Identity' : 'Business'} ${b.verified ? 'verified' : 'verification withdrawn'}${b.note ? `: ${b.note}` : ''}`, req.user!.id]);
      await audit(q, req, `application.${b.section}_${b.verified ? 'verified' : 'unverified'}`, 'user', id, { note: b.note });
    });
    await ctx.notifier.notify(id, { title: `${b.section === 'identity' ? 'Identity' : 'Business'} ${b.verified ? 'verified' : 'verification withdrawn'}`, type: 'application', data: { link: '/owner/application' },
      body: b.verified ? `Our team has verified your ${b.section} details. ${b.section === 'identity' ? 'Business' : 'Identity'} verification is shown on your application page.` : `Your ${b.section} verification was withdrawn.${b.note ? ' ' + b.note : ''}` });
    const now = (await ctx.db.query('SELECT business_verified_at, identity_verified_at, application_status FROM owner_profiles WHERE user_id=$1', [id])).rows[0];
    res.json({ businessVerified: !!now.business_verified_at, identityVerified: !!now.identity_verified_at, status: now.application_status });
  });

  r.post('/applications/:ownerId/decision', async (req, res) => {
    const id = parse(z.uuid(), req.params.ownerId);
    const b = parse(z.object({
      action: z.enum(['start_review', 'request_info', 'request_resubmission', 'approve', 'reject']), note: z.string().trim().max(800).optional(),
      items: z.array(z.object({ type: z.enum(['document', 'field']), key: z.string().max(60), reason: z.string().trim().max(300).optional() })).max(20).default([]),
    }), req.body);
    const o = (await ctx.db.query(`SELECT p.application_status, p.application_ref, p.business_name, u.full_name FROM owner_profiles p JOIN users u ON u.id=p.user_id WHERE p.user_id=$1`, [id])).rows[0];
    if (!o) throw notFound('Owner not found');
    const from = o.application_status as string;
    const next = { start_review: 'under_review', request_info: 'info_required', request_resubmission: 'resubmission_required', approve: 'approved', reject: 'rejected' }[b.action];
    if (b.action === 'start_review' && from !== 'submitted') throw conflict('Only newly submitted applications can be moved to review');
    if (['request_info', 'request_resubmission'].includes(b.action) && !REVIEW.includes(from) && from !== 'rejected') throw conflict(`An application that is ${from.replace(/_/g, ' ')} can't be sent back for changes`);
    if (['request_info', 'request_resubmission'].includes(b.action) && !b.note && b.items.length === 0) throw badRequest('Say what needs to change (a note or at least one item)', 'reason_required');
    if (b.action === 'approve' && !['submitted', 'under_review'].includes(from)) throw conflict('Only submitted applications can be approved');
    if (b.action === 'reject' && (!b.note || !REVIEW.concat('approved').includes(from))) throw badRequest('A reason is required to reject a submitted application', 'reason_required');

    await ctx.db.tx(async (q) => {
      if (b.action === 'approve') {
        const bad = await q.query(`SELECT doc_type FROM owner_documents WHERE owner_id=$1 AND status='rejected'`, [id]);
        if (bad.rows.length) throw conflict(`Resolve rejected documents first: ${bad.rows.map((x: any) => DOC_LABEL[x.doc_type]).join(', ')}`, 'documents_rejected');
        await q.query(`UPDATE owner_documents SET status='approved', reviewed_by=$2, reviewed_at=now() WHERE owner_id=$1 AND status='pending'`, [id, req.user!.id]);
      }
      if (b.action === 'approve') await q.query(`UPDATE owner_profiles SET business_verified_at=COALESCE(business_verified_at, now()), identity_verified_at=COALESCE(identity_verified_at, now()) WHERE user_id=$1`, [id]);
      for (const i of b.items) {
        const sec = i.type === 'document' ? sectionOfDoc(i.key) : i.key === 'identity' ? 'identity' : 'business';
        if (sec && ['request_info', 'request_resubmission'].includes(b.action)) await q.query(`UPDATE owner_profiles SET ${sec}_verified_at=NULL WHERE user_id=$1`, [id]);
      }
      await q.query(
        `UPDATE owner_profiles SET application_status=$2, verification_note=$3,
           verification_status = CASE $2 WHEN 'approved' THEN 'verified' WHEN 'rejected' THEN 'rejected' ELSE verification_status END WHERE user_id=$1`,
        [id, next, b.action === 'approve' ? null : b.note ?? null]);
      await q.query(`INSERT INTO application_events (owner_id, kind, from_status, to_status, note, items, actor_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id, { start_review: 'review_started', request_info: 'info_requested', request_resubmission: 'resubmission_requested', approve: 'approved', reject: 'rejected' }[b.action], from, next, b.note ?? null, JSON.stringify(b.items), req.user!.id]);
      await audit(q, req, `application.${b.action}`, 'user', id, { from, to: next, reference: o.application_ref, note: b.note });
    });

    const title = { start_review: 'Application under review', request_info: 'Additional information required', request_resubmission: 'Resubmission required', approve: 'Application approved', reject: 'Application rejected' }[b.action];
    const itemText = b.items.length ? ` Needs attention: ${b.items.map((i) => `${i.type === 'document' ? DOC_LABEL[i.key] ?? i.key : i.key}${i.reason ? ` (${i.reason})` : ''}`).join('; ')}.` : '';
    await ctx.notifier.notify(id, { title, type: 'application', email: true, data: { link: '/owner/application' },
      body: `Application ${o.application_ref ?? ''}: ${{ start_review: 'our team has started reviewing it.', request_info: 'we need more information.', request_resubmission: 'please correct the flagged items and resubmit.', approve: 'you can now publish venues and take bookings.', reject: 'it was not approved.' }[b.action]}${b.note ? ` ${b.note}` : ''}${itemText}` });
    res.json({ status: next });
  });

  return r;
}
