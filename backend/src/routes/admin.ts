import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { Ctx } from '../types.js';
import { ADMIN_PERMISSION_CATALOGUE, authenticate, requirePermission, requireRole } from '../middleware/auth.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { csv, page, parse } from '../lib/http.js';
import { syncAccount } from '../lib/accounts.js';
import { audit } from '../lib/audit.js';
import { cancelBooking, issueRefund, retryRefund } from '../lib/bookings.js';
import { checkedFile, upload } from '../lib/upload.js';
import { escrowByOwner, emptyEscrow, holdHours } from '../lib/escrow.js';
import { MANUAL_CHECKS, reviewChecklist, venueScore } from '../lib/venueQuality.js';
import { walletBalance, walletCredit, walletDebit } from '../lib/wallet.js';
import { round2 } from '../lib/pricing.js';
import { getSetting } from '../lib/settings.js';
import { sendPayout, payableNow } from '../lib/payouts.js';
import { sendStoredFile } from '../lib/private-file.js';

const iso = z.iso.datetime({ offset: true });

export function adminRoutes(ctx: Ctx) {
  const r = Router();
  r.use(authenticate(ctx), requireRole('admin'));
  const P = requirePermission;
  const permList = z.array(z.enum(ADMIN_PERMISSION_CATALOGUE.map((p) => p.id) as [string, ...string[]])).max(ADMIN_PERMISSION_CATALOGUE.length);
  const like = (s?: string) => (s ? `%${s.replace(/[%_\\]/g, '\\$&')}%` : null);

  // ---------------- dashboard + analytics
  r.get('/dashboard', P('reports'), async (_req, res) => {
    const [totals, revenue, trend, pendingVenues, pendingOwners, tickets, topVenues, sports] = await Promise.all([
      ctx.db.query(`SELECT (SELECT count(*)::int FROM users WHERE role='customer') AS customers, (SELECT count(*)::int FROM users WHERE role='owner') AS owners,
        (SELECT count(*)::int FROM venues WHERE status='approved') AS venues, (SELECT count(*)::int FROM bookings WHERE status IN ('confirmed','completed')) AS bookings`),
      ctx.db.query(`SELECT COALESCE(sum(total),0)::float8 AS gmv, COALESCE(sum(commission_amount),0)::float8 AS commission,
        COALESCE(sum(total) FILTER (WHERE lower(during) >= date_trunc('month', now())),0)::float8 AS gmv_month,
        COALESCE(sum(commission_amount) FILTER (WHERE lower(during) >= date_trunc('month', now())),0)::float8 AS commission_month
        FROM bookings WHERE status IN ('confirmed','completed')`),
      ctx.db.query(`SELECT to_char(d,'YYYY-MM-DD') AS day, COALESCE(sum(b.total),0)::float8 AS gmv, count(b.id)::int AS bookings
        FROM generate_series(date_trunc('day', now()) - interval '29 days', date_trunc('day', now()), interval '1 day') d
        LEFT JOIN bookings b ON date_trunc('day', b.created_at)=d AND b.status IN ('confirmed','completed') GROUP BY d ORDER BY d`),
      ctx.db.query(`SELECT count(*)::int AS n FROM venues v WHERE v.status='pending' OR (EXISTS (SELECT 1 FROM listing_change_requests c WHERE c.venue_id=v.id) OR EXISTS (SELECT 1 FROM venue_images i WHERE i.venue_id=v.id AND (i.is_pending OR i.delete_requested)) OR (v.status IN ('approved','ready') AND EXISTS (SELECT 1 FROM venue_documents d WHERE d.venue_id=v.id AND d.status='pending')))`),
      ctx.db.query(`SELECT count(*)::int AS n FROM owner_profiles WHERE application_status IN ('submitted','under_review')`),
      ctx.db.query(`SELECT count(*)::int AS n FROM support_tickets WHERE status IN ('open','in_progress')`),
      ctx.db.query(`SELECT v.id, v.name, count(*)::int AS bookings, sum(b.total)::float8 AS gmv FROM bookings b JOIN venues v ON v.id=b.venue_id WHERE b.status IN ('confirmed','completed') GROUP BY v.id, v.name ORDER BY gmv DESC LIMIT 5`),
      ctx.db.query(`SELECT sp.name, count(*)::int AS bookings FROM bookings b JOIN sports sp ON sp.id=b.sport_id WHERE b.status IN ('confirmed','completed') GROUP BY sp.name ORDER BY bookings DESC`),
    ]);
    res.json({ totals: totals.rows[0], revenue: revenue.rows[0], trend: trend.rows, pendingVenues: pendingVenues.rows[0].n, pendingOwners: pendingOwners.rows[0].n, openTickets: tickets.rows[0].n, topVenues: topVenues.rows, bookingsBySport: sports.rows });
  });

  /** What each venue brought in and what PlaynX kept from it, for any period. */
  r.get('/reports/commission-by-venue', P('reports'), async (req, res) => {
    const f = parse(z.object({ from: z.iso.date(), to: z.iso.date(), format: z.enum(['json', 'csv']).default('json') }), req.query);
    const { rows } = await ctx.db.query(
      `SELECT v.id, v.name AS venue, op.business_name AS owner, count(b.id)::int AS bookings, COALESCE(sum(b.total),0)::float8 AS gross,
              COALESCE(sum(b.commission_amount),0)::float8 AS commission, COALESCE(sum(b.owner_amount),0)::float8 AS owner_earnings,
              CASE WHEN sum(b.total) > 0 THEN round((sum(b.commission_amount) / sum(b.total) * 100)::numeric, 1)::float8 ELSE 0 END AS effective_rate
         FROM bookings b JOIN venues v ON v.id=b.venue_id JOIN owner_profiles op ON op.user_id=v.owner_id
        WHERE b.source='online' AND b.status IN ('confirmed','completed') AND lower(b.during)::date >= $1::date AND lower(b.during)::date <= $2::date
        GROUP BY v.id, v.name, op.business_name ORDER BY sum(b.commission_amount) DESC, v.name`, [f.from, f.to]);
    if (f.format === 'csv') { res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="commission-by-venue-${f.from}-${f.to}.csv"`); return void res.send(rows.length ? csv(rows.map(({ id, ...r }: any) => r)) : 'No bookings in this period'); }
    res.json({ rows });
  });

  /** Things worth a human look: customers who cancel a lot or abandon payments, and venue photos taken far from the venue. */
  r.get('/reports/revenue', P('reports'), async (req, res) => {
    const f = parse(z.object({ from: z.iso.date(), to: z.iso.date(), groupBy: z.enum(['day', 'month']).default('day') }), req.query);
    const { rows } = await ctx.db.query(
      `SELECT to_char(date_trunc($3, lower(during)), CASE WHEN $3='month' THEN 'YYYY-MM' ELSE 'YYYY-MM-DD' END) AS period, count(*)::int AS bookings,
         sum(total)::float8 AS gmv, sum(commission_amount)::float8 AS commission, sum(owner_amount)::float8 AS owner_earnings
       FROM bookings WHERE status IN ('confirmed','completed') AND lower(during) >= $1::date AND lower(during) < $2::date + 1 GROUP BY 1 ORDER BY 1`, [f.from, f.to, f.groupBy]);
    if (req.query.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="revenue-${f.from}-${f.to}.csv"`);
      return res.send(rows.length ? csv(rows) : 'No data');
    }
    res.json({ rows });
  });

  // ---------------- users, owners
  r.get('/users', P('users:read'), async (req, res) => {
    const blankToUndef = Object.fromEntries(Object.entries(req.query).filter(([, v]) => v !== '')); // "All" in a filter is sent as an empty value
    const f = parse(z.object({ role: z.enum(['customer', 'owner', 'admin']).optional(), q: z.string().max(100).optional(), active: z.enum(['true', 'false']).optional() }), blankToUndef);
    const { limit, offset } = page(req.query, 100);
    const { rows } = await ctx.db.query(
      `SELECT u.id, u.email, u.phone, u.full_name, u.role, u.admin_role, u.email_verified, u.phone_verified, u.is_active, u.created_at,
         (SELECT count(*)::int FROM bookings b WHERE b.customer_id=u.id AND b.status IN ('confirmed','completed')) AS bookings, count(*) OVER()::int AS total
       FROM users u WHERE ($1::text IS NULL OR u.role=$1) AND ($2::text IS NULL OR u.full_name ILIKE $2 OR u.email ILIKE $2 OR u.phone ILIKE $2)
         AND ($3::bool IS NULL OR u.is_active=$3) ORDER BY u.created_at DESC LIMIT $4 OFFSET $5`,
      [f.role ?? null, like(f.q), f.active ? f.active === 'true' : null, limit, offset]);
    res.json({ users: rows.map(({ total, ...u }) => u), total: rows[0]?.total ?? 0 });
  });
  r.patch('/users/:id', P('users'), async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    const { isActive } = parse(z.object({ isActive: z.boolean() }), req.body);
    if (id === req.user!.id) throw badRequest('You cannot disable your own account');
    const { rows } = await ctx.db.query('UPDATE users SET is_active=$2, updated_at=now() WHERE id=$1 RETURNING id, is_active, role', [id, isActive]);
    if (!rows[0]) throw notFound('User not found');
    await audit(ctx.db, req, isActive ? 'user.enable' : 'user.disable', 'user', id);
    res.json({ user: rows[0] });
  });

  r.get('/owners', P('users:read'), async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : null;
    const { rows } = await ctx.db.query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.is_active, u.created_at, o.business_name, o.gstin, o.pan, o.address, o.verification_status, o.verification_note, o.commission_override, o.application_status, o.application_ref,
         (SELECT count(*)::int FROM owner_documents d WHERE d.owner_id=u.id AND d.status='pending') AS pending_documents,
         o.bank_account_name, o.bank_ifsc, o.upi_id, o.bank_verified, CASE WHEN o.bank_account_number IS NULL THEN NULL ELSE repeat('•', greatest(length(o.bank_account_number) - 4, 0)) || right(o.bank_account_number, 4) END AS bank_account_masked, (SELECT count(*)::int FROM venues v WHERE v.owner_id=u.id) AS venues
       FROM users u JOIN owner_profiles o ON o.user_id=u.id WHERE ($1::text IS NULL OR o.verification_status=$1) ORDER BY u.created_at DESC LIMIT 200`, [status]);
    res.json({ owners: rows });
  });
  r.post('/owners/:id/verification', P('users'), async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    const b = parse(z.object({ status: z.enum(['verified', 'rejected', 'pending']), note: z.string().trim().max(500).optional(), commissionOverride: z.number().min(0).max(100).nullable().optional() })
      .refine((x) => x.status !== 'rejected' || !!x.note, { message: 'A note is required when rejecting', path: ['note'] }), req.body);
    const { rows } = await ctx.db.query(
      `UPDATE owner_profiles SET verification_status=$2, application_status = CASE $2::text WHEN 'verified' THEN 'approved' WHEN 'rejected' THEN 'rejected' ELSE application_status END, verification_note=$3, commission_override=CASE WHEN $5 THEN $4 ELSE commission_override END WHERE user_id=$1 RETURNING *`,
      [id, b.status, b.note ?? null, b.commissionOverride ?? null, b.commissionOverride !== undefined]);
    if (!rows[0]) throw notFound('Owner not found');
    await audit(ctx.db, req, `owner.${b.status}`, 'user', id, { note: b.note });
    await ctx.notifier.notify(id, { title: `Account ${b.status}`, type: 'owner_verification', email: true,
      body: b.status === 'verified' ? 'Your owner account is verified. You can now publish venues.' : b.status === 'rejected' ? `Your verification was rejected: ${b.note}` : 'Your verification is under review.' });
    res.json({ profile: rows[0] });
  });

  /** The full bank details, so the admin can check them before verifying. Every look is written to the audit log. */
  r.get('/owners/:id/bank', P('payouts'), async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    const o = (await ctx.db.query('SELECT bank_account_name, bank_account_number, bank_ifsc, upi_id, bank_verified FROM owner_profiles WHERE user_id=$1', [id])).rows[0];
    if (!o || (!o.bank_account_number && !o.upi_id)) throw badRequest('This owner has not added bank details', 'no_bank');
    await audit(ctx.db, req, 'bank.viewed', 'user', id);
    res.json({ bank: { accountName: o.bank_account_name, accountNumber: o.bank_account_number, ifsc: o.bank_ifsc, upiId: o.upi_id, verified: o.bank_verified } });
  });
  r.post('/owners/:id/bank-verification', P('payouts'), async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    const { verified } = parse(z.object({ verified: z.boolean() }), req.body);
    const { rows } = await ctx.db.query('UPDATE owner_profiles SET bank_verified=$2 WHERE user_id=$1 AND (bank_account_number IS NOT NULL OR upi_id IS NOT NULL) RETURNING bank_verified', [id, verified]);
    if (!rows[0]) throw badRequest('This owner has not added bank details', 'no_bank');
    await audit(ctx.db, req, verified ? 'bank.verify' : 'bank.unverify', 'user', id);
    await ctx.notifier.notify(id, { title: verified ? 'Bank account verified' : 'Bank account needs attention', type: 'bank', body: verified ? 'Your payout account is verified. Settlements can now be paid to it.' : 'Please review your bank details.', email: true });
    res.json({ verified });
  });

  // ---------------- venues + documents
  r.get('/venues', P('venues'), async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : null;
    const { rows } = await ctx.db.query(
      `SELECT v.id, v.name, v.city, v.address, v.status, v.rejection_reason, v.created_at, u.full_name AS owner_name, o.business_name, o.verification_status,
         (EXISTS (SELECT 1 FROM listing_change_requests c WHERE c.venue_id=v.id) OR EXISTS (SELECT 1 FROM venue_images i WHERE i.venue_id=v.id AND (i.is_pending OR i.delete_requested)) OR (v.status IN ('approved','ready') AND EXISTS (SELECT 1 FROM venue_documents d WHERE d.venue_id=v.id AND d.status='pending'))) AS change_pending, (SELECT count(*)::int FROM venue_documents d WHERE d.venue_id=v.id) AS documents, (SELECT count(*)::int FROM venue_documents d WHERE d.venue_id=v.id AND d.status='pending') AS pending_documents
       FROM venues v JOIN users u ON u.id=v.owner_id JOIN owner_profiles o ON o.user_id=u.id WHERE ($1::text IS NULL OR v.status=$1 OR ($1 IN ('changes','pending') AND (EXISTS (SELECT 1 FROM listing_change_requests c WHERE c.venue_id=v.id) OR EXISTS (SELECT 1 FROM venue_images i WHERE i.venue_id=v.id AND (i.is_pending OR i.delete_requested)) OR (v.status IN ('approved','ready') AND EXISTS (SELECT 1 FROM venue_documents d WHERE d.venue_id=v.id AND d.status='pending'))))) ORDER BY (v.status='pending') DESC, v.created_at DESC LIMIT 200`, [status]);
    res.json({ venues: rows });
  });
  r.get('/venues/:id', P('venues'), async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    const v = (await ctx.db.query(`SELECT v.*, u.full_name AS owner_name, u.email AS owner_email, o.business_name, o.verification_status FROM venues v JOIN users u ON u.id=v.owner_id JOIN owner_profiles o ON o.user_id=u.id WHERE v.id=$1`, [id])).rows[0];
    if (!v) throw notFound('Venue not found');
    const [docs, images, areas] = await Promise.all([
      ctx.db.query("SELECT id, venue_id, doc_type, CASE WHEN url LIKE 'private:%' THEN NULL ELSE url END AS url, status, note, created_at FROM venue_documents WHERE venue_id=$1 ORDER BY created_at", [id]),
      ctx.db.query('SELECT id, url, kind, is_cover, is_pending, delete_requested, area_id, geo_lat, geo_lng, geo_distance_m, geo_address FROM venue_images WHERE venue_id=$1 ORDER BY sort_order', [id]),
      ctx.db.query('SELECT id, name, is_active FROM playing_areas WHERE venue_id=$1', [id]),
    ]);
    const ch = (await ctx.db.query('SELECT fields, facility_ids, updated_at FROM listing_change_requests WHERE venue_id=$1', [id])).rows[0];
    const facs = ch?.facility_ids ? (await ctx.db.query('SELECT id, name FROM facilities WHERE id = ANY($1) ORDER BY name', [ch.facility_ids])).rows : null;
    const cur = (await ctx.db.query('SELECT f.name FROM venue_facilities vf JOIN facilities f ON f.id=vf.facility_id WHERE vf.venue_id=$1 ORDER BY f.name', [id])).rows.map((r: any) => r.name);
    const newDocs = ['approved', 'ready'].includes(v.status) ? docs.rows.filter((d: any) => d.status === 'pending') : [];
    const coverId = (ch?.fields as any)?.cover_image_id as string | undefined;
    const { cover_image_id: _cv, ...shownFields } = (ch?.fields ?? {}) as Record<string, unknown>;
    const newImages = images.rows.filter((x: any) => x.is_pending), removedImages = images.rows.filter((x: any) => x.delete_requested);
    const change = ch || newImages.length || removedImages.length || newDocs.length ? {
      fields: shownFields, facilities: facs ? { from: cur, to: facs.map((f: any) => f.name) } : null, updatedAt: ch?.updated_at ?? null,
      newImages, removedImages, newCover: coverId ? images.rows.find((x: any) => x.id === coverId) ?? null : null, newDocuments: newDocs } : null;
    res.json({ venue: v, documents: docs.rows, images: images.rows, areas: areas.rows, change });
  });
  // Approve or reject edits an owner made to an already-approved venue. Until approved, customers keep seeing the approved version.
  r.post('/venues/:id/changes', P('venues'), async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    const b = parse(z.object({ decision: z.enum(['approve', 'reject']), reason: z.string().trim().max(500).optional() })
      .refine((x) => x.decision !== 'reject' || !!x.reason, { message: 'A reason is required', path: ['reason'] }), req.body);
    const v = (await ctx.db.query('SELECT id, name, owner_id FROM venues WHERE id=$1', [id])).rows[0];
    if (!v) throw notFound('Venue not found');
    const ch = (await ctx.db.query('SELECT fields, facility_ids FROM listing_change_requests WHERE venue_id=$1', [id])).rows[0];
    const media = (await ctx.db.query('SELECT count(*)::int AS n FROM venue_images WHERE venue_id=$1 AND (is_pending OR delete_requested)', [id])).rows[0].n;
    if (!ch && !media) throw conflict('This venue has no changes waiting for review');
    const fields = (ch?.fields ?? {}) as Record<string, unknown>;
    if (b.decision === 'approve') {
      await ctx.db.tx(async (q) => {
        const allowed = ['name', 'description', 'address', 'city', 'state', 'pincode', 'lat', 'lng', 'contact_phone', 'cancellation_hours', 'category', 'locality', 'contact_email', 'country'];
        const use = Object.keys(fields).filter((c) => allowed.includes(c));
        if (use.length) await q.query(`UPDATE venues SET ${use.map((c, i) => `${c}=$${i + 2}`).join(', ')}, updated_at=now() WHERE id=$1`, [id, ...use.map((c) => fields[c])]);
        if (ch?.facility_ids) {
          await q.query('DELETE FROM venue_facilities WHERE venue_id=$1', [id]);
          if (ch.facility_ids.length) await q.query('INSERT INTO venue_facilities (venue_id, facility_id) SELECT $1, f.id FROM facilities f WHERE f.id = ANY($2)', [id, ch.facility_ids]);
        }
        await q.query('UPDATE venue_images SET is_pending=false WHERE venue_id=$1', [id]); // new photos go live
        await q.query('DELETE FROM venue_images WHERE venue_id=$1 AND delete_requested', [id]); // approved removals
        const cover = fields.cover_image_id as string | undefined;
        if (cover) { await q.query('UPDATE venue_images SET is_cover=false WHERE venue_id=$1', [id]); await q.query(`UPDATE venue_images SET is_cover=true WHERE id=$1 AND venue_id=$2 AND kind='image'`, [cover, id]); }
        const hasCover = (await q.query('SELECT 1 FROM venue_images WHERE venue_id=$1 AND is_cover', [id])).rows[0]; // the cover may have been removed
        if (!hasCover) await q.query(`UPDATE venue_images SET is_cover=true WHERE id=(SELECT id FROM venue_images WHERE venue_id=$1 AND kind='image' ORDER BY sort_order LIMIT 1)`, [id]);
        await q.query('DELETE FROM listing_change_requests WHERE venue_id=$1', [id]);
      });
    } else {
      await ctx.db.tx(async (q) => {
        await q.query('DELETE FROM venue_images WHERE venue_id=$1 AND is_pending', [id]);
        await q.query('UPDATE venue_images SET delete_requested=false WHERE venue_id=$1', [id]);
        await q.query('DELETE FROM listing_change_requests WHERE venue_id=$1', [id]);
      });
    }
    await audit(ctx.db, req, `venue.changes_${b.decision}`, 'venue', id, { reason: b.reason });
    await ctx.notifier.notify(v.owner_id, { title: `Venue changes ${b.decision === 'approve' ? 'approved' : 'rejected'}`, type: 'venue_status', email: true, data: { venueId: id },
      body: b.decision === 'approve' ? `Your changes to ${v.name} were approved and are now shown to customers.` : `Your changes to ${v.name} were not approved and have been discarded. Reason: ${b.reason}` });
    res.json({ ok: true });
  });
  // ---- customer wallet: goodwill credits and corrections (finance only). Wallet money is never paid out as cash.
  // ---------------- customers: one row each with their activity, and a full profile
  r.get('/customers', P('users:read'), async (req, res) => {
    const f = parse(z.object({ q: z.string().max(100).optional(), status: z.enum(['active', 'suspended']).optional(), limit: z.coerce.number().int().min(1).max(500).default(200) }), req.query);
    const { rows } = await ctx.db.query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.email_verified, u.phone_verified, u.is_active, u.created_at, cp.city,
              count(b.id) FILTER (WHERE b.status IN ('confirmed','completed'))::int AS bookings,
              count(b.id) FILTER (WHERE b.status = 'cancelled')::int AS cancelled,
              COALESCE(sum(b.total) FILTER (WHERE b.status IN ('confirmed','completed')), 0)::float8 AS spent,
              max(lower(b.during)) FILTER (WHERE b.status IN ('confirmed','completed','cancelled')) AS last_booking
         FROM users u LEFT JOIN customer_profiles cp ON cp.user_id=u.id LEFT JOIN bookings b ON b.customer_id=u.id AND b.block_kind IS NULL
        WHERE u.role='customer' AND ($1::text IS NULL OR u.full_name ILIKE $1 OR u.email ILIKE $1 OR u.phone ILIKE $1 OR cp.city ILIKE $1)
          AND ($2::bool IS NULL OR u.is_active=$2)
        GROUP BY u.id, cp.city ORDER BY max(lower(b.during)) DESC NULLS LAST, u.created_at DESC LIMIT $3`, [like(f.q), f.status ? f.status === 'active' : null, f.limit]);
    const sum = (await ctx.db.query(`SELECT count(*)::int AS customers, count(*) FILTER (WHERE is_active)::int AS active, count(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS new_30d FROM users WHERE role='customer'`)).rows[0];
    const repeat = (await ctx.db.query(`SELECT count(*)::int AS n FROM (SELECT customer_id FROM bookings WHERE customer_id IS NOT NULL AND status IN ('confirmed','completed') GROUP BY customer_id HAVING count(*) > 1) x`)).rows[0].n;
    res.json({ customers: rows, summary: { ...sum, repeat } });
  });
  r.get('/customers/:id', P('users:read'), async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    const u = (await ctx.db.query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.email_verified, u.phone_verified, u.is_active, u.created_at, cp.city, cp.preferred_sports AS "preferredSports", cp.avatar_url AS "avatarUrl"
         FROM users u LEFT JOIN customer_profiles cp ON cp.user_id=u.id WHERE u.id=$1 AND u.role='customer'`, [id])).rows[0];
    if (!u) throw notFound('Customer not found');
    const [bookings, stats, refunds, tickets, reviews, logins] = await Promise.all([
      ctx.db.query(`SELECT b.id, b.reference, b.status, b.total::float8 AS total, lower(b.during) AS starts_at, v.name AS venue, a.name AS area, sp.name AS sport, b.cancel_reason
                      FROM bookings b JOIN venues v ON v.id=b.venue_id JOIN playing_areas a ON a.id=b.area_id LEFT JOIN sports sp ON sp.id=b.sport_id WHERE b.customer_id=$1 AND b.block_kind IS NULL ORDER BY lower(b.during) DESC LIMIT 100`, [id]),
      ctx.db.query(`SELECT count(*) FILTER (WHERE status IN ('confirmed','completed'))::int AS bookings, count(*) FILTER (WHERE status='cancelled')::int AS cancelled,
                           COALESCE(sum(total) FILTER (WHERE status IN ('confirmed','completed')),0)::float8 AS spent FROM bookings WHERE customer_id=$1 AND block_kind IS NULL`, [id]),
      ctx.db.query(`SELECT COALESCE(sum(rf.amount) FILTER (WHERE rf.status='processed'),0)::float8 AS refunded, count(*)::int AS n FROM refunds rf JOIN bookings b ON b.id=rf.booking_id WHERE b.customer_id=$1`, [id]),
      ctx.db.query(`SELECT id, subject, status, created_at FROM support_tickets WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20`, [id]),
      ctx.db.query(`SELECT r.rating, r.comment, r.created_at, v.name AS venue FROM reviews r JOIN venues v ON v.id=r.venue_id WHERE r.customer_id=$1 ORDER BY r.created_at DESC LIMIT 20`, [id]),
      ctx.db.query(`SELECT created_at, ip FROM audit_logs WHERE actor_id=$1 AND action='user.login' ORDER BY created_at DESC LIMIT 5`, [id]),
    ]);
    res.json({ customer: u, stats: { ...stats.rows[0], refunded: refunds.rows[0].refunded, refunds: refunds.rows[0].n, wallet: await walletBalance(ctx.db, id, ctx.now()) }, bookings: bookings.rows, tickets: tickets.rows, reviews: reviews.rows, logins: logins.rows });
  });

  r.get('/users/:id/wallet', P('payouts'), async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    const u = (await ctx.db.query(`SELECT id, full_name, email FROM users WHERE id=$1 AND role='customer'`, [id])).rows[0];
    if (!u) throw notFound('Customer not found');
    const entries = (await ctx.db.query(`SELECT l.id, l.delta::float8 AS delta, l.kind, l.note, l.created_at, b.reference, a.full_name AS by FROM wallet_ledger l LEFT JOIN bookings b ON b.id=l.booking_id LEFT JOIN users a ON a.id=l.created_by WHERE l.user_id=$1 ORDER BY l.created_at DESC, l.id DESC LIMIT 50`, [id])).rows;
    res.json({ user: u, balance: await walletBalance(ctx.db, id, ctx.now()), entries });
  });
  r.post('/users/:id/wallet', P('payouts'), async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    const b = parse(z.object({ amount: z.number().refine((n) => n !== 0 && Math.abs(n) <= 50000, 'Enter an amount up to ₹50,000'), reason: z.string().trim().min(5, 'Say why').max(200) }), req.body);
    if (!(await ctx.db.query(`SELECT 1 FROM users WHERE id=$1 AND role='customer'`, [id])).rows[0]) throw notFound('Customer not found');
    const now = ctx.now(); const amount = round2(b.amount);
    await ctx.db.tx(async (q) => {
      if (amount > 0) await walletCredit(q, { userId: id, amount, source: 'admin', note: b.reason, createdBy: req.user!.id, now });
      else if (!(await walletDebit(q, { userId: id, amount: -amount, kind: 'admin_debit', note: b.reason, createdBy: req.user!.id, now }))) throw conflict('The customer does not have that much wallet balance', 'insufficient_wallet');
    });
    await audit(ctx.db, req, amount > 0 ? 'wallet.credit' : 'wallet.debit', 'user', id, { amount, reason: b.reason });
    if (amount > 0) await ctx.notifier.notify(id, { title: 'Wallet credit added', type: 'wallet', body: `₹${amount} was added to your PlaynX wallet: ${b.reason}`, data: { link: '/wallet' } });
    res.json({ balance: await walletBalance(ctx.db, id, ctx.now()) });
  });

  // ---- approval checklist, venue scores, saved rejection reasons
  r.get('/venues/:id/readiness', P('venues'), async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    if (!(await ctx.db.query('SELECT 1 FROM venues WHERE id=$1', [id])).rows[0]) throw notFound('Venue not found');
    const [checklist, score] = await Promise.all([reviewChecklist(ctx.db, id, { requireGeotag: ctx.cfg.REQUIRE_AREA_GEOTAG === 'true', maxPhotoMeters: ctx.cfg.GEOTAG_MAX_METERS }), venueScore(ctx.db, id, ctx.now())]);
    res.json({ checklist, score });
  });
  r.put('/venues/:id/review-checks/:key', P('venues'), async (req, res) => {
    const id = parse(z.uuid(), req.params.id); const key = parse(z.enum(MANUAL_CHECKS.map((m) => m.id) as [string, ...string[]]), req.params.key);
    const b = parse(z.object({ checked: z.boolean() }), req.body);
    if (!(await ctx.db.query('SELECT 1 FROM venues WHERE id=$1', [id])).rows[0]) throw notFound('Venue not found');
    if (b.checked) await ctx.db.query(`INSERT INTO venue_review_checks (venue_id, key, checked_by) VALUES ($1,$2,$3) ON CONFLICT (venue_id, key) DO UPDATE SET checked_by=$3, checked_at=now()`, [id, key, req.user!.id]);
    else await ctx.db.query('DELETE FROM venue_review_checks WHERE venue_id=$1 AND key=$2', [id, key]);
    await audit(ctx.db, req, b.checked ? 'venue.review_check' : 'venue.review_uncheck', 'venue', id, { key });
    res.json({ checked: b.checked });
  });
  r.get('/venue-scores', P('venues'), async (_req, res) => {
    const { rows } = await ctx.db.query(`SELECT id FROM venues WHERE status IN ('approved','ready') ORDER BY created_at DESC LIMIT 200`);
    const now = ctx.now(); const scores: Record<string, { score: number; grade: string }> = {};
    for (const v of rows) { const s = await venueScore(ctx.db, v.id, now); scores[v.id] = { score: s.score, grade: s.grade }; }
    res.json({ scores });
  });
  r.get('/rejection-templates', P('venues'), async (_req, res) => res.json({ templates: (await ctx.db.query('SELECT id, label, body FROM rejection_templates ORDER BY created_at')).rows }));
  r.post('/rejection-templates', P('venues'), async (req, res) => {
    const b = parse(z.object({ label: z.string().trim().min(2).max(40), body: z.string().trim().min(10).max(300) }), req.body);
    const { rows } = await ctx.db.query('INSERT INTO rejection_templates (label, body, created_by) VALUES ($1,$2,$3) RETURNING id, label, body', [b.label, b.body, req.user!.id]);
    res.status(201).json({ template: rows[0] });
  });
  r.delete('/rejection-templates/:id', P('venues'), async (req, res) => {
    const { rowCount } = await ctx.db.query('DELETE FROM rejection_templates WHERE id=$1', [parse(z.uuid(), req.params.id)]);
    if (!rowCount) throw notFound('Template not found');
    res.status(204).end();
  });

  r.post('/venues/:id/decision', P('venues'), async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    const b = parse(z.object({ decision: z.enum(['approve', 'reject', 'suspend', 'reinstate']), reason: z.string().trim().max(500).optional() })
      .refine((x) => !['reject', 'suspend'].includes(x.decision) || !!x.reason, { message: 'A reason is required', path: ['reason'] }), req.body);
    const v = (await ctx.db.query(`SELECT v.*, o.verification_status FROM venues v JOIN owner_profiles o ON o.user_id=v.owner_id WHERE v.id=$1`, [id])).rows[0];
    if (!v) throw notFound('Venue not found');
    const next = { approve: 'ready', reject: 'rejected', suspend: 'suspended', reinstate: 'ready' }[b.decision]; // approval does not publish: the owner does that
    if (b.decision === 'approve') {
      if (v.status !== 'pending') throw conflict('Only venues awaiting review can be approved');
      if (v.verification_status !== 'verified') throw conflict('Verify the owner account before approving venues', 'owner_unverified');
      const bad = await ctx.db.query(`SELECT 1 FROM venue_documents WHERE venue_id=$1 AND status='rejected' LIMIT 1`, [id]);
      const unreviewed = await ctx.db.query(`SELECT 1 FROM venue_documents WHERE venue_id=$1 AND status='pending' LIMIT 1`, [id]);
      if (bad.rows[0] || unreviewed.rows[0]) throw conflict('All documents must be reviewed and approved first', 'documents_pending');
    }
    if (b.decision === 'reject' && v.status !== 'pending') throw conflict('Only venues awaiting review can be rejected');
    await ctx.db.query('UPDATE venues SET status=$2, rejection_reason=$3, updated_at=now() WHERE id=$1', [id, next, b.reason ?? null]);
    await audit(ctx.db, req, `venue.${b.decision}`, 'venue', id, { reason: b.reason });
    await ctx.notifier.notify(v.owner_id, { title: `Venue ${next}`, type: 'venue_status', email: true, data: { venueId: id },
      body: `${v.name} is ${next === 'ready' ? 'approved. Open it and press Publish to show it to customers' : `now ${next}`}.${b.reason ? ` Reason: ${b.reason}` : ''}` });
    res.json({ status: next });
  });
  r.get('/venue-documents/:id/file', P('venues'), async (req, res) => {
    const d = (await ctx.db.query('SELECT id, url FROM venue_documents WHERE id=$1', [parse(z.uuid(), req.params.id)])).rows[0];
    if (!d) throw notFound('Document not found');
    await audit(ctx.db, req, 'document.view', 'venue_document', d.id);
    await sendStoredFile(ctx, res, d.url);
  });
  r.patch('/documents/:id', P('venues'), async (req, res) => {
    const b = parse(z.object({ status: z.enum(['approved', 'rejected']), note: z.string().trim().max(300).optional() }), req.body);
    const { rows } = await ctx.db.query(`UPDATE venue_documents SET status=$2, note=$3, reviewed_by=$4 WHERE id=$1 RETURNING id, venue_id, doc_type, status, note`, [parse(z.uuid(), req.params.id), b.status, b.note ?? null, req.user!.id]);
    if (!rows[0]) throw notFound('Document not found');
    await audit(ctx.db, req, `document.${b.status}`, 'venue_document', rows[0].id, { note: b.note });
    res.json({ document: rows[0] });
  });

  // ---------------- bookings, payments, refunds
  r.get('/bookings', P('bookings'), async (req, res) => {
    const f = parse(z.object({ status: z.string().max(20).optional(), q: z.string().max(100).optional(), from: z.iso.date().optional(), to: z.iso.date().optional() }), req.query);
    const { limit, offset } = page(req.query, 100);
    const { rows } = await ctx.db.query(
      `SELECT b.id, b.reference, b.status, lower(b.during) AS starts_at, upper(b.during) AS ends_at, b.total, b.discount, b.commission_amount, b.created_at,
         v.name AS venue_name, a.name AS area_name, COALESCE(u.full_name, b.walkin_name) AS customer_name, COALESCE(u.email, b.walkin_email) AS customer_email, b.source, count(*) OVER()::int AS total_rows
       FROM bookings b JOIN venues v ON v.id=b.venue_id JOIN playing_areas a ON a.id=b.area_id LEFT JOIN users u ON u.id=b.customer_id
       WHERE ($1::text IS NULL OR b.status=$1) AND ($2::text IS NULL OR b.reference ILIKE $2 OR COALESCE(u.email, b.walkin_email) ILIKE $2 OR v.name ILIKE $2)
         AND ($3::date IS NULL OR lower(b.during) >= $3::date) AND ($4::date IS NULL OR lower(b.during) < $4::date + 1)
       ORDER BY b.created_at DESC LIMIT $5 OFFSET $6`, [f.status ?? null, like(f.q), f.from ?? null, f.to ?? null, limit, offset]);
    res.json({ bookings: rows.map(({ total_rows, ...b }) => b), total: rows[0]?.total_rows ?? 0 });
  });
  r.post('/bookings/:id/cancel', P('bookings'), async (req, res) => {
    const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(300) }), req.body);
    const out = await cancelBooking(ctx, req.user!, parse(z.uuid(), req.params.id), reason);
    await audit(ctx.db, req, 'booking.admin_cancel', 'booking', req.params.id as string, { reason });
    res.json(out);
  });

  r.get('/payments', P('payments'), async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : null;
    const { limit, offset } = page(req.query, 100);
    const { rows } = await ctx.db.query(
      `SELECT p.id, p.razorpay_order_id, p.razorpay_payment_id, p.amount, p.status, p.method, p.created_at, p.paid_at, b.reference, u.full_name AS customer_name, v.name AS venue_name, count(*) OVER()::int AS total_rows
       FROM payments p JOIN bookings b ON b.id=p.booking_id JOIN users u ON u.id=b.customer_id JOIN venues v ON v.id=b.venue_id
       WHERE ($1::text IS NULL OR p.status=$1) ORDER BY p.created_at DESC LIMIT $2 OFFSET $3`, [status, limit, offset]);
    const sum = (await ctx.db.query(`SELECT COALESCE(sum(amount) FILTER (WHERE status IN ('captured','partially_refunded','refunded')),0)::float8 AS captured, count(*) FILTER (WHERE status='failed')::int AS failed FROM payments`)).rows[0];
    res.json({ payments: rows.map(({ total_rows, ...p }) => p), total: rows[0]?.total_rows ?? 0, summary: sum });
  });

  r.get('/refunds', P('refunds'), async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : null;
    const { rows } = await ctx.db.query(
      `SELECT rf.*, b.reference, u.full_name AS customer_name FROM refunds rf JOIN bookings b ON b.id=rf.booking_id JOIN users u ON u.id=b.customer_id
       WHERE ($1::text IS NULL OR rf.status=$1) ORDER BY rf.created_at DESC LIMIT 200`, [status]);
    res.json({ refunds: rows });
  });
  r.post('/refunds', P('refunds'), async (req, res) => {
    const b = parse(z.object({ bookingId: z.uuid(), amount: z.number().positive().optional(), reason: z.string().trim().min(3).max(300) }), req.body);
    const refund = await issueRefund(ctx, { bookingId: b.bookingId, amount: b.amount ?? null, reason: b.reason, requestedBy: req.user!.id });
    await audit(ctx.db, req, 'refund.manual', 'refund', refund.id, { amount: refund.amount });
    res.status(201).json({ refund });
  });
  r.post('/refunds/:id/retry', P('refunds'), async (req, res) => {
    const refund = await retryRefund(ctx, parse(z.uuid(), req.params.id));
    await audit(ctx.db, req, 'refund.retry', 'refund', refund.id);
    res.json({ refund });
  });

  // ---------------- payouts + commission
  r.get('/settings', P('settings'), async (_req, res) => res.json({
    commissionPercent: await getSetting<number>(ctx.db, 'commission_percent', 10),
    slotLockMinutes: await getSetting<number>(ctx.db, 'slot_lock_minutes', 10),
    maxAdvanceBookingDays: await getSetting<number>(ctx.db, 'max_advance_booking_days', 60),
    payoutHoldHours: await getSetting<number>(ctx.db, 'payout_hold_hours', 48),
    autoPayouts: await getSetting<boolean>(ctx.db, 'auto_payouts', true), autoPayoutMin: await getSetting<number>(ctx.db, 'auto_payout_min', 500), gstRate: await getSetting<number>(ctx.db, 'gst_rate', 18), gstSac: await getSetting<string>(ctx.db, 'gst_sac', '999692') }));
  r.put('/settings', P('settings'), async (req, res) => {
    const b = parse(z.object({ commissionPercent: z.number().min(0).max(50).optional(), slotLockMinutes: z.number().int().min(2).max(30).optional(), maxAdvanceBookingDays: z.number().int().min(1).max(365).optional(), payoutHoldHours: z.number().int().min(0).max(720).optional(), autoPayouts: z.boolean().optional(), autoPayoutMin: z.number().min(100).max(1000000).optional(), gstRate: z.number().min(0).max(40).optional(), gstSac: z.string().trim().regex(/^[0-9]{4,8}$/).optional() }), req.body);
    const map: Record<string, number | string | boolean | undefined> = { auto_payouts: b.autoPayouts, auto_payout_min: b.autoPayoutMin, gst_rate: b.gstRate, gst_sac: b.gstSac, commission_percent: b.commissionPercent, slot_lock_minutes: b.slotLockMinutes, max_advance_booking_days: b.maxAdvanceBookingDays, payout_hold_hours: b.payoutHoldHours };
    for (const [k, v] of Object.entries(map)) if (v !== undefined)
      await ctx.db.query(`INSERT INTO platform_settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`, [k, JSON.stringify(v)]);
    await audit(ctx.db, req, 'settings.update', 'settings', null, b);
    res.json({ updated: true });
  });

  r.get('/payouts', P('payouts'), async (_req, res) => {
    const { rows } = await ctx.db.query(`SELECT p.*, u.full_name AS owner_name, o.business_name FROM owner_payouts p JOIN users u ON u.id=p.owner_id JOIN owner_profiles o ON o.user_id=u.id ORDER BY p.created_at DESC LIMIT 200`);
    const [owners, esc] = await Promise.all([
      ctx.db.query(`SELECT u.id AS owner_id, u.full_name, o.business_name,
          COALESCE((SELECT sum(amount) FROM owner_payouts WHERE owner_id=u.id AND status<>'failed'),0)::float8 AS already_paid
        FROM users u JOIN owner_profiles o ON o.user_id=u.id WHERE u.role='owner'`),
      escrowByOwner(ctx.db, ctx.now())]);
    const balances = owners.rows.map((o: any) => { const e = esc.get(o.owner_id) ?? emptyEscrow; return { ...o, payable: Math.max(0, Math.round((e.released - o.already_paid) * 100) / 100), holding: e.holding, disputed: e.disputed }; })
      .filter((o: any) => o.payable > 0 || o.holding > 0 || o.disputed > 0).sort((a: any, b: any) => b.payable - a.payable);
    res.json({ payouts: rows, balances, holdHours: await holdHours(ctx.db), bank: { enabled: !!ctx.payouts?.enabled(), auto: await getSetting<boolean>(ctx.db, 'auto_payouts', true), autoMin: await getSetting<number>(ctx.db, 'auto_payout_min', 500) } });
  });
  r.post('/payouts', P('payouts'), async (req, res) => {
    const b = parse(z.object({ ownerId: z.uuid(), amount: z.number().positive(), periodStart: z.iso.date(), periodEnd: z.iso.date() }), req.body);
    const bank = (await ctx.db.query('SELECT bank_verified FROM owner_profiles WHERE user_id=$1', [b.ownerId])).rows[0];
    if (!bank?.bank_verified) throw conflict('Verify the owner\'s bank account before creating a payout', 'bank_unverified');
    const available = await payableNow(ctx, b.ownerId);
    if (b.amount > available + 0.005) throw conflict(`Only ₹${available} can be released to this owner now. Money stays with PlaynX for ${await holdHours(ctx.db)} hours after the game, and while the customer has an open complaint.`, 'not_released');
    const { rows } = await ctx.db.query(`INSERT INTO owner_payouts (owner_id, amount, period_start, period_end) VALUES ($1,$2,$3,$4) RETURNING *`, [b.ownerId, b.amount, b.periodStart, b.periodEnd]);
    await audit(ctx.db, req, 'payout.create', 'payout', rows[0].id, { amount: b.amount });
    res.status(201).json({ payout: rows[0] });
  });
  /** Send a pending payout through the bank (RazorpayX). The webhook later marks it paid or failed. */
  r.post('/payouts/:id/send', P('payouts'), async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    const out = await sendPayout(ctx, id);
    await audit(ctx.db, req, 'payout.send', 'payout', id, { gatewayPayoutId: out.gatewayPayoutId });
    res.json({ sent: true, ...out });
  });
  r.patch('/payouts/:id', P('payouts'), async (req, res) => {
    const b = parse(z.object({ status: z.enum(['paid', 'failed']), reference: z.string().trim().max(100).optional() }), req.body);
    const { rows } = await ctx.db.query(`UPDATE owner_payouts SET status=$2, reference=COALESCE($3,reference), paid_at=CASE WHEN $2='paid' THEN now() ELSE paid_at END WHERE id=$1 AND status='pending' RETURNING *`, [parse(z.uuid(), req.params.id), b.status, b.reference ?? null]);
    if (!rows[0]) throw notFound('Pending payout not found');
    await audit(ctx.db, req, `payout.${b.status}`, 'payout', rows[0].id);
    await ctx.notifier.notify(rows[0].owner_id, { title: `Payout ${b.status}`, type: 'payout', body: `Your payout of ₹${rows[0].amount} is ${b.status}.`, email: true });
    res.json({ payout: rows[0] });
  });

  // ---------------- coupons (platform-wide or venue-specific)
  const couponSchema = z.object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,20}$/), description: z.string().trim().max(200).optional(), venueId: z.uuid().nullable().optional(),
    discountType: z.enum(['percent', 'flat']), value: z.number().positive(), maxDiscount: z.number().positive().optional(), minAmount: z.number().min(0).default(0),
    validFrom: iso.optional(), validTo: iso, usageLimit: z.number().int().positive().optional(), perUserLimit: z.number().int().positive().default(1),
  }).refine((c) => c.discountType !== 'percent' || c.value <= 100, { message: 'Percent discount cannot exceed 100', path: ['value'] });
  r.get('/coupons', P('coupons'), async (_req, res) =>
    res.json({ coupons: (await ctx.db.query(`SELECT c.*, v.name AS venue_name FROM coupons c LEFT JOIN venues v ON v.id=c.venue_id ORDER BY c.valid_to DESC LIMIT 300`)).rows }));
  r.post('/coupons', P('coupons'), async (req, res) => {
    const b = parse(couponSchema, req.body);
    const { rows } = await ctx.db.query(
      `INSERT INTO coupons (code, description, discount_type, value, max_discount, min_amount, valid_from, valid_to, usage_limit, per_user_limit, venue_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::timestamptz, now()),$8,$9,$10,$11,$12) RETURNING *`,
      [b.code, b.description ?? null, b.discountType, b.value, b.maxDiscount ?? null, b.minAmount, b.validFrom ?? null, b.validTo, b.usageLimit ?? null, b.perUserLimit, b.venueId ?? null, req.user!.id]);
    await audit(ctx.db, req, 'coupon.create', 'coupon', rows[0].id, { code: b.code });
    res.status(201).json({ coupon: rows[0] });
  });
  r.patch('/coupons/:id', P('coupons'), async (req, res) => {
    const { isActive } = parse(z.object({ isActive: z.boolean() }), req.body);
    const { rows } = await ctx.db.query('UPDATE coupons SET is_active=$2 WHERE id=$1 RETURNING *', [parse(z.uuid(), req.params.id), isActive]);
    if (!rows[0]) throw notFound('Coupon not found');
    await audit(ctx.db, req, isActive ? 'coupon.enable' : 'coupon.disable', 'coupon', rows[0].id);
    res.json({ coupon: rows[0] });
  });

  // ---------------- broadcast notifications
  r.post('/notifications/broadcast', P('notifications'), async (req, res) => {
    const b = parse(z.object({ audience: z.enum(['all', 'customers', 'owners', 'user']), userId: z.uuid().optional(), title: z.string().trim().min(2).max(100), body: z.string().trim().min(2).max(500), city: z.string().trim().max(80).optional() })
      .refine((x) => x.audience !== 'user' || !!x.userId, { message: 'userId is required', path: ['userId'] }), req.body);
    const { rows } = await ctx.db.query(
      `SELECT id FROM users WHERE is_active AND role <> 'admin' AND ($1='all' OR ($1='customers' AND role='customer') OR ($1='owners' AND role='owner') OR ($1='user' AND id=$2::uuid))
         AND ($3::text IS NULL OR $1='user' OR id IN (SELECT user_id FROM customer_profiles WHERE lower(city)=lower($3)) OR id IN (SELECT owner_id FROM venues WHERE lower(city)=lower($3))) LIMIT 5000`, [b.audience, b.userId ?? null, b.city || null]);
    for (let i = 0; i < rows.length; i += 25)
      await Promise.all(rows.slice(i, i + 25).map((u: any) => ctx.notifier.notify(u.id, { title: b.title, body: b.body, type: 'announcement' })));
    await audit(ctx.db, req, 'notification.broadcast', 'notification', null, { audience: b.audience, city: b.city || null, recipients: rows.length, title: b.title });
    res.json({ recipients: rows.length });
  });

  // ---------------- complaints / support tickets
  r.get('/tickets', P('tickets'), async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : null;
    const { rows } = await ctx.db.query(
      `SELECT t.*, u.full_name AS user_name, u.role AS user_role, b.reference AS booking_reference FROM support_tickets t JOIN users u ON u.id=t.user_id LEFT JOIN bookings b ON b.id=t.booking_id
       WHERE ($1::text IS NULL OR t.status=$1) ORDER BY (t.status IN ('open','in_progress')) DESC, t.updated_at DESC LIMIT 200`, [status]);
    res.json({ tickets: rows });
  });
  r.get('/tickets/:id', P('tickets'), async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    const t = (await ctx.db.query('SELECT t.*, u.full_name AS user_name, u.email AS user_email FROM support_tickets t JOIN users u ON u.id=t.user_id WHERE t.id=$1', [id])).rows[0];
    if (!t) throw notFound('Ticket not found');
    const messages = (await ctx.db.query(`SELECT m.id, m.body, m.created_at, u.full_name AS author, u.role AS author_role FROM ticket_messages m JOIN users u ON u.id=m.author_id WHERE m.ticket_id=$1 ORDER BY m.created_at`, [id])).rows;
    // the booking the complaint is about, with what was paid and what is already refunded: the admin refunds from here
    const booking = t.booking_id ? (await ctx.db.query(
      `SELECT b.id, b.reference, b.status, b.total::float8 AS total, lower(b.during) AS starts_at, v.name AS venue_name, a.name AS area_name,
              COALESCE((SELECT sum(p.amount) FROM payments p WHERE p.booking_id=b.id AND p.razorpay_payment_id IS NOT NULL AND p.status IN ('captured','partially_refunded','refunded')),0)::float8 AS paid,
              COALESCE((SELECT sum(r.amount) FROM refunds r WHERE r.booking_id=b.id AND r.status <> 'failed'),0)::float8 AS refunded
         FROM bookings b JOIN venues v ON v.id=b.venue_id JOIN playing_areas a ON a.id=b.area_id WHERE b.id=$1`, [t.booking_id])).rows[0] ?? null : null;
    const money2 = (x: any) => ({ ...x, refundable: Math.max(0, Math.round((x.paid - x.refunded) * 100) / 100) });
    // no booking named on the ticket: the customer's paid PlaynX bookings, so the admin can choose the one to refund
    const bookings = booking ? undefined : (await ctx.db.query(
      `SELECT b.id, b.reference, b.status, b.total::float8 AS total, lower(b.during) AS starts_at, v.name AS venue_name, a.name AS area_name,
              COALESCE((SELECT sum(p.amount) FROM payments p WHERE p.booking_id=b.id AND p.razorpay_payment_id IS NOT NULL AND p.status IN ('captured','partially_refunded','refunded')),0)::float8 AS paid,
              COALESCE((SELECT sum(r.amount) FROM refunds r WHERE r.booking_id=b.id AND r.status <> 'failed'),0)::float8 AS refunded
         FROM bookings b JOIN venues v ON v.id=b.venue_id JOIN playing_areas a ON a.id=b.area_id
        WHERE b.customer_id=$1 AND EXISTS (SELECT 1 FROM payments p WHERE p.booking_id=b.id AND p.razorpay_payment_id IS NOT NULL AND p.status IN ('captured','partially_refunded'))
        ORDER BY lower(b.during) DESC LIMIT 30`, [t.user_id])).rows.map(money2).filter((x: any) => x.refundable > 0);
    const attachments = (await ctx.db.query('SELECT id, kind, content_type, size_bytes, created_at FROM ticket_attachments WHERE ticket_id=$1 ORDER BY created_at', [id])).rows;
    res.json({ ticket: t, messages, booking: booking ? money2(booking) : null, bookings, attachments });
  });
  r.get('/tickets/:id/attachments/:attId/file', P('tickets'), async (req, res) => {
    const a = (await ctx.db.query('SELECT file_ref FROM ticket_attachments WHERE id=$1 AND ticket_id=$2', [parse(z.uuid(), req.params.attId), parse(z.uuid(), req.params.id)])).rows[0];
    if (!a) throw notFound('File not found');
    await sendStoredFile(ctx, res, a.file_ref);
  });
  r.post('/tickets/:id/reply', P('tickets'), async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    // The reply is optional: an admin can just change the status (for example mark it Resolved) without writing a message.
    const b = parse(z.object({ message: z.string().trim().max(3000).optional(), status: z.enum(['open', 'in_progress', 'resolved', 'closed']).default('in_progress') }), req.body);
    const t = (await ctx.db.query('SELECT user_id, subject FROM support_tickets WHERE id=$1', [id])).rows[0];
    if (!t) throw notFound('Ticket not found');
    if (b.message) await ctx.db.query('INSERT INTO ticket_messages (ticket_id, author_id, body) VALUES ($1,$2,$3)', [id, req.user!.id, b.message]);
    await ctx.db.query('UPDATE support_tickets SET status=$2, updated_at=now() WHERE id=$1', [id, b.status]);
    await audit(ctx.db, req, b.message ? 'ticket.reply' : 'ticket.status', 'ticket', id, { status: b.status });
    await ctx.notifier.notify(t.user_id, { title: b.message ? 'Support replied' : 'Support ticket updated', body: b.message ? `Re: ${t.subject}` : `Re: ${t.subject}. Status: ${b.status.replace('_', ' ')}`, type: 'support', email: true, data: { ticketId: id } });
    res.status(201).json({ ok: true });
  });

  /**
   * Settle a complaint with a refund: all of what is left, or a part. The refund goes back to the customer, the venue's share of
   * that booking shrinks by the same part (the rest is still paid out to the venue), the customer is told, and the ticket is resolved.
   */
  r.post('/tickets/:id/refund', P('refunds'), async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    const b = parse(z.object({ amount: z.number().positive().max(1000000).optional(), reason: z.string().trim().max(300).optional(), resolve: z.boolean().default(true), bookingId: z.uuid().optional() }), req.body);
    const t = (await ctx.db.query('SELECT id, user_id, subject, booking_id FROM support_tickets WHERE id=$1', [id])).rows[0];
    if (!t) throw notFound('Ticket not found');
    if (!t.booking_id && b.bookingId) { // the admin chose the booking: it must be this customer's, and it is linked to the ticket
      const own = (await ctx.db.query('SELECT 1 FROM bookings WHERE id=$1 AND customer_id=$2', [b.bookingId, t.user_id])).rows[0];
      if (!own) throw badRequest('That booking is not this customer\'s', 'not_customer_booking');
      await ctx.db.query('UPDATE support_tickets SET booking_id=$2 WHERE id=$1', [id, b.bookingId]); t.booking_id = b.bookingId;
    }
    if (!t.booking_id) throw badRequest('This complaint is not about a booking, so there is nothing to refund', 'no_booking');
    const bk = (await ctx.db.query('SELECT total::float8 AS total FROM bookings WHERE id=$1', [t.booking_id])).rows[0];
    const before = (await ctx.db.query(`SELECT COALESCE(sum(amount),0)::float8 AS n FROM refunds WHERE booking_id=$1 AND status <> 'failed'`, [t.booking_id])).rows[0].n as number;
    const refund = await issueRefund(ctx, { bookingId: t.booking_id, amount: b.amount ?? null, reason: b.reason ? `Complaint: ${b.reason}` : 'Complaint', requestedBy: req.user!.id });
    const left = bk.total - before; // what was still kept before this refund
    const keep = left > 0 ? Math.max(0, (left - Number(refund.amount)) / left) : 0;
    await ctx.db.query('UPDATE bookings SET owner_amount=round(owner_amount * $2::numeric, 2), commission_amount=round(commission_amount * $2::numeric, 2) WHERE id=$1', [t.booking_id, keep]);
    const note = `We have refunded ₹${Number(refund.amount).toLocaleString('en-IN')} for this complaint.${b.reason ? ` ${b.reason}` : ''}`;
    await ctx.db.query('INSERT INTO ticket_messages (ticket_id, author_id, body) VALUES ($1,$2,$3)', [id, req.user!.id, note]);
    if (b.resolve) await ctx.db.query(`UPDATE support_tickets SET status='resolved', updated_at=now() WHERE id=$1`, [id]);
    await audit(ctx.db, req, 'ticket.refund', 'ticket', id, { bookingId: t.booking_id, amount: Number(refund.amount), refundId: refund.id });
    // one email with the whole picture: the ticket, the booking, what was paid, what is refunded now and in all
    const info = (await ctx.db.query(
      `SELECT b.reference, v.name AS venue_name, to_char(lower(b.during) AT TIME ZONE v.timezone, 'DD Mon YYYY, HH12:MI AM') AS at,
              COALESCE((SELECT sum(p.amount) FROM payments p WHERE p.booking_id=b.id AND p.razorpay_payment_id IS NOT NULL AND p.status IN ('captured','partially_refunded','refunded')),0)::float8 AS paid,
              COALESCE((SELECT sum(r.amount) FROM refunds r WHERE r.booking_id=b.id AND r.status <> 'failed'),0)::float8 AS refunded
         FROM bookings b JOIN venues v ON v.id=b.venue_id WHERE b.id=$1`, [t.booking_id])).rows[0];
    const inr = (n: number) => `₹${Number(n).toLocaleString('en-IN')}`;
    await ctx.notifier.notify(t.user_id, { title: 'Refund for your complaint', type: 'support', email: true, data: { link: '/support' },
      body: `About the ticket you raised, "${t.subject}": for booking ${info.reference} at ${info.venue_name} on ${info.at}, you paid ${inr(info.paid)} in total. ` +
        `We have refunded ${inr(Number(refund.amount))} of it${info.refunded > Number(refund.amount) + 0.001 ? ` (${inr(info.refunded)} refunded on this booking in all)` : ''}.${b.reason ? ` Reason: ${b.reason}.` : ''} ` +
        `The money goes back the way you paid (UPI, card or bank) and usually reaches you in 5 to 7 working days.` });
    res.status(201).json({ refund, resolved: b.resolve });
  });

  // ---------------- reviews moderation
  r.get('/reviews', P('venues'), async (req, res) => {
    const f = parse(z.object({ q: z.string().max(100).optional(), hidden: z.enum(['true', 'false']).optional(), rating: z.coerce.number().int().min(1).max(5).optional() }), req.query);
    const { rows } = await ctx.db.query(
      `SELECT r.id, r.rating, r.comment, r.owner_reply, r.is_hidden, r.created_at, v.id AS venue_id, v.name AS venue_name, u.id AS customer_id, u.full_name AS customer_name, u.email AS customer_email
         FROM reviews r JOIN venues v ON v.id=r.venue_id JOIN users u ON u.id=r.customer_id
        WHERE ($1::text IS NULL OR r.comment ILIKE $1 OR v.name ILIKE $1 OR u.full_name ILIKE $1) AND ($2::bool IS NULL OR r.is_hidden=$2) AND ($3::int IS NULL OR r.rating=$3)
        ORDER BY r.created_at DESC LIMIT 300`, [like(f.q), f.hidden ? f.hidden === 'true' : null, f.rating ?? null]);
    const sum = (await ctx.db.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE is_hidden)::int AS hidden, COALESCE(round(avg(rating) FILTER (WHERE NOT is_hidden), 2), 0)::float8 AS average FROM reviews`)).rows[0];
    res.json({ reviews: rows, summary: sum });
  });
  r.get('/wallets', P('payouts'), async (_req, res) => {
    const now = ctx.now().toISOString();
    const { rows } = await ctx.db.query(
      `SELECT u.id, u.full_name, u.email, u.phone, sum(l.remaining)::float8 AS balance, min(l.expires_at) AS next_expiry, max(l.created_at) AS last_credit
         FROM wallet_lots l JOIN users u ON u.id=l.user_id WHERE l.remaining > 0 AND l.expires_at > $1::timestamptz GROUP BY u.id ORDER BY sum(l.remaining) DESC LIMIT 300`, [now]);
    const soon = (await ctx.db.query(`SELECT COALESCE(sum(remaining),0)::float8 AS n FROM wallet_lots WHERE remaining > 0 AND expires_at > $1::timestamptz AND expires_at < $1::timestamptz + interval '30 days'`, [now])).rows[0].n;
    res.json({ wallets: rows, summary: { customers: rows.length, outstanding: rows.reduce((n: number, w: any) => n + w.balance, 0), expiringSoon: soon } });
  });

  r.patch('/reviews/:id', P('venues'), async (req, res) => {
    const { isHidden } = parse(z.object({ isHidden: z.boolean() }), req.body);
    const rv = (await ctx.db.query('UPDATE reviews SET is_hidden=$2 WHERE id=$1 RETURNING venue_id', [parse(z.uuid(), req.params.id), isHidden])).rows[0];
    if (!rv) throw notFound('Review not found');
    await ctx.db.query(`UPDATE venues SET rating_avg=COALESCE((SELECT round(avg(rating)::numeric,2) FROM reviews WHERE venue_id=$1 AND NOT is_hidden),0), rating_count=(SELECT count(*) FROM reviews WHERE venue_id=$1 AND NOT is_hidden) WHERE id=$1`, [rv.venue_id]);
    await audit(ctx.db, req, isHidden ? 'review.hide' : 'review.show', 'review', req.params.id as string);
    res.json({ ok: true });
  });

  // ---------------- audit logs + admin team (RBAC)
  r.get('/audit-logs', P('audit'), async (req, res) => {
    const f = parse(z.object({ entity: z.string().max(40).optional(), action: z.string().max(60).optional(), q: z.string().trim().max(100).optional(), from: z.iso.date().optional(), to: z.iso.date().optional() }), req.query);
    const { limit, offset } = page(req.query, 200);
    const { rows } = await ctx.db.query(
      `SELECT a.*, u.full_name AS actor_name FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id
       WHERE ($1::text IS NULL OR a.entity=$1) AND ($2::text IS NULL OR a.action ILIKE $2)
         AND ($3::text IS NULL OR a.action ILIKE $3 OR a.entity ILIKE $3 OR a.entity_id ILIKE $3 OR u.full_name ILIKE $3 OR u.email ILIKE $3 OR a.metadata::text ILIKE $3)
         AND ($4::date IS NULL OR a.created_at >= $4::date) AND ($5::date IS NULL OR a.created_at < $5::date + 1)
       ORDER BY a.created_at DESC, a.id DESC LIMIT $6 OFFSET $7`, [f.entity ?? null, like(f.action), like(f.q), f.from ?? null, f.to ?? null, limit, offset]);
    res.json({ logs: rows });
  });
  /** How each coupon is doing: uses, the discount it gave away, the booking value it brought in, and how many different customers used it. */
  r.get('/coupons/performance', P('coupons'), async (_req, res) => {
    const { rows } = await ctx.db.query(
      `SELECT c.id, c.code, c.discount_type, c.value::float8 AS value, c.is_active, c.valid_to, c.usage_limit, c.used_count, v.name AS venue_name,
              count(b.id) FILTER (WHERE b.status IN ('confirmed','completed'))::int AS bookings,
              COALESCE(sum(b.discount) FILTER (WHERE b.status IN ('confirmed','completed')), 0)::float8 AS discount_given,
              COALESCE(sum(b.total) FILTER (WHERE b.status IN ('confirmed','completed')), 0)::float8 AS revenue,
              count(DISTINCT b.customer_id) FILTER (WHERE b.status IN ('confirmed','completed'))::int AS customers
         FROM coupons c LEFT JOIN venues v ON v.id=c.venue_id LEFT JOIN bookings b ON b.coupon_id=c.id
        GROUP BY c.id, v.name ORDER BY revenue DESC, c.code`);
    res.json({ coupons: rows });
  });
  r.get('/team', P('admins'), async (_req, res) =>
    res.json({ admins: (await ctx.db.query(`SELECT id, full_name, email, admin_role, admin_permissions, is_active, created_at, (totp_enabled_at IS NOT NULL) AS mfa_enabled FROM users WHERE role='admin' ORDER BY created_at`)).rows, permissions: ADMIN_PERMISSION_CATALOGUE }));
  r.post('/team', P('admins'), async (req, res) => {
    const b = parse(z.object({ email: z.email(), fullName: z.string().trim().min(2).max(100), password: z.string().min(10).max(72), adminRole: z.enum(['super_admin', 'operations', 'finance', 'support']), permissions: permList.optional() }), req.body);
    const hash = await bcrypt.hash(b.password, ctx.cfg.NODE_ENV === 'test' ? 4 : 12);
    const { rows } = await ctx.db.query(
      `INSERT INTO users (email, password_hash, full_name, role, admin_role, admin_permissions, email_verified) VALUES ($1,$2,$3,'admin',$4,$5,true) RETURNING id, email, full_name, admin_role, admin_permissions`, [b.email.toLowerCase(), hash, b.fullName, b.adminRole, b.permissions ?? null]);
    await audit(ctx.db, req, 'admin.create', 'user', rows[0].id, { adminRole: b.adminRole });
    await syncAccount(ctx.db, rows[0].id);
    res.status(201).json({ admin: rows[0] });
  });
  /** An admin lost their phone: clear their authenticator so they set it up again at the next sign-in. Signs them out everywhere. */
  r.post('/team/:id/reset-mfa', P('admins'), async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    if (id === req.user!.id) throw forbidden('Ask another admin to reset your two-step sign-in');
    const { rows } = await ctx.db.query(`UPDATE users SET totp_secret_enc=NULL, totp_enabled_at=NULL, totp_last_step=NULL, mfa_failed_count=0, mfa_locked_until=NULL, token_version=token_version+1 WHERE id=$1 AND role='admin' RETURNING id`, [id]);
    if (!rows[0]) throw notFound('Admin not found');
    await audit(ctx.db, req, 'admin.mfa_reset', 'user', id);
    await ctx.notifier.notify(id, { title: 'Two-step sign-in was reset', type: 'security', email: true, body: 'Another admin reset your authenticator. Set it up again with a new QR code the next time you sign in.' });
    res.json({ reset: true });
  });
  r.patch('/team/:id', P('admins'), async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    if (id === req.user!.id) throw forbidden('You cannot change your own role');
    const b = parse(z.object({ adminRole: z.enum(['super_admin', 'operations', 'finance', 'support']).optional(), permissions: permList.nullable().optional() })
      .refine((x) => x.adminRole !== undefined || x.permissions !== undefined, 'Nothing to change'), req.body);
    const { rows } = await ctx.db.query(
      `UPDATE users SET admin_role=COALESCE($2, admin_role), admin_permissions = CASE WHEN $3::boolean THEN $4::text[] ELSE admin_permissions END, token_version=token_version+1 WHERE id=$1 AND role='admin' RETURNING id, admin_role, admin_permissions`,
      [id, b.adminRole ?? null, b.permissions !== undefined, b.permissions ?? null]);
    if (!rows[0]) throw notFound('Admin not found');
    await audit(ctx.db, req, b.permissions !== undefined ? 'admin.permissions_changed' : 'admin.role_change', 'user', id, { adminRole: b.adminRole, permissions: b.permissions });
    res.json({ admin: rows[0] });
  });

  return r;
}
