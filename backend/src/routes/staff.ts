import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { Ctx } from '../types.js';
import { authenticate, requireActiveOwner, requireRole } from '../middleware/auth.js';
import { conflict, forbidden, notFound } from '../errors.js';
import { createOfflineBooking } from '../lib/bookings.js';
import { normalizePhone, INDIAN_MOBILE, INDIAN_MOBILE_MESSAGE } from '../lib/phone.js';
import { parse } from '../lib/http.js';
import { audit } from '../lib/audit.js';

const MAX_STAFF = 10;

/** An owner creates logins for the people at the gate. They can only check players in: no bookings list with money, no payouts, no settings. */
export const STAFF_PERMISSIONS: { id: string; label: string; hint: string }[] = [
  { id: 'CHECK_IN', label: 'Check players in', hint: 'Look up a booking reference and mark the player as arrived' },
  { id: 'BOOKING_VIEW', label: 'View bookings', hint: "See today's and upcoming bookings (no payment amounts)" },
  { id: 'BOOKING_CREATE', label: 'Add walk-in bookings', hint: 'Book a slot for someone at the counter' },
  { id: 'DASHBOARD_VIEW', label: 'View dashboard', hint: 'Counts for today and the coming days' },
  { id: 'VENUE_VIEW', label: 'View venues', hint: 'See your venues and their details' },
  { id: 'PLAYING_AREA_VIEW', label: 'View playing areas', hint: 'See the playing areas, sports and slot lengths' },
  { id: 'PRICING_VIEW', label: 'View pricing', hint: 'See the prices (cannot change them)' },
  { id: 'CALENDAR_VIEW', label: 'View calendar', hint: 'See what is booked or blocked on any day' },
  { id: 'REPORTS_VIEW', label: 'View reports', hint: 'Bookings and revenue for the last 30 days' },
];
/** What a staff login may do is one row per permission (staff_permissions), checked against staff_permission_catalog. */
async function setPermissions(q: { query: (sql: string, p?: unknown[]) => Promise<any> }, staffId: string, ownerId: string, codes: string[]) {
  await q.query('DELETE FROM staff_permissions WHERE staff_id=$1', [staffId]);
  if (codes.length) await q.query('INSERT INTO staff_permissions (staff_id, permission_code, granted_by) SELECT $1, c, $2 FROM unnest($3::text[]) AS c ON CONFLICT DO NOTHING', [staffId, ownerId, [...new Set(codes)]]);
  await q.query('UPDATE owner_staff SET updated_at=now() WHERE staff_id=$1', [staffId]);
}
/** The venues a staff login may work in: null = every venue of the owner (and the ones added later). */
export async function staffVenues(db: { query: (sql: string, p?: unknown[]) => Promise<any> }, staffId: string): Promise<string[] | null> {
  const st = (await db.query('SELECT all_venues FROM owner_staff WHERE staff_id=$1', [staffId])).rows[0];
  if (!st || st.all_venues) return null;
  return (await db.query('SELECT venue_id FROM venue_staff WHERE staff_id=$1', [staffId])).rows.map((x: any) => x.venue_id as string);
}
async function setVenues(q: { query: (sql: string, p?: unknown[]) => Promise<any> }, staffId: string, ownerId: string, allVenues: boolean, venueIds: string[]) {
  await q.query('UPDATE owner_staff SET all_venues=$2, updated_at=now() WHERE staff_id=$1', [staffId, allVenues]);
  await q.query('DELETE FROM venue_staff WHERE staff_id=$1', [staffId]);
  if (!allVenues && venueIds.length) await q.query('INSERT INTO venue_staff (venue_id, staff_id, created_by) SELECT v.id, $1, $2 FROM venues v WHERE v.owner_id=$2 AND v.id = ANY($3::uuid[]) ON CONFLICT DO NOTHING', [staffId, ownerId, venueIds]);
}
const PERM_IDS = STAFF_PERMISSIONS.map((p) => p.id);
const permsSchema = z.array(z.enum(PERM_IDS as [string, ...string[]])).max(PERM_IDS.length);

export function ownerStaffRoutes(ctx: Ctx) {
  const r = Router();
  r.use(authenticate(ctx), requireRole('owner'), requireActiveOwner(ctx, ['/application', '/activity', '/account/close', '/account/close-info']));
  const uid = (req: any) => req.user!.id as string;
  const own = async (id: string, owner: string) => { const s = (await ctx.db.query('SELECT 1 FROM owner_staff WHERE staff_id=$1 AND owner_id=$2', [id, owner])).rows[0]; if (!s) throw notFound('Staff member not found'); };

  r.get('/staff', async (req, res) => {
    const { rows } = await ctx.db.query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.is_active, s.created_at, s.all_venues, COALESCE((SELECT array_agg(vs.venue_id) FROM venue_staff vs WHERE vs.staff_id=s.staff_id), '{}'::uuid[]) AS venue_ids, COALESCE((SELECT array_agg(sp.permission_code ORDER BY sp.permission_code) FROM staff_permissions sp WHERE sp.staff_id=s.staff_id), '{}'::text[]) AS permissions, s.status, s.last_login_at,
              (SELECT max(created_at) FROM audit_logs a WHERE a.actor_id=u.id AND a.action='user.login') AS last_login,
              (SELECT count(*)::int FROM bookings b WHERE b.checked_in_by=u.id) AS check_ins
         FROM owner_staff s JOIN users u ON u.id=s.staff_id WHERE s.owner_id=$1 ORDER BY s.created_at`, [uid(req)]);
    res.json({ staff: rows, max: MAX_STAFF, permissions: STAFF_PERMISSIONS });
  });

  r.post('/staff', async (req, res) => {
    const b = parse(z.object({ fullName: z.string().trim().min(2).max(100), email: z.email().max(254), password: z.string().min(10, 'Use at least 10 characters').max(72), permissions: permsSchema.optional(), isActive: z.boolean().default(true), allVenues: z.boolean().default(true), venueIds: z.array(z.uuid()).max(100).default([]) })
      .refine((x) => x.allVenues || x.venueIds.length > 0, { message: 'Choose at least one venue, or give access to all venues', path: ['venueIds'] }), req.body);
    const n = (await ctx.db.query('SELECT count(*)::int AS n FROM owner_staff WHERE owner_id=$1', [uid(req)])).rows[0].n;
    if (n >= MAX_STAFF) throw conflict(`You can have up to ${MAX_STAFF} staff logins`, 'staff_limit');
    const email = b.email.toLowerCase();
    if ((await ctx.db.query('SELECT 1 FROM users WHERE lower(email)=$1', [email])).rows[0]) throw conflict('That email already has an account. Use a different email for this person.', 'email_taken');
    const hash = await bcrypt.hash(b.password, ctx.cfg.NODE_ENV === 'test' ? 4 : 12);
    const created = await ctx.db.tx(async (q) => {
      const u = (await q.query(`INSERT INTO users (email, password_hash, full_name, role, email_verified, is_active) VALUES ($1,$2,$3,'staff',true,$4) RETURNING id, full_name, email, is_active, created_at`, [email, hash, b.fullName, b.isActive])).rows[0];
      await q.query('INSERT INTO owner_staff (staff_id, owner_id, created_by, status) VALUES ($1,$2,$2,$3)', [u.id, uid(req), b.isActive ? 'ACTIVE' : 'INACTIVE']);
      await setPermissions(q, u.id, uid(req), b.permissions ?? ['CHECK_IN', 'BOOKING_VIEW']);
      await setVenues(q, u.id, uid(req), b.allVenues, b.venueIds);
      return u;
    });
    await audit(ctx.db, req, 'staff.create', 'user', created.id, { email });
    res.status(201).json({ staff: created });
  });

  r.patch('/staff/:id', async (req, res) => {
    const id = parse(z.uuid(), req.params.id); await own(id, uid(req));
    const b = parse(z.object({ isActive: z.boolean().optional(), password: z.string().min(10, 'Use at least 10 characters').max(72).optional(), permissions: permsSchema.optional(), allVenues: z.boolean().optional(), venueIds: z.array(z.uuid()).max(100).optional() }).refine((x) => x.isActive !== undefined || x.password !== undefined || x.permissions !== undefined || x.allVenues !== undefined, 'Nothing to change').refine((x) => x.allVenues !== false || (x.venueIds?.length ?? 0) > 0, { message: 'Choose at least one venue, or give access to all venues', path: ['venueIds'] }), req.body);
    if (b.permissions) { await ctx.db.tx((q) => setPermissions(q, id, uid(req), b.permissions!)); await audit(ctx.db, req, 'staff.permissions_changed', 'user', id, { permissions: b.permissions }); }
    if (b.allVenues !== undefined) { await ctx.db.tx((q) => setVenues(q, id, uid(req), b.allVenues!, b.venueIds ?? [])); await audit(ctx.db, req, 'staff.venues_changed', 'user', id, { allVenues: b.allVenues, venueIds: b.venueIds ?? [] }); }
    if (b.isActive !== undefined) { await ctx.db.query('UPDATE users SET is_active=$2, token_version=token_version+1 WHERE id=$1', [id, b.isActive]); await ctx.db.query(`UPDATE owner_staff SET status=$2, updated_at=now() WHERE staff_id=$1`, [id, b.isActive ? 'ACTIVE' : 'INACTIVE']); } // switching someone off also ends their session
    if (b.password) await ctx.db.query('UPDATE users SET password_hash=$2, token_version=token_version+1 WHERE id=$1', [id, await bcrypt.hash(b.password, ctx.cfg.NODE_ENV === 'test' ? 4 : 12)]);
    if (b.password || b.isActive !== undefined) await audit(ctx.db, req, b.password ? 'staff.password_reset' : b.isActive ? 'staff.enable' : 'staff.disable', 'user', id);
    res.json({ updated: true });
  });

  r.delete('/staff/:id', async (req, res) => {
    const id = parse(z.uuid(), req.params.id); await own(id, uid(req));
    await ctx.db.query(`DELETE FROM users WHERE id=$1 AND role='staff'`, [id]);
    await audit(ctx.db, req, 'staff.remove', 'user', id);
    res.status(204).end();
  });
  return r;
}

/** What a staff login can do: see who is booked today at their owner's venues, and check people in. */
export function staffRoutes(ctx: Ctx) {
  const r = Router();
  r.use(authenticate(ctx), requireRole('staff'));
  const ownerOf = async (req: any) => {
    const s = (await ctx.db.query(`SELECT s.owner_id, COALESCE((SELECT array_agg(sp.permission_code ORDER BY sp.permission_code) FROM staff_permissions sp WHERE sp.staff_id=s.staff_id), '{}'::text[]) AS permissions, op.business_name FROM owner_staff s JOIN owner_profiles op ON op.user_id=s.owner_id JOIN users o ON o.id=s.owner_id AND o.is_active WHERE s.staff_id=$1 AND s.status='ACTIVE'`, [req.user!.id])).rows[0];
    if (!s) throw notFound('This staff login is not linked to an active venue owner');
    return { ...s, venue_ids: await staffVenues(ctx.db, req.user!.id) } as { owner_id: string; business_name: string; permissions: string[]; venue_ids: string[] | null };
  };
  const only = (o: { venue_ids: string[] | null }) => (o.venue_ids ? ` AND v.id IN (${o.venue_ids.map((x) => `'${x}'`).join(',') || 'NULL'})` : '');
  const find = async (owner: string, reference: string, o?: { venue_ids: string[] | null }) => {
    const b = (await ctx.db.query(
      `SELECT b.id, b.reference, b.status, lower(b.during) AS starts_at, upper(b.during) AS ends_at, b.checked_in_at, a.name AS area_name, v.name AS venue_name, COALESCE(u.full_name, b.walkin_name) AS customer_name
         FROM bookings b JOIN venues v ON v.id=b.venue_id JOIN playing_areas a ON a.id=b.area_id LEFT JOIN users u ON u.id=b.customer_id
        WHERE b.reference=$1 AND v.owner_id=$2${o ? only(o) : ''}`, [reference, owner])).rows[0];
    if (!b) throw notFound('No matching booking for this venue');
    return b;
  };
  /** Every staff action is checked against what the owner ticked for this person. */
  const need = (o: { permissions: string[] }, ...any: string[]) => { if (!any.some((p) => o.permissions.includes(p))) throw forbidden('Your owner has not given you access to this. Ask them to update your permissions.'); };
  const valid = (b: any) => b.status === 'confirmed' && new Date(b.ends_at) > ctx.now();

  r.get('/me', async (req, res) => { const o = await ownerOf(req); res.json({ business: o.business_name, permissions: o.permissions }); });

  r.get('/overview', async (req, res) => {
    const o = await ownerOf(req); need(o, 'CHECK_IN', 'BOOKING_VIEW');
    const { rows } = await ctx.db.query(
      `SELECT b.id, b.reference, b.status, lower(b.during) AS starts_at, upper(b.during) AS ends_at, b.checked_in_at, v.name AS venue_name, a.name AS area_name, COALESCE(u.full_name, b.walkin_name) AS customer_name, v.timezone
         FROM bookings b JOIN venues v ON v.id=b.venue_id JOIN playing_areas a ON a.id=b.area_id LEFT JOIN users u ON u.id=b.customer_id
        WHERE v.owner_id=$1${only(o)} AND b.status IN ('confirmed','completed')
          AND (lower(b.during) AT TIME ZONE v.timezone)::date = (now() AT TIME ZONE v.timezone)::date ORDER BY lower(b.during)`, [o.owner_id]);
    res.json({ business: o.business_name, bookings: rows });
  });

  /** Is this booking good for entry right now? Nothing is recorded. */
  r.post('/verify', async (req, res) => {
    const o = await ownerOf(req); need(o, 'CHECK_IN'); const { reference } = parse(z.object({ reference: z.string().trim().min(6).max(20).transform((x) => x.toUpperCase()) }), req.body);
    const b = await find(o.owner_id, reference, o);
    res.json({ valid: valid(b), booking: { ...b, id: undefined } });
  });

  /** Records that the player has arrived. Doing it twice is harmless: the second time says so. */
  r.post('/check-in', async (req, res) => {
    const o = await ownerOf(req); need(o, 'CHECK_IN'); const { reference } = parse(z.object({ reference: z.string().trim().min(6).max(20).transform((x) => x.toUpperCase()) }), req.body);
    const b = await find(o.owner_id, reference, o);
    if (!valid(b)) throw conflict(b.status === 'confirmed' ? 'This booking has already ended' : `This booking is ${b.status}, so it is not valid for entry`, 'not_valid');
    if (b.checked_in_at) return void res.json({ checkedIn: true, alreadyCheckedIn: true, at: b.checked_in_at, booking: { ...b, id: undefined } });
    const at = ctx.now().toISOString();
    await ctx.db.query('UPDATE bookings SET checked_in_at=$2, checked_in_by=$3 WHERE id=$1 AND checked_in_at IS NULL', [b.id, at, req.user!.id]);
    await audit(ctx.db, req, 'booking.check_in', 'booking', b.id, { reference: b.reference });
    res.json({ checkedIn: true, alreadyCheckedIn: false, at, booking: { ...b, id: undefined, checked_in_at: at } });
  });
  // ---- read-only and counter views, each behind its own permission
  r.get('/bookings', async (req, res) => {
    const o = await ownerOf(req); need(o, 'BOOKING_VIEW');
    const { rows } = await ctx.db.query(
      `SELECT b.id, b.reference, b.status, lower(b.during) AS starts_at, upper(b.during) AS ends_at, b.checked_in_at, v.name AS venue_name, a.name AS area_name, COALESCE(u.full_name, b.walkin_name) AS customer_name
         FROM bookings b JOIN venues v ON v.id=b.venue_id JOIN playing_areas a ON a.id=b.area_id LEFT JOIN users u ON u.id=b.customer_id
        WHERE v.owner_id=$1${only(o)} AND b.block_kind IS NULL AND b.status IN ('confirmed','completed','cancelled') AND upper(b.during) > now() - interval '7 days'
        ORDER BY lower(b.during) LIMIT 200`, [o.owner_id]);
    res.json({ bookings: rows });
  });
  r.get('/venues', async (req, res) => {
    const o = await ownerOf(req); need(o, 'VENUE_VIEW', 'PLAYING_AREA_VIEW');
    const areas = o.permissions.includes('PLAYING_AREA_VIEW');
    const { rows } = await ctx.db.query(
      `SELECT v.id, v.name, v.address, v.city, v.status, ${areas ? `(SELECT COALESCE(json_agg(json_build_object('id', a.id, 'name', a.name, 'surface', a.surface, 'capacity', a.capacity, 'slotMinutes', a.slot_minutes, 'isActive', a.is_active) ORDER BY a.name), '[]') FROM playing_areas a WHERE a.venue_id=v.id)` : `'[]'::json`} AS areas
         FROM venues v WHERE v.owner_id=$1${only(o)} ORDER BY v.name`, [o.owner_id]);
    res.json({ venues: rows });
  });
  r.get('/dashboard', async (req, res) => {
    const o = await ownerOf(req); need(o, 'DASHBOARD_VIEW');
    const c = (await ctx.db.query(
      `SELECT count(*) FILTER (WHERE (lower(b.during) AT TIME ZONE v.timezone)::date = (now() AT TIME ZONE v.timezone)::date AND b.status IN ('confirmed','completed'))::int AS today,
              count(*) FILTER (WHERE b.status='confirmed' AND upper(b.during) > now())::int AS upcoming,
              count(*) FILTER (WHERE b.checked_in_at IS NOT NULL AND (b.checked_in_at AT TIME ZONE v.timezone)::date = (now() AT TIME ZONE v.timezone)::date)::int AS checked_in_today
         FROM bookings b JOIN venues v ON v.id=b.venue_id WHERE v.owner_id=$1${only(o)} AND b.block_kind IS NULL`, [o.owner_id])).rows[0];
    const n = (await ctx.db.query(`SELECT (SELECT count(*)::int FROM venues v WHERE v.owner_id=$1${only(o)}) AS venues, (SELECT count(*)::int FROM playing_areas a JOIN venues v ON v.id=a.venue_id WHERE v.owner_id=$1${only(o)}) AS areas`, [o.owner_id])).rows[0];
    res.json({ ...c, ...n });
  });
  r.get('/pricing', async (req, res) => {
    const o = await ownerOf(req); need(o, 'PRICING_VIEW');
    const { rows } = await ctx.db.query(
      `SELECT v.name AS venue_name, a.name AS area_name, COALESCE(s.name, 'All sports') AS sport, pr.day_type, pr.day_of_week, pr.start_time::text, pr.end_time::text, pr.price_per_hour::float8 AS price_per_hour
         FROM pricing_rules pr JOIN playing_areas a ON a.id=pr.area_id JOIN venues v ON v.id=a.venue_id LEFT JOIN sports s ON s.id=pr.sport_id WHERE v.owner_id=$1${only(o)} ORDER BY v.name, a.name, s.name, pr.start_time`, [o.owner_id]);
    res.json({ prices: rows });
  });
  /** What the counter needs to book a walk-in: live venues, their areas and sports. */
  r.get('/booking-options', async (req, res) => {
    const o = await ownerOf(req); need(o, 'BOOKING_CREATE');
    const { rows } = await ctx.db.query(
      `SELECT v.id, v.name, v.timezone,
              (SELECT COALESCE(json_agg(json_build_object('id', a.id, 'name', a.name, 'slotMinutes', a.slot_minutes, 'minDuration', a.min_duration_minutes, 'maxDuration', a.max_duration_minutes,
                  'sports', (SELECT COALESCE(json_agg(json_build_object('id', sp.id, 'name', sp.name) ORDER BY sp.sort_order, sp.name), '[]') FROM playing_area_sports s JOIN sports sp ON sp.id=s.sport_id WHERE s.playing_area_id=a.id)) ORDER BY a.name), '[]')
                 FROM playing_areas a WHERE a.venue_id=v.id AND a.is_active) AS areas
         FROM venues v WHERE v.owner_id=$1${only(o)} AND v.status='approved' ORDER BY v.name`, [o.owner_id]);
    res.json({ venues: rows });
  });
  r.get('/calendar', async (req, res) => {
    const o = await ownerOf(req); need(o, 'CALENDAR_VIEW');
    const { date } = parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }), req.query);
    const { rows } = await ctx.db.query(
      `SELECT b.id, b.status, b.block_kind, b.reference, lower(b.during) AS starts_at, upper(b.during) AS ends_at, v.name AS venue_name, a.name AS area_name, COALESCE(u.full_name, b.walkin_name) AS customer_name, b.event_title
         FROM bookings b JOIN venues v ON v.id=b.venue_id JOIN playing_areas a ON a.id=b.area_id LEFT JOIN users u ON u.id=b.customer_id
        WHERE v.owner_id=$1${only(o)} AND b.status IN ('confirmed','completed','blocked') AND (lower(b.during) AT TIME ZONE v.timezone)::date = $2::date ORDER BY v.name, a.name, lower(b.during)`, [o.owner_id, date]);
    res.json({ date, items: rows });
  });
  r.get('/reports', async (req, res) => {
    const o = await ownerOf(req); need(o, 'REPORTS_VIEW');
    const { rows } = await ctx.db.query(
      `SELECT v.name AS venue_name, count(*) FILTER (WHERE b.status IN ('confirmed','completed'))::int AS bookings, count(*) FILTER (WHERE b.status='cancelled')::int AS cancelled,
              COALESCE(sum(b.total) FILTER (WHERE b.status IN ('confirmed','completed')), 0)::float8 AS revenue
         FROM bookings b JOIN venues v ON v.id=b.venue_id WHERE v.owner_id=$1${only(o)} AND b.block_kind IS NULL AND lower(b.during) >= now() - interval '30 days' AND lower(b.during) < now() + interval '1 day'
        GROUP BY v.name ORDER BY v.name`, [o.owner_id]);
    res.json({ days: 30, venues: rows, totals: { bookings: rows.reduce((n: number, x: any) => n + x.bookings, 0), cancelled: rows.reduce((n: number, x: any) => n + x.cancelled, 0), revenue: rows.reduce((n: number, x: any) => n + x.revenue, 0) } });
  });
  r.post('/bookings/offline', async (req, res) => {
    const o = await ownerOf(req); need(o, 'BOOKING_CREATE');
    const b = parse(z.object({
      areaId: z.uuid(), sportId: z.number().int().positive(), startsAt: z.iso.datetime({ offset: true }), durationMinutes: z.number().int().min(30).max(720),
      customerName: z.string().trim().min(2).max(100), customerPhone: z.string().regex(INDIAN_MOBILE, INDIAN_MOBILE_MESSAGE), paymentMethod: z.enum(['cash', 'upi', 'card', 'unpaid']).default('cash'),
    }), req.body);
    if (o.venue_ids) { const a = (await ctx.db.query('SELECT venue_id FROM playing_areas WHERE id=$1', [b.areaId])).rows[0]; if (!a || !o.venue_ids.includes(a.venue_id)) throw forbidden('You do not work in this venue'); }
    const out = await createOfflineBooking(ctx, { ...req.user!, id: o.owner_id, role: 'owner' } as any, { ...b, customerPhone: normalizePhone(b.customerPhone) });
    await audit(ctx.db, req, 'booking.offline_created_by_staff', 'booking', out.bookingId, { reference: out.reference });
    res.status(201).json(out);
  });
  return r;
}
