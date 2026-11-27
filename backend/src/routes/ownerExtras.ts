import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { Ctx } from '../types.js';
import { authenticate, requirePermission, requireRole } from '../middleware/auth.js';
import { HttpError, badRequest, notFound } from '../errors.js';
import { parse } from '../lib/http.js';
import { audit } from '../lib/audit.js';

export const DELETE_REASONS = ['No longer own a venue', 'Moving to another platform', 'Too expensive', 'Not enough bookings', 'Privacy concerns', 'Other'] as const;

/** Owner-portal pages beyond the core ones: activity log, close account. */
export function ownerExtraRoutes(ctx: Ctx) {
  const r = Router();
  r.use(authenticate(ctx), requireRole('owner'));
  const uid = (req: any) => req.user!.id as string;

  // ---------------- how bookings are paid: the full amount when booking, or an advance (percentage) and the rest after the game
  r.get('/payment-collection', async (req, res) => {
    const row = (await ctx.db.query('SELECT payment_collection, advance_percent FROM owner_onboarding WHERE owner_id=$1', [uid(req)])).rows[0];
    res.json({ mode: row?.payment_collection ?? 'full', advancePercent: row?.advance_percent ?? null });
  });
  r.put('/payment-collection', async (req, res) => {
    const b = parse(z.object({ mode: z.enum(['full', 'advance']), advancePercent: z.number().int().min(1, 'Enter a percentage from 1 to 99').max(99, 'Enter a percentage from 1 to 99').optional() })
      .refine((x) => x.mode === 'full' || x.advancePercent !== undefined, { message: 'Enter the advance percentage', path: ['advancePercent'] }), req.body);
    const pct = b.mode === 'advance' ? b.advancePercent! : null;
    const { rowCount } = await ctx.db.query('UPDATE owner_onboarding SET payment_collection=$2, advance_percent=$3, payment_collection_updated_at=now() WHERE owner_id=$1', [uid(req), b.mode, pct]);
    if (!rowCount) throw notFound('Owner profile not found');
    await audit(ctx.db, req, 'owner.payment_collection_changed', 'user', uid(req), { mode: b.mode, advancePercent: pct });
    res.json({ mode: b.mode, advancePercent: pct });
  });

  // ---------------- activity log: what you and your staff did, and what happened on your account
  const CATEGORIES: Record<string, string> = { account: 'user.', application: 'application.', venue: 'venue.', booking: 'booking.', staff: 'staff.', payout: 'payout.' };
  r.get('/activity', async (req, res) => {
    const id = uid(req);
    const f = parse(z.object({ category: z.string().max(20).optional(), search: z.string().trim().max(80).optional(), limit: z.coerce.number().int().min(1).max(200).default(100), by: z.enum(['owner', 'staff']).optional(), resource: z.string().max(30).optional(), from: z.iso.date().optional(), to: z.iso.date().optional() }), req.query);
    const params: unknown[] = [id];
    let where = `(a.actor_id = $1 OR a.actor_id IN (SELECT staff_id FROM owner_staff WHERE owner_id = $1))`; // only what the owner and their staff did: an admin's own actions (approving the application, verifying the bank) are not the owner's activity
    if (f.category && CATEGORIES[f.category]) { params.push(`${CATEGORIES[f.category]}%`); where += ` AND a.action LIKE $${params.length}`; }
    if (f.search) { params.push(`%${f.search.toLowerCase()}%`); where += ` AND (lower(a.action) LIKE $${params.length} OR lower(COALESCE(u.full_name,'')) LIKE $${params.length})`; }
    if (f.by === 'owner') { params.push(id); where += ` AND a.actor_id = $${params.length}`; }
    if (f.by === 'staff') where += ` AND a.actor_id IN (SELECT staff_id FROM owner_staff WHERE owner_id = $1)`;
    if (f.resource) { params.push(f.resource); where += ` AND a.entity = $${params.length}`; }
    if (f.from) { params.push(f.from); where += ` AND a.created_at >= $${params.length}::date`; }
    if (f.to) { params.push(f.to); where += ` AND a.created_at < ($${params.length}::date + 1)`; }
    params.push(f.limit);
    const { rows } = await ctx.db.query(
      `SELECT a.id, a.action, a.entity, a.entity_id, a.metadata, a.ip, a.created_at, u.full_name AS actor_name, u.role AS actor_role
         FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id WHERE ${where} ORDER BY a.created_at DESC LIMIT $${params.length}`, params);
    const resources = (await ctx.db.query(`SELECT DISTINCT a.entity FROM audit_logs a WHERE (a.actor_id = $1 OR a.actor_id IN (SELECT staff_id FROM owner_staff WHERE owner_id = $1)) AND a.entity IS NOT NULL ORDER BY 1`, [id])).rows.map((x: any) => x.entity);
    res.json({ activity: rows, categories: Object.keys(CATEGORIES), resources });
  });

  // ---------------- close account
  r.get('/account/close-info', (_req, res) => res.json({ reasons: DELETE_REASONS }));
  r.post('/account/close', async (req, res) => {
    const id = uid(req);
    // JusGo asks the person to type DELETE and, optionally, why they are leaving. A password, when one is sent, must still be right.
    const b = parse(z.object({ confirm: z.literal('DELETE', { message: 'Type DELETE to confirm' }), reason: z.string().trim().max(500).optional(), note: z.string().trim().max(500).optional(), password: z.string().max(72).optional() }), req.body);
    const u = (await ctx.db.query('SELECT * FROM users WHERE id=$1', [id])).rows[0];
    if (b.password !== undefined && !(await bcrypt.compare(b.password, u.password_hash))) throw new HttpError(403, 'Incorrect password', 'wrong_password');
    const upcoming = (await ctx.db.query(
      `SELECT count(*)::int AS n FROM bookings b JOIN venues v ON v.id=b.venue_id WHERE v.owner_id=$1 AND b.status='confirmed' AND upper(b.during) > now()`, [id])).rows[0].n;
    if (upcoming > 0) throw badRequest(`You have ${upcoming} upcoming confirmed booking${upcoming === 1 ? '' : 's'}. Cancel or complete them before closing your account.`, 'upcoming_bookings');
    await ctx.db.tx(async (q) => {
      const gone = `deleted+${id}@deleted.invalid`;
      await q.query(`UPDATE venues SET status='suspended' WHERE owner_id=$1`, [id]);
      await q.query(`UPDATE users SET is_active=false WHERE id IN (SELECT staff_id FROM owner_staff WHERE owner_id=$1)`, [id]);
      await q.query(`UPDATE users SET is_active=false, email=$2, phone=NULL, full_name='Closed account', token_version=token_version+1, updated_at=now() WHERE id=$1`, [id, gone]);
      await q.query(`UPDATE owner_profiles SET upi_id=NULL, alternate_phone=NULL, business_phone=NULL, dob=NULL, partners='[]'::jsonb WHERE user_id=$1`, [id]);
      await audit(q, req, 'user.account_closed', 'user', id, { reason: b.reason ?? null, note: b.note ?? null }, id);
    });
    res.json({ closed: true });
  });
  return r;
}

/** Admin side of sports and listing changes. */
export function adminExtraRoutes(ctx: Ctx) {
  const r = Router();
  r.use(authenticate(ctx), requireRole('admin'));
  const P = requirePermission;
  // ---------------- sports catalogue
  r.get('/sports', P('venues'), async (_req, res) => {
    const { rows } = await ctx.db.query(
      `SELECT s.id, s.name, s.slug, s.is_active AS "isActive",
              (SELECT count(DISTINCT a.venue_id)::int FROM playing_area_sports x JOIN playing_areas a ON a.id=x.playing_area_id WHERE x.sport_id=s.id) AS venues,
              (SELECT count(*)::int FROM playing_area_sports x WHERE x.sport_id=s.id) AS areas
         FROM sports s ORDER BY s.sort_order, s.name`);
    res.json({ sports: rows });
  });
  const slugOf = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  r.post('/sports', P('venues'), async (req, res) => {
    const b = parse(z.object({ name: z.string().trim().min(2).max(40) }), req.body);
    try {
      const sp = (await ctx.db.query('INSERT INTO sports (name, slug) VALUES ($1,$2) RETURNING id, name, slug', [b.name, slugOf(b.name)])).rows[0];
      await audit(ctx.db, req, 'admin.sport_added', 'sport', String(sp.id), { name: b.name });
      res.status(201).json({ sport: sp });
    } catch (e: any) { if (e?.code === '23505') throw new HttpError(409, 'A sport with this name already exists', 'sport_exists'); throw e; }
  });
  r.patch('/sports/:id', P('venues'), async (req, res) => {
    const id = parse(z.coerce.number().int().positive(), req.params.id);
    const b = parse(z.object({ name: z.string().trim().min(2).max(40).optional(), isActive: z.boolean().optional() }).refine((x) => x.name !== undefined || x.isActive !== undefined, 'Nothing to change'), req.body);
    try {
      const sp = (await ctx.db.query('UPDATE sports SET name=COALESCE($2,name), slug=COALESCE($3,slug), is_active=COALESCE($4,is_active) WHERE id=$1 RETURNING id, name, slug, is_active AS "isActive"', [id, b.name ?? null, b.name ? slugOf(b.name) : null, b.isActive ?? null])).rows[0];
      if (!sp) throw notFound('Sport not found');
      await audit(ctx.db, req, 'admin.sport_updated', 'sport', String(id), b);
      res.json({ sport: sp });
    } catch (e: any) { if (e?.code === '23505') throw new HttpError(409, 'A sport with this name already exists', 'sport_exists'); throw e; }
  });

  // ---------------- playing areas waiting for approval
  r.get('/areas', P('venues'), async (req, res) => {
    const status = parse(z.enum(['pending', 'approved', 'rejected']).optional(), req.query.status);
    const deletion = parse(z.enum(['pending', 'deleted']).optional(), req.query.deletion);
    const { rows } = await ctx.db.query(
      `SELECT a.id, a.name, a.approval_status AS "approvalStatus", a.approval_note AS "approvalNote", a.surface, a.capacity,
              a.deletion_status AS "deletionStatus", a.deletion_requested_at AS "deletionRequestedAt", a.deletion_reason AS "deletionReason", a.deleted_at AS "deletedAt",
              (SELECT count(*)::int FROM bookings b WHERE b.area_id=a.id AND b.status IN ('pending','confirmed') AND lower(b.during) > now()) AS "upcomingBookings",
              (SELECT count(*)::int FROM bookings b WHERE b.area_id=a.id AND b.status <> 'blocked') AS "totalBookings",
              v.id AS "venueId", v.name AS "venueName", v.city, u.full_name AS "ownerName",
              (SELECT COALESCE(json_agg(sp.name ORDER BY sp.sort_order, sp.name), '[]') FROM playing_area_sports x JOIN sports sp ON sp.id=x.sport_id WHERE x.playing_area_id=a.id) AS sports,
              (SELECT count(*)::int FROM pricing_rules p WHERE p.area_id=a.id) AS "priceRules"
         FROM playing_areas a JOIN venues v ON v.id=a.venue_id JOIN users u ON u.id=v.owner_id
        WHERE ($1::text IS NULL OR a.approval_status=$1) AND ($2::text IS NULL OR a.deletion_status=$2)
        ORDER BY (a.deletion_status='pending') DESC, (a.approval_status='pending') DESC, v.name, a.name LIMIT 300`, [status ?? null, deletion ?? null]);
    res.json({ areas: rows });
  });
  r.post('/areas/:id/decision', P('venues'), async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    const b = parse(z.object({ decision: z.enum(['approve', 'reject']), note: z.string().trim().max(300).optional() })
      .refine((x) => x.decision === 'approve' || (x.note && x.note.length >= 3), { message: 'Tell the owner why it was rejected', path: ['note'] }), req.body);
    const a = (await ctx.db.query(`UPDATE playing_areas SET approval_status=$2, approval_note=$3 WHERE id=$1 RETURNING id, name, venue_id`, [id, b.decision === 'approve' ? 'approved' : 'rejected', b.decision === 'approve' ? null : b.note ?? null])).rows[0];
    if (!a) throw notFound('Playing area not found');
    const v = (await ctx.db.query('SELECT owner_id, name FROM venues WHERE id=$1', [a.venue_id])).rows[0];
    await audit(ctx.db, req, `admin.area_${b.decision}d`, 'area', id, { note: b.note ?? null });
    await ctx.notifier.notify(v.owner_id, { title: `Playing area ${b.decision === 'approve' ? 'approved' : 'rejected'}`, type: 'area_status', data: { link: '/owner/areas' },
      body: b.decision === 'approve' ? `"${a.name}" at "${v.name}" is approved. Customers can now book it.` : `"${a.name}" at "${v.name}" was rejected: ${b.note}. Edit it and it goes back for review.` });
    res.json({ id, approvalStatus: b.decision === 'approve' ? 'approved' : 'rejected' });
  });

  /** an owner asked to delete a playing area: approve (it stays in the database with its bookings, closed for good) or reject the request */
  r.post('/areas/:id/deletion', P('venues'), async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    const b = parse(z.object({ decision: z.enum(['approve', 'reject']), note: z.string().trim().max(300).optional() })
      .refine((x) => x.decision === 'approve' || (x.note && x.note.length >= 3), { message: 'Tell the owner why the delete request was rejected', path: ['note'] }), req.body);
    const a = (await ctx.db.query(b.decision === 'approve'
      ? `UPDATE playing_areas SET deletion_status='deleted', deleted_at=now(), is_active=false WHERE id=$1 AND deletion_status='pending' RETURNING id, name, venue_id`
      : `UPDATE playing_areas SET deletion_status=NULL, deletion_requested_at=NULL, deletion_reason=NULL, deletion_note=$2, is_active=COALESCE(active_before_delete, is_active), active_before_delete=NULL
          WHERE id=$1 AND deletion_status='pending' RETURNING id, name, venue_id`, b.decision === 'approve' ? [id] : [id, b.note])).rows[0];
    if (!a) throw notFound('No deletion request for this playing area');
    const v = (await ctx.db.query('SELECT owner_id, name FROM venues WHERE id=$1', [a.venue_id])).rows[0];
    await audit(ctx.db, req, b.decision === 'approve' ? 'admin.area_deleted' : 'admin.area_deletion_rejected', 'area', id, { note: b.note ?? null });
    await ctx.notifier.notify(v.owner_id, { title: b.decision === 'approve' ? 'Playing area deleted' : 'Playing area not deleted', type: 'area_status', data: { link: '/owner/areas' },
      body: b.decision === 'approve' ? `"${a.name}" at "${v.name}" is deleted. Its booking history is kept.` : `Your request to delete "${a.name}" at "${v.name}" was rejected: ${b.note}. It is not deleted and is open for booking again.` });
    res.json({ id, deletionStatus: b.decision === 'approve' ? 'deleted' : null });
  });

  // ---------------- listing changes: edits to live venues waiting for review
  r.get('/listing-changes', P('venues'), async (_req, res) => {
    const { rows } = await ctx.db.query(
      `SELECT v.id AS "venueId", v.name AS "venueName", u.full_name AS "ownerName", vc.fields, (vc.facility_ids IS NOT NULL) AS "facilitiesChanged", vc.updated_at AS "updatedAt",
              (SELECT count(*)::int FROM venue_images i WHERE i.venue_id=v.id AND i.is_pending) AS "newMedia", (SELECT count(*)::int FROM venue_images i WHERE i.venue_id=v.id AND i.delete_requested) AS "removedMedia"
         FROM venues v JOIN users u ON u.id=v.owner_id LEFT JOIN listing_change_requests vc ON vc.venue_id=v.id
        WHERE vc.venue_id IS NOT NULL OR EXISTS (SELECT 1 FROM venue_images i WHERE i.venue_id=v.id AND (i.is_pending OR i.delete_requested))
        ORDER BY COALESCE(vc.updated_at, v.updated_at) DESC`);
    res.json({ changes: rows });
  });

  return r;
}
