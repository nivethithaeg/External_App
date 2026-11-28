import { GOOGLE_MAP_LINK, coordsFromShortLink, coordsFromMapUrl } from '../lib/mapLink.js';
import { Router } from 'express';
import { z } from 'zod';
import type { Ctx } from '../types.js';
import { authenticate, requireActiveOwner, requireRole } from '../middleware/auth.js';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../errors.js';
import { csv, page, parse } from '../lib/http.js';
import { checkedFile, upload } from '../lib/upload.js';
import { audit } from '../lib/audit.js';
import { cancelBooking, createOfflineBooking } from '../lib/bookings.js';
import { normalizePhone, INDIAN_MOBILE, INDIAN_MOBILE_MESSAGE } from '../lib/phone.js';
import { loadAreaContext, quote } from '../lib/slots.js';
import { BOOKING_SELECT } from './bookings.js';
import { maskUrl, sendStoredFile } from '../lib/private-file.js';
import { BANK_COLUMNS, FIELD_LABEL, SENSITIVE_FIELDS, publicOwnerProfile } from '../lib/ownerProfile.js';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { distanceMeters } from '../lib/geo.js';
import { reverseGeocode } from '../lib/geocode.js';
import { holdHours, releaseOf } from '../lib/escrow.js';
import { venueScore } from '../lib/venueQuality.js';

const phoneField = z.union([z.string().regex(INDIAN_MOBILE, INDIAN_MOBILE_MESSAGE), z.literal('')]).nullable().optional(); // '' or null clears the number
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:00)?$/, 'Use HH:MM');
const venueSchema = z.object({
  name: z.string().trim().min(2).max(150), description: z.string().trim().max(3000).optional(),
  address: z.string().trim().min(5).max(300), city: z.string().trim().min(2).max(80), state: z.string().trim().max(80).optional(),
  pincode: z.string().trim().regex(/^[1-9][0-9]{5}$/, 'Enter a valid 6-digit PIN code'), lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional(),
  contactPhone: phoneField, contactPhone2: phoneField, cancellationHours: z.number().int().min(0).max(168).default(24),
  timezone: z.string().max(60).default('Asia/Kolkata'),
  category: z.string().trim().max(60).optional(), locality: z.string().trim().max(100).optional(),
  contactEmail: z.email().max(254).optional(), country: z.string().trim().max(60).default('India'),
  addressLine2: z.string().trim().max(200).optional(),
  // a link copied from Google Maps (Share > Copy link)
  mapUrl: z.union([z.string().trim().max(500).regex(GOOGLE_MAP_LINK, 'Paste a Google Maps link, e.g. https://maps.app.goo.gl/…'), z.literal('')]).optional(),
});

export function ownerRoutes(ctx: Ctx) {
  const r = Router();
  r.use(authenticate(ctx), requireRole('owner'), requireActiveOwner(ctx, ['/application', '/activity', '/account/close', '/account/close-info']));
  const uid = (req: any) => req.user!.id as string;

  async function ownVenue(venueId: string, ownerId: string) {
    const v = (await ctx.db.query('SELECT * FROM venues WHERE id=$1', [venueId])).rows[0];
    if (!v) throw notFound('Venue not found');
    if (v.owner_id !== ownerId) throw forbidden();
    return v;
  }
  // Venue detail fields: request key -> column. Edits to an approved venue are held for review instead of going live.
  const FIELD_COLS: Record<string, string> = { name: 'name', description: 'description', address: 'address', city: 'city', state: 'state', pincode: 'pincode', lat: 'lat', lng: 'lng',
    cancellationHours: 'cancellation_hours', category: 'category', locality: 'locality', contactEmail: 'contact_email', country: 'country', addressLine2: 'address_line2', mapUrl: 'map_url' };
  const same = (a: unknown, b: unknown) => (typeof a === 'number' || typeof b === 'number' ? Number(a) === Number(b) : (a ?? null) === (b ?? null));
  const isLiveVenue = (v: { status: string }) => v.status === 'approved' || v.status === 'ready';
  const hasWaiting = async (venueId: string) => !!(await ctx.db.query(
    `SELECT 1 WHERE EXISTS (SELECT 1 FROM listing_change_requests WHERE venue_id=$1) OR EXISTS (SELECT 1 FROM venue_images WHERE venue_id=$1 AND (is_pending OR delete_requested))
       OR EXISTS (SELECT 1 FROM venue_documents WHERE venue_id=$1 AND status='pending')`, [venueId])).rows[0];
  async function alertAdminsOfChange(v: any, ownerName: string, what: string) {
    await ctx.notifier.notifyAdmins('venues', { title: 'Venue changes awaiting approval', body: `${ownerName} changed ${what} of "${v.name}". Review the changes before customers see them.`, type: 'admin_venue_changes', email: true, data: { link: '/admin/venues?status=changes' } });
  }
  async function holdChange(v: any, ownerName: string, patch: { fields?: Record<string, unknown>; facilityIds?: number[] }) {
    const waitingBefore = await hasWaiting(v.id);
    const liveCover = (await ctx.db.query(`SELECT id FROM venue_images WHERE venue_id=$1 AND is_cover AND NOT is_pending LIMIT 1`, [v.id])).rows[0]?.id ?? null;
    v = { ...v, cover_image_id: liveCover };
    const cur = (await ctx.db.query('SELECT fields, facility_ids FROM listing_change_requests WHERE venue_id=$1', [v.id])).rows[0];
    const fields: Record<string, unknown> = { ...(cur?.fields ?? {}), ...(patch.fields ?? {}) };
    for (const [col, val] of Object.entries(fields)) if (same(val, v[col])) delete fields[col]; // changed back to what is live: nothing to review
    let facilityIds: number[] | null = patch.facilityIds ?? cur?.facility_ids ?? null;
    if (facilityIds) {
      const live = (await ctx.db.query('SELECT facility_id FROM venue_facilities WHERE venue_id=$1', [v.id])).rows.map((r: any) => r.facility_id).sort((x: number, y: number) => x - y);
      const want = [...facilityIds].sort((x, y) => x - y);
      if (live.length === want.length && live.every((x: number, i: number) => x === want[i])) facilityIds = null;
    }
    if (!Object.keys(fields).length && !facilityIds) { await ctx.db.query('DELETE FROM listing_change_requests WHERE venue_id=$1', [v.id]); return false; }
    await ctx.db.query(`INSERT INTO listing_change_requests (venue_id, fields, facility_ids) VALUES ($1,$2::jsonb,$3)
      ON CONFLICT (venue_id) DO UPDATE SET fields=$2::jsonb, facility_ids=$3, updated_at=now()`, [v.id, JSON.stringify(fields), facilityIds]);
    if (!waitingBefore) await alertAdminsOfChange(v, ownerName, 'details');
    return true;
  }
  const LOCKED = 'This venue is under approval and cannot be changed until PlaynX reviews it';
  /** Details are frozen while the venue waits for admin approval. */
  const unlocked = (v: { status: string }) => { if (v.status === 'pending') throw conflict(LOCKED, 'venue_locked'); };
  async function ownArea(areaId: string, ownerId: string) {
    const a = (await ctx.db.query('SELECT a.*, v.owner_id, v.timezone, v.status AS venue_status FROM playing_areas a JOIN venues v ON v.id=a.venue_id WHERE a.id=$1', [areaId])).rows[0];
    if (!a) throw notFound('Playing area not found');
    if (a.owner_id !== ownerId) throw forbidden();
    return a;
  }

  // ---------------- owner profile / verification
  r.put('/profile', async (req, res) => {
    const b = parse(z.object({
      businessName: z.string().trim().min(2).max(150).optional(), gstin: z.string().trim().max(20).optional(), pan: z.string().trim().max(15).optional(),
      address: z.string().trim().max(300).optional(), bankAccountName: z.string().trim().max(120).optional(),
      bankAccountNumber: z.string().regex(/^\d{6,20}$/).optional(), bankIfsc: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/).optional(), upiId: z.string().max(80).optional(),
    }), req.body);
    let cur = (await ctx.db.query('SELECT * FROM owner_profiles WHERE user_id=$1', [uid(req)])).rows[0];
    // The first bank account is saved at once (the portal stays closed until it exists); finance verifies it before any payout. Later changes wait for approval.
    if (!cur.bank_account_number && b.bankAccountName && b.bankAccountNumber && b.bankIfsc) {
      await ctx.db.query(`UPDATE owner_profiles SET bank_account_name=$2, bank_account_number=$3, bank_ifsc=$4, upi_id=COALESCE($5, upi_id), bank_verified=false WHERE user_id=$1`, [uid(req), b.bankAccountName, b.bankAccountNumber, b.bankIfsc, b.upiId ?? null]);
      await audit(ctx.db, req, 'owner.bank_added', 'user', uid(req), {});
      await ctx.notifier.notifyAdmins('payouts', { title: 'New owner bank details to verify', body: `${req.user!.fullName} added a payout bank account. Verify it before any payout.`, type: 'admin_alert', data: { link: '/admin/owners' } });
      cur = (await ctx.db.query('SELECT * FROM owner_profiles WHERE user_id=$1', [uid(req)])).rows[0];
    }
    // Only approved owners reach this endpoint (the router guard), and their changes do not go live. They wait for an admin, and customers and payouts keep using the approved details until then.
    const proposed: Record<string, string> = {};
    for (const [key, col] of Object.entries(SENSITIVE_FIELDS)) { const v = (b as any)[key]; if (v !== undefined && v !== cur[col]) proposed[col] = v; }
    const pending = (await ctx.db.query(`SELECT id, changes AS fields FROM owner_profile_change_requests WHERE owner_id=$1 AND status='pending'`, [uid(req)])).rows[0];
    if (!Object.keys(proposed).length) return res.json({ pending: !!pending, profile: publicOwnerProfile(cur) });
    const merged = { ...(pending?.fields ?? {}), ...proposed };
    for (const col of Object.keys(merged)) if (merged[col] === cur[col]) delete merged[col]; // edited back to the live value: nothing to approve for that field
    if (!Object.keys(merged).length) { if (pending) await ctx.db.query(`UPDATE owner_profile_change_requests SET status='withdrawn', updated_at=now() WHERE id=$1`, [pending.id]); return res.json({ pending: false, profile: publicOwnerProfile(cur) }); }
    const ch = (await ctx.db.query(
      `INSERT INTO owner_profile_change_requests (owner_id, changes) VALUES ($1,$2::jsonb)
         ON CONFLICT (owner_id) WHERE status='pending' DO UPDATE SET changes=EXCLUDED.changes, updated_at=now(), created_at=now() RETURNING id, created_at AS requested_at`, [uid(req), JSON.stringify(merged)])).rows[0];
    await audit(ctx.db, req, 'owner_profile.change_requested', 'user', uid(req), { fields: Object.keys(merged) });
    await ctx.notifier.notifyAdmins('users', { title: 'Owner profile changes awaiting approval', body: `${req.user!.fullName} changed ${Object.keys(merged).map((c) => FIELD_LABEL[c]).join(', ')}. The old details stay live until you approve.`, type: 'admin_profile_change', email: true, data: { link: '/admin/profile-changes' } });
    if (Object.keys(merged).some((c) => BANK_COLUMNS.includes(c))) await ctx.notifier.notifyAdmins('payouts', { title: 'Owner bank details change requested', body: `${req.user!.fullName} asked to change payout details. It needs approval before it takes effect.`, type: 'admin_bank_changed', email: true, data: { link: '/admin/profile-changes' } });
    return res.status(202).json({ pending: true, requestId: ch.id, fields: Object.keys(merged).map((c) => FIELD_LABEL[c]), profile: publicOwnerProfile(cur) });
  });

  /** The owner takes back a request that is still waiting. */
  r.delete('/profile/change', async (req, res) => {
    const { rows } = await ctx.db.query(`UPDATE owner_profile_change_requests SET status='withdrawn', updated_at=now() WHERE owner_id=$1 AND status='pending' RETURNING id`, [uid(req)]);
    if (!rows[0]) throw notFound('There is no pending request');
    await audit(ctx.db, req, 'owner_profile.change_withdrawn', 'user', uid(req));
    res.status(204).end();
  });

  // ---------------- dashboard
  r.get('/dashboard', async (req, res) => {
    const id = uid(req);
    const live = `b.status IN ('confirmed','completed')`;
    const [today, month, upcoming, completed, venues, trend] = await Promise.all([
      ctx.db.query(`SELECT count(*)::int AS bookings, COALESCE(sum(b.owner_amount),0)::float8 AS earnings FROM bookings b JOIN venues v ON v.id=b.venue_id
        WHERE v.owner_id=$1 AND ${live} AND lower(b.during) >= date_trunc('day', now()) AND lower(b.during) < date_trunc('day', now()) + interval '1 day'`, [id]),
      ctx.db.query(`SELECT count(*)::int AS bookings, COALESCE(sum(b.owner_amount),0)::float8 AS earnings FROM bookings b JOIN venues v ON v.id=b.venue_id
        WHERE v.owner_id=$1 AND ${live} AND lower(b.during) >= date_trunc('month', now())`, [id]),
      ctx.db.query(`SELECT count(*)::int AS n FROM bookings b JOIN venues v ON v.id=b.venue_id WHERE v.owner_id=$1 AND b.status='confirmed' AND upper(b.during) > now()`, [id]),
      ctx.db.query(`SELECT COALESCE(sum(b.owner_amount),0)::float8 AS n FROM bookings b JOIN venues v ON v.id=b.venue_id WHERE v.owner_id=$1 AND b.status='completed'`, [id]),
      ctx.db.query(`SELECT status, count(*)::int AS n FROM venues WHERE owner_id=$1 GROUP BY status`, [id]),
      ctx.db.query(`SELECT to_char(d, 'YYYY-MM-DD') AS day, COALESCE(sum(b.owner_amount),0)::float8 AS earnings, count(b.id)::int AS bookings
        FROM generate_series(date_trunc('day', now()) - interval '13 days', date_trunc('day', now()), interval '1 day') d
        LEFT JOIN (SELECT b.* FROM bookings b JOIN venues v ON v.id=b.venue_id WHERE v.owner_id=$1 AND ${live}) b ON date_trunc('day', lower(b.during)) = d
        GROUP BY d ORDER BY d`, [id]),
    ]);
    const paid = (await ctx.db.query(`SELECT COALESCE(sum(amount),0)::float8 AS n FROM owner_payouts WHERE owner_id=$1 AND status<>'failed'`, [id])).rows[0].n;
    const prof = (await ctx.db.query('SELECT verification_status, (SELECT account_code FROM users WHERE id=$1) AS owner_code FROM owner_profiles WHERE user_id=$1', [id])).rows[0];
    res.json({
      verification: prof.verification_status, ownerCode: prof.owner_code ?? null, today: today.rows[0], month: month.rows[0], upcomingBookings: upcoming.rows[0].n,
      payableBalance: Math.max(0, completed.rows[0].n - paid), venuesByStatus: venues.rows, trend: trend.rows,
    });
  });

  // ---------------- venues
  r.get('/venues', async (req, res) => {
    const { rows } = await ctx.db.query(
      `SELECT v.*, (SELECT count(*)::int FROM playing_areas a WHERE a.venue_id=v.id) AS area_count,
         (SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object('id', sp.id, 'name', sp.name)), '[]'::jsonb) FROM playing_areas a JOIN playing_area_sports s ON s.playing_area_id=a.id JOIN sports sp ON sp.id=s.sport_id WHERE a.venue_id=v.id) AS sports,
         (SELECT url FROM venue_images i WHERE i.venue_id=v.id AND i.area_id IS NULL AND i.kind='image' ORDER BY i.is_cover DESC, i.sort_order LIMIT 1) AS cover_image,
         (SELECT COALESCE(json_agg(x.url), '[]'::json) FROM (SELECT url FROM venue_images i WHERE i.venue_id=v.id AND i.area_id IS NULL AND i.kind='image' AND NOT i.is_pending AND NOT i.delete_requested ORDER BY i.is_cover DESC, i.sort_order LIMIT 8) x) AS photos
       FROM venues v WHERE v.owner_id=$1 ORDER BY v.created_at DESC`, [uid(req)]);
    res.json({ venues: rows });
  });

  r.get('/venues/:id', async (req, res) => {
    const v = await ownVenue(parse(z.uuid(), req.params.id), uid(req));
    const [images, facilities, areas, docs] = await Promise.all([
      ctx.db.query('SELECT id, url, kind, is_cover, sort_order, is_pending, delete_requested, area_id, geo_lat, geo_lng, geo_distance_m, geo_address FROM venue_images WHERE venue_id=$1 ORDER BY is_cover DESC, sort_order', [v.id]),
      ctx.db.query('SELECT facility_id FROM venue_facilities WHERE venue_id=$1', [v.id]),
      ctx.db.query(
        `SELECT a.*, (SELECT COALESCE(json_agg(s.sport_id ORDER BY (SELECT sort_order FROM sports WHERE id=s.sport_id), s.sport_id), '[]') FROM playing_area_sports s WHERE s.playing_area_id=a.id) AS sport_ids,
           (SELECT COALESCE(json_agg(json_build_object('id', p.id, 'sportId', p.sport_id, 'dayType', p.day_type, 'dayOfWeek', p.day_of_week, 'startTime', to_char(p.start_time,'HH24:MI'), 'endTime', to_char(p.end_time,'HH24:MI'), 'pricePerHour', p.price_per_hour) ORDER BY p.start_time), '[]') FROM pricing_rules p WHERE p.area_id=a.id) AS pricing,
           (SELECT COALESCE(json_agg(json_build_object('dayOfWeek', d.day_of_week, 'openTime', to_char(d.open_time,'HH24:MI'), 'closeTime', to_char(d.close_time,'HH24:MI'), 'isClosed', d.is_closed) ORDER BY d.day_of_week), '[]') FROM playing_area_hours d WHERE d.playing_area_id=a.id) AS availability,
           (SELECT COALESCE(json_agg(json_build_object('date', e.exception_date::text, 'closed', e.closed, 'openTime', to_char(e.open_time,'HH24:MI'), 'closeTime', to_char(e.close_time,'HH24:MI'), 'reason', e.reason) ORDER BY e.exception_date), '[]') FROM playing_area_hour_exceptions e WHERE e.playing_area_id=a.id AND e.exception_date >= current_date) AS hour_exceptions
         FROM playing_areas a WHERE a.venue_id=$1 ORDER BY a.name`, [v.id]),
      ctx.db.query(`SELECT id, doc_type, ${maskUrl} AS url, status, note, created_at FROM venue_documents WHERE venue_id=$1 ORDER BY created_at DESC`, [v.id]),
    ]);
    const ch = (await ctx.db.query('SELECT fields, facility_ids, updated_at FROM listing_change_requests WHERE venue_id=$1', [v.id])).rows[0];
    // The owner sees their own pending edits in the form; customers still see the approved values.
    const wantCover = ch?.fields?.cover_image_id as string | undefined;
    const { cover_image_id: _c, ...ownFields } = (ch?.fields ?? {}) as Record<string, unknown>;
    const sportIds = (await ctx.db.query('SELECT vs.sport_id FROM venue_sports vs JOIN sports sp ON sp.id=vs.sport_id WHERE vs.venue_id=$1 ORDER BY sp.sort_order, sp.name', [v.id])).rows.map((r: any) => r.sport_id);
    res.json({ venue: { ...v, ...ownFields, sportIds, images: wantCover ? images.rows.map((i: any) => ({ ...i, is_cover: i.id === wantCover })) : images.rows, facilityIds: ch?.facility_ids ?? facilities.rows.map((f: any) => f.facility_id), areas: areas.rows, documents: docs.rows, pendingChange: ch ? { fields: ch.fields, facilityIds: ch.facility_ids, updatedAt: ch.updated_at } : null } });
  });

  r.post('/venues', async (req, res) => {
    const b = parse(venueSchema, req.body);
    const v = await ctx.db.tx(async (q) => {
      const v = (await q.query(
        `INSERT INTO venues (owner_id, name, description, address, city, state, pincode, lat, lng, contact_phone, contact_phone2, cancellation_hours, timezone, category, locality, contact_email, country, address_line2, map_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
        [uid(req), b.name, b.description ?? null, b.address, b.city, b.state ?? null, b.pincode ?? null, b.lat ?? null, b.lng ?? null, b.contactPhone || null, b.contactPhone2 || null, b.cancellationHours, b.timezone, b.category ?? null, b.locality ?? null, b.contactEmail ?? null, b.country, b.addressLine2 || null, b.mapUrl || null])).rows[0];
      await audit(q, req, 'venue.create', 'venue', v.id);
      return v;
    });
    await ctx.notifier.notifyAdmins('venues', { title: 'New venue created', body: `${req.user!.fullName} created "${v.name}" in ${v.city} (draft).`, type: 'admin_venue_created', data: { link: '/admin/venues?status=draft' } });
    res.status(201).json({ venue: v });
  });

  /** Contact numbers are the owner's own business and change straight away: no approval, even on an approved venue. */
  const CONTACT_COLS = { contactPhone: 'contact_phone', contactPhone2: 'contact_phone2' } as const;
  /** A venue-wide discount for customers. It is the owner's own pricing choice, so it takes effect at once (no approval). */
  r.put('/venues/:id/discount', async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    const b = parse(z.object({ percent: z.number().int().min(0).max(90) }), req.body);
    const { rows } = await ctx.db.query('UPDATE venues SET discount_percent=$3 WHERE id=$1 AND owner_id=$2 RETURNING id, name, discount_percent', [id, uid(req), b.percent]);
    if (!rows[0]) throw notFound('Venue not found');
    await audit(ctx.db, req, 'venue.discount', 'venue', id, { percent: b.percent });
    res.json({ discountPercent: rows[0].discount_percent });
  });

  /** The owner's own venue score, with exactly how it is worked out and what would raise it. */
  r.get('/venues/:id/score', async (req, res) => {
    const id = parse(z.uuid(), req.params.id); await ownVenue(id, uid(req));
    res.json(await venueScore(ctx.db, id, ctx.now()));
  });

  // ---- holiday and special-date pricing: every slot on those dates costs a percentage more or less. Effective at once, like the discount.

  r.get('/venues/:id/price-adjustments', async (req, res) => {
    const id = parse(z.uuid(), req.params.id); await ownVenue(id, uid(req));
    res.json({ adjustments: (await ctx.db.query(`SELECT id, label, start_date::text, end_date::text, percent FROM price_adjustments WHERE venue_id=$1 AND end_date >= current_date ORDER BY start_date`, [id])).rows });
  });
  r.post('/venues/:id/price-adjustments', async (req, res) => {
    const id = parse(z.uuid(), req.params.id); await ownVenue(id, uid(req));
    const b = parse(z.object({ label: z.string().trim().min(2).max(60), startDate: z.iso.date(), endDate: z.iso.date(), percent: z.number().int().min(-50).max(200).refine((n) => n !== 0, 'Enter a percentage other than 0') }), req.body);
    if (b.endDate < b.startDate) throw badRequest('The end date cannot be before the start date');
    if ((new Date(b.endDate).getTime() - new Date(b.startDate).getTime()) / 86400000 > 30) throw badRequest('A special-date period can be at most 31 days');
    const clash = await ctx.db.query(`SELECT label FROM price_adjustments WHERE venue_id=$1 AND start_date <= $3::date AND end_date >= $2::date LIMIT 1`, [id, b.startDate, b.endDate]);
    if (clash.rows[0]) throw conflict(`These dates overlap "${clash.rows[0].label}". Change or remove it first.`, 'overlap');
    const { rows } = await ctx.db.query(`INSERT INTO price_adjustments (venue_id, label, start_date, end_date, percent) VALUES ($1,$2,$3,$4,$5) RETURNING id, label, start_date::text, end_date::text, percent`, [id, b.label, b.startDate, b.endDate, b.percent]);
    await audit(ctx.db, req, 'venue.price_adjustment', 'venue', id, { label: b.label, from: b.startDate, to: b.endDate, percent: b.percent });
    res.status(201).json({ adjustment: rows[0] });
  });
  r.delete('/venues/:id/price-adjustments/:adjId', async (req, res) => {
    const id = parse(z.uuid(), req.params.id); await ownVenue(id, uid(req));
    const { rowCount } = await ctx.db.query('DELETE FROM price_adjustments WHERE id=$1 AND venue_id=$2', [parse(z.uuid(), req.params.adjId), id]);
    if (!rowCount) throw notFound('Special date not found');
    await audit(ctx.db, req, 'venue.price_adjustment_removed', 'venue', id, { id: req.params.adjId });
    res.status(204).end();
  });

  r.put('/venues/:id', async (req, res) => {
    const v = await ownVenue(parse(z.uuid(), req.params.id), uid(req));
    const { contactPhone, contactPhone2, ...b } = parse(venueSchema.partial(), req.body);
    const contact: Record<string, string | null> = {};
    for (const [k, col] of Object.entries(CONTACT_COLS)) { const val = ({ contactPhone, contactPhone2 } as Record<string, string | null | undefined>)[k]; if (val !== undefined) contact[col] = val || null; }
    let current = v;
    if (Object.keys(contact).length) {
      const next = { contact_phone: v.contact_phone ?? null, contact_phone2: v.contact_phone2 ?? null, ...contact };
      if (next.contact_phone && next.contact_phone === next.contact_phone2) throw badRequest('The second number must be different from the first.', 'duplicate_phone');
      const cols = Object.keys(contact);
      current = (await ctx.db.query(`UPDATE venues SET ${cols.map((c, i) => `${c}=$${i + 2}`).join(', ')}, updated_at=now() WHERE id=$1 RETURNING *`, [v.id, ...cols.map((c) => contact[c])])).rows[0];
      // An older change that was waiting for approval must not bring the old number back when it is approved later.
      await ctx.db.query(`UPDATE listing_change_requests SET fields = fields - 'contact_phone' - 'contact_phone2' WHERE venue_id=$1`, [v.id]);
      await ctx.db.query(`DELETE FROM listing_change_requests WHERE venue_id=$1 AND fields = '{}'::jsonb AND facility_ids IS NULL`, [v.id]);
      await audit(ctx.db, req, 'venue.contact_updated', 'venue', v.id, { fields: cols });
    }
    if (!Object.keys(req.body ?? {}).some((k) => !(k in CONTACT_COLS))) return void res.json({ venue: current, contactUpdated: Object.keys(contact).length > 0, pendingChange: await hasWaiting(v.id) }); // only contact numbers were changed
    unlocked(v);
    if (isLiveVenue(v)) { // approved: the other changes wait for PlaynX; customers keep seeing the approved version
      const fields: Record<string, unknown> = {};
      for (const [k, col] of Object.entries(FIELD_COLS)) { const val = (b as any)[k]; if (val !== undefined) fields[col] = val; } // holdChange drops the ones equal to the live value
      const pending = await holdChange(current, req.user!.fullName, { fields });
      await audit(ctx.db, req, 'venue.change_requested', 'venue', v.id);
      return void res.json({ venue: current, contactUpdated: Object.keys(contact).length > 0, pendingChange: pending });
    }
    const { rows } = await ctx.db.query(
      `UPDATE venues SET name=COALESCE($2,name), description=COALESCE($3,description), address=COALESCE($4,address), city=COALESCE($5,city), state=COALESCE($6,state),
         pincode=COALESCE($7,pincode), lat=COALESCE($8,lat), lng=COALESCE($9,lng),
         cancellation_hours=COALESCE($10,cancellation_hours), category=COALESCE($11,category), locality=COALESCE($12,locality), contact_email=COALESCE($13,contact_email), country=COALESCE($14,country), address_line2=COALESCE($15,address_line2), map_url=COALESCE($16,map_url), updated_at=now(),
         status = CASE WHEN status='rejected' THEN 'draft' ELSE status END
       WHERE id=$1 RETURNING *`,
      [v.id, b.name ?? null, b.description ?? null, b.address ?? null, b.city ?? null, b.state ?? null, b.pincode ?? null, b.lat ?? null, b.lng ?? null, b.cancellationHours ?? null, b.category ?? null, b.locality ?? null, b.contactEmail ?? null, b.country ?? null, b.addressLine2 ?? null, b.mapUrl ?? null]);
    res.json({ venue: rows[0], contactUpdated: Object.keys(contact).length > 0 });
  });

  r.put('/venues/:id/facilities', async (req, res) => {
    const v = await ownVenue(parse(z.uuid(), req.params.id), uid(req));
    unlocked(v);
    const { facilityIds } = parse(z.object({ facilityIds: z.array(z.number().int().positive()).max(50) }), req.body);
    if (isLiveVenue(v)) { await holdChange(v, req.user!.fullName, { facilityIds }); return void res.status(204).end(); }
    await ctx.db.tx(async (q) => {
      await q.query('DELETE FROM venue_facilities WHERE venue_id=$1', [v.id]);
      if (facilityIds.length) await q.query(`INSERT INTO venue_facilities (venue_id, facility_id) SELECT $1, f.id FROM facilities f WHERE f.id = ANY($2)`, [v.id, facilityIds]);
    });
    res.status(204).end();
  });

  /** The sports this venue offers. Playing areas then pick from this list. A sport an area still uses cannot be removed. */
  r.put('/venues/:id/sports', async (req, res) => {
    const v = await ownVenue(parse(z.uuid(), req.params.id), uid(req));
    unlocked(v);
    const { sportIds } = parse(z.object({ sportIds: z.array(z.number().int().positive()).min(1, 'Select at least one sport').max(30) }), req.body);
    const ok = (await ctx.db.query('SELECT id FROM sports WHERE id = ANY($1) AND is_active', [sportIds])).rows.map((r: any) => r.id);
    if (ok.length !== new Set(sportIds).size) throw badRequest('One or more of those sports is not available', 'bad_sport');
    const inUse = (await ctx.db.query(`SELECT DISTINCT sp.name FROM playing_area_sports x JOIN playing_areas a ON a.id=x.playing_area_id JOIN sports sp ON sp.id=x.sport_id WHERE a.venue_id=$1 AND NOT (x.sport_id = ANY($2))`, [v.id, sportIds])).rows.map((r: any) => r.name);
    if (inUse.length) throw conflict(`${inUse.join(', ')} ${inUse.length === 1 ? 'is' : 'are'} still offered by a playing area. Remove it from that area first.`, 'sport_in_use');
    await ctx.db.tx(async (q) => {
      await q.query('DELETE FROM venue_sports WHERE venue_id=$1', [v.id]);
      await q.query('INSERT INTO venue_sports (venue_id, sport_id) SELECT $1, s.id FROM sports s WHERE s.id = ANY($2)', [v.id, sportIds]);
    });
    await audit(ctx.db, req, 'venue.sports_set', 'venue', v.id, { sportIds });
    res.json({ sportIds });
  });

  // Publishing sends the venue to PlaynX for approval. It stays under approval (hidden from customers) until an admin approves it.
  r.post('/venues/:id/send-for-approval', async (req, res) => {
    const v = await ownVenue(parse(z.uuid(), req.params.id), uid(req));
    if (v.status === 'pending') throw conflict('This venue is already under approval');
    if (['ready', 'approved'].includes(v.status)) throw conflict('This venue is already approved');
    if (v.status === 'suspended') throw conflict('This venue was suspended by PlaynX. Contact support');
    const chk = (await ctx.db.query(
      `SELECT (SELECT count(*)::int FROM venue_images WHERE venue_id=$1 AND area_id IS NULL AND kind='image') AS images,
              (SELECT count(*)::int FROM venue_documents WHERE venue_id=$1 AND doc_type='Electricity bill' AND status <> 'rejected') AS docs,
              (SELECT count(*)::int FROM venue_documents WHERE venue_id=$1 AND doc_type='Land proof' AND status <> 'rejected') AS land,
              (SELECT count(*)::int FROM venue_images WHERE venue_id=$1 AND area_id IS NULL AND kind='video' AND geo_lat IS NOT NULL) AS geo_videos,
              ((SELECT count(*) FROM venue_sports WHERE venue_id=$1) + (SELECT count(*) FROM playing_area_sports s JOIN playing_areas a ON a.id=s.playing_area_id WHERE a.venue_id=$1))::int AS ready_areas,
              (SELECT count(*)::int FROM playing_areas a WHERE a.venue_id=$1 AND a.is_active AND NOT EXISTS (SELECT 1 FROM venue_images i WHERE i.area_id=a.id AND i.geo_lat IS NOT NULL)) AS no_geo`, [v.id])).rows[0];
    const missing: string[] = [];
    const bank = (await ctx.db.query('SELECT bank_account_number FROM owner_profiles WHERE user_id=$1', [uid(req)])).rows[0]?.bank_account_number;
    if (!bank) missing.push('your bank account details (Account > Bank account)');
    if (!chk.images) missing.push('at least one photo');
    if (!chk.ready_areas) missing.push('at least one sport (Sports available in the venue form)');
    if (ctx.cfg.REQUIRE_AREA_GEOTAG === 'true' && chk.no_geo) missing.push(`a geo-tagged photo for ${chk.no_geo === 1 ? 'a playing area' : `${chk.no_geo} playing areas`} (add it in the area's form)`);
    if (!chk.docs) missing.push('the electricity bill');
    if (!chk.land) missing.push('the land proof');
    if (ctx.cfg.REQUIRE_VENUE_GEO_VIDEO === 'true' && !chk.geo_videos) missing.push('a geo-tagged video recorded at the venue');
    if (missing.length) throw badRequest(`Before sending for approval, add: ${missing.join('; ')}`, 'incomplete_venue', { missing });
    await ctx.db.query(`UPDATE venues SET status='pending', rejection_reason=NULL, updated_at=now() WHERE id=$1`, [v.id]);
    await audit(ctx.db, req, 'venue.send_for_approval', 'venue', v.id);
    await ctx.notifier.notifyAdmins('venues', { title: 'Venue awaiting approval', body: `${req.user!.fullName} published "${v.name}" (${v.city}). Review it to make it live.`, type: 'admin_venue_submitted', email: true, data: { link: '/admin/venues?status=pending' } });
    res.json({ status: 'pending' });
  });

  // Publishing is the owner's own choice: once PlaynX has approved the venue, the owner decides when it appears to customers.
  r.post('/venues/:id/publish', async (req, res) => {
    const v = await ownVenue(parse(z.uuid(), req.params.id), uid(req));
    if (v.status === 'approved') throw conflict('This venue is already published');
    if (v.status !== 'ready') throw conflict('PlaynX must approve this venue before you can publish it', 'not_approved');
    const ready = await ctx.db.query(`SELECT 1 FROM playing_areas a WHERE a.venue_id=$1 AND a.is_active AND EXISTS (SELECT 1 FROM pricing_rules p WHERE p.area_id=a.id) AND EXISTS (SELECT 1 FROM playing_area_hours d WHERE d.playing_area_id=a.id AND NOT d.is_closed) LIMIT 1`, [v.id]);
    if (!ready.rows[0]) throw badRequest('Set the prices and opening hours of a playing area before publishing, so customers can book it', 'venue_not_ready');
    await ctx.db.query(`UPDATE venues SET status='approved', updated_at=now() WHERE id=$1`, [v.id]);
    await audit(ctx.db, req, 'venue.publish', 'venue', v.id);
    res.json({ status: 'approved' });
  });
  r.post('/venues/:id/unpublish', async (req, res) => {
    const v = await ownVenue(parse(z.uuid(), req.params.id), uid(req));
    if (v.status !== 'approved') throw conflict('This venue is not published');
    await ctx.db.query(`UPDATE venues SET status='ready', updated_at=now() WHERE id=$1`, [v.id]);
    await audit(ctx.db, req, 'venue.unpublish', 'venue', v.id);
    res.json({ status: 'ready' });
  });

  r.post('/venues/:id/submit', async (req, res) => {
    const v = await ownVenue(parse(z.uuid(), req.params.id), uid(req));
    if (!['draft', 'rejected'].includes(v.status)) throw conflict(`Venue is already ${v.status}`);
    const chk = (await ctx.db.query(
      `SELECT (SELECT count(*)::int FROM venue_images WHERE venue_id=$1 AND area_id IS NULL AND kind='image') AS images,
              (SELECT count(*)::int FROM venue_documents WHERE venue_id=$1 AND doc_type='Electricity bill' AND status <> 'rejected') AS docs,
              (SELECT count(*)::int FROM venue_documents WHERE venue_id=$1 AND doc_type='Land proof' AND status <> 'rejected') AS land,
              (SELECT count(*)::int FROM venue_images WHERE venue_id=$1 AND area_id IS NULL AND kind='video' AND geo_lat IS NOT NULL) AS geo_videos,
              ((SELECT count(*) FROM venue_sports WHERE venue_id=$1) + (SELECT count(*) FROM playing_area_sports s JOIN playing_areas a ON a.id=s.playing_area_id WHERE a.venue_id=$1))::int AS ready_areas,
              (SELECT count(*)::int FROM playing_areas a WHERE a.venue_id=$1 AND a.is_active AND NOT EXISTS (SELECT 1 FROM venue_images i WHERE i.area_id=a.id AND i.geo_lat IS NOT NULL)) AS no_geo`, [v.id])).rows[0];
    const missing: string[] = [];
    if (!chk.images) missing.push('at least one photo');
    if (!chk.ready_areas) missing.push('at least one sport (Sports available in the venue form)');
    if (ctx.cfg.REQUIRE_AREA_GEOTAG === 'true' && chk.no_geo) missing.push(`a geo-tagged photo for ${chk.no_geo === 1 ? 'a playing area' : `${chk.no_geo} playing areas`} (add it in the area's form)`);
    if (!chk.docs) missing.push('the electricity bill (upload it under Venue documents)');
    if (!chk.land) missing.push('the land proof (upload it under Venue documents)');
    if (ctx.cfg.REQUIRE_VENUE_GEO_VIDEO === 'true' && !chk.geo_videos) missing.push('a geo-tagged video recorded at the venue');
    if (missing.length) throw badRequest(`Before submitting, add: ${missing.join('; ')}`, 'incomplete_venue', { missing });
    await ctx.db.query(`UPDATE venues SET status='pending', rejection_reason=NULL, updated_at=now() WHERE id=$1`, [v.id]);
    await audit(ctx.db, req, 'venue.submit', 'venue', v.id);
    await ctx.notifier.notifyAdmins('venues', { title: 'Venue submitted for approval', body: `${req.user!.fullName} submitted "${v.name}" (${v.city}) for review.`, type: 'admin_venue_submitted', email: true, data: { link: '/admin/venues?status=pending' } });
    res.json({ status: 'pending' });
  });

  // ---------------- media + documents
  // ---- live photos of a playing area: taken with the in-app camera together with the phone's live location. There is no file upload for these.
  const sha256 = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
  const readable = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
  /** Checks the live location against the venue, and signs a proof tied to this exact photo and this moment. */
  r.post('/venues/:id/media/live-check', upload.single('file'), async (req, res) => {
    const v = await ownVenue(parse(z.uuid(), req.params.id), uid(req));
    const f = checkedFile(req.file, ['image/jpeg', 'image/png', 'image/webp']);
    const b = parse(z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180), accuracy: z.coerce.number().min(0).max(100000) }), req.body);
    if (b.lat === 0 && b.lng === 0) throw badRequest('Your phone did not give a real location. Turn on location (GPS) and try again.', 'no_location');
    if (b.accuracy > ctx.cfg.LIVE_MAX_ACCURACY_METERS) throw badRequest(`Your location is only accurate to about ${readable(b.accuracy)}. Step outside onto the turf, turn on precise location (GPS), wait a few seconds and take the photo again.`, 'location_inaccurate', { accuracyM: Math.round(b.accuracy) });
    const distanceM = v.lat == null || v.lng == null ? 0 : Math.round(distanceMeters({ lat: b.lat, lng: b.lng }, { lat: Number(v.lat), lng: Number(v.lng) })); // a venue without a pinned location has nothing to compare with
    const max = ctx.cfg.GEOTAG_MAX_METERS;
    if (distanceM > max) throw badRequest(`You are about ${readable(distanceM)} from the location pinned for this venue. Take the photo at the turf (within ${max} m), or correct the venue's pinned location.`, 'geotag_far', { distanceM });
    const address = await reverseGeocode(ctx.cfg, { lat: b.lat, lng: b.lng }); // the street address of where the photo was taken (null when the lookup is off or fails)
    const proof = jwt.sign({ typ: 'live-photo', v: v.id, u: uid(req), h: sha256(f.buffer), lat: b.lat, lng: b.lng, d: distanceM, a: address }, ctx.cfg.JWT_SECRET, { expiresIn: `${ctx.cfg.LIVE_PROOF_MAX_MINUTES}m` });
    res.json({ ok: true, lat: b.lat, lng: b.lng, address, distanceM, accuracyM: Math.round(b.accuracy), maxMeters: max, proof });
  });
  /** A proof is only good for the photo it was issued for, for this venue and owner, and for a limited time. */
  const readProof = (v: any, userId: string, buffer: Buffer, token: unknown): { lat: number; lng: number; distanceM: number; address: string | null } => {
    const need = () => badRequest('This photo must be taken live with the camera in the app, together with your live location. Photos cannot be uploaded from your files or gallery.', 'live_capture_required');
    if (typeof token !== 'string' || !token) throw need();
    let p: any;
    try { p = jwt.verify(token, ctx.cfg.JWT_SECRET); } catch { throw badRequest(`The live check for this photo expired (it is valid for ${ctx.cfg.LIVE_PROOF_MAX_MINUTES} minutes). Take the photo again.`, 'live_proof_expired'); }
    if (p.typ !== 'live-photo' || p.v !== v.id || p.u !== userId || p.h !== sha256(buffer)) throw need();
    return { lat: p.lat, lng: p.lng, distanceM: p.d, address: typeof p.a === 'string' ? p.a : null }; // all of it comes from the signed proof, not from the form
  };
  /** The coordinates inside a Google Maps link; a short link is followed to the page it points at. */
  r.get('/maps/resolve', async (req, res) => {
    const url = parse(z.string().trim().max(500).regex(GOOGLE_MAP_LINK, 'Paste a Google Maps link'), req.query.url);
    const c = await coordsFromShortLink(url);
    res.json({ found: !!c, lat: c?.lat ?? null, lng: c?.lng ?? null });
  });
  /**
   * The video recorded at the venue with the phone's live location (JusGo's "geo-tagged video"). The location is checked against the venue's
   * pin when it has one (and becomes the venue's location when it does not), then the video is kept with where and how far from the pin it was shot.
   */
  r.post('/venues/:id/media/geo-video', upload.single('file'), async (req, res) => {
    const v = await ownVenue(parse(z.uuid(), req.params.id), uid(req));
    unlocked(v);
    const f = checkedFile(req.file, ['video/mp4', 'video/webm', 'video/quicktime']);
    const b = parse(z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180), accuracy: z.coerce.number().min(0).max(100000) }), req.body);
    if (b.lat === 0 && b.lng === 0) throw badRequest('Your phone did not give a real location. Turn on location (GPS) and record again.', 'no_location');
    if (b.accuracy > ctx.cfg.LIVE_MAX_ACCURACY_METERS) throw badRequest(`Your location is only accurate to about ${readable(b.accuracy)}. Step outside onto the turf, turn on precise location (GPS), wait a few seconds and record again.`, 'location_inaccurate');
    const hasPin = v.lat != null && v.lng != null;
    const distanceM = hasPin ? Math.round(distanceMeters({ lat: b.lat, lng: b.lng }, { lat: Number(v.lat), lng: Number(v.lng) })) : 0;
    if (hasPin && distanceM > ctx.cfg.GEOTAG_MAX_METERS) throw badRequest(`You are about ${readable(distanceM)} from this venue's location. Record the video at the turf (within ${ctx.cfg.GEOTAG_MAX_METERS} m).`, 'geotag_far', { distanceM });
    const address = await reverseGeocode(ctx.cfg, { lat: b.lat, lng: b.lng });
    const url = await ctx.storage.upload(`venues/${v.id}`, '', f.buffer, f.type);
    const count = (await ctx.db.query('SELECT count(*)::int AS n FROM venue_images WHERE venue_id=$1', [v.id])).rows[0].n;
    if (count >= 30) throw badRequest('A venue can have at most 30 media files', 'too_many_files');
    const live = isLiveVenue(v);
    const { rows } = await ctx.db.tx(async (q) => {
      if (!hasPin) await q.query('UPDATE venues SET lat=$2, lng=$3, updated_at=now() WHERE id=$1', [v.id, b.lat, b.lng]); // the first geo-tagged video places the venue
      return q.query(`INSERT INTO venue_images (venue_id, url, kind, is_cover, sort_order, is_pending, geo_lat, geo_lng, geo_distance_m, geo_address) VALUES ($1,$2,'video',false,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [v.id, url, count, live, b.lat, b.lng, distanceM, address]);
    });
    await audit(ctx.db, req, 'venue.geo_video', 'venue', v.id, { distanceM });
    res.status(201).json({ media: rows[0], distanceM, located: !hasPin });
  });
  r.post('/venues/:id/media', upload.single('file'), async (req, res) => {
    const v = await ownVenue(parse(z.uuid(), req.params.id), uid(req));
    unlocked(v);
    // areaId (optional) makes it a photo of one playing area: images only, never the venue's cover, at most 10 per area.
    const areaId = parse(z.uuid().optional(), typeof req.body?.areaId === 'string' && req.body.areaId ? req.body.areaId : undefined);
    const panorama = req.body?.kind === 'panorama';
    if (panorama && areaId) throw badRequest('The 360° photo belongs to the venue, not a playing area', 'validation_error');
    const f = checkedFile(req.file, panorama ? ['image/jpeg', 'image/png'] : areaId ? ['image/jpeg', 'image/png', 'image/webp'] : ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm']);
    if (panorama && f.buffer.length > 20 * 1024 * 1024) throw badRequest('The 360° photo can be at most 20 MB', 'file_too_large');
    if (panorama) await ctx.db.query(`DELETE FROM venue_images WHERE venue_id=$1 AND kind='panorama'`, [v.id]); // one panorama: a new one replaces the old
    if (areaId && !(await ctx.db.query('SELECT 1 FROM playing_areas WHERE id=$1 AND venue_id=$2', [areaId, v.id])).rows[0]) throw notFound('Playing area not found');
    const count = (await ctx.db.query('SELECT count(*)::int AS n FROM venue_images WHERE venue_id=$1', [v.id])).rows[0].n;
    if (count >= 30) throw badRequest('A venue can have at most 30 media files', 'too_many_files');
    if (areaId && (await ctx.db.query('SELECT count(*)::int AS n FROM venue_images WHERE area_id=$1', [areaId])).rows[0].n >= 10) throw badRequest('A playing area can have at most 10 photos', 'too_many_files');
    // Playing area photos come only from the live camera: the proof from the live check must match this exact file.
    const geo = areaId && (ctx.cfg.REQUIRE_LIVE_AREA_PHOTOS === 'true' || req.body?.proof) ? readProof(v, uid(req), f.buffer, req.body?.proof) : null;
    const url = await ctx.storage.upload(`venues/${v.id}`, '', f.buffer, f.type);
    const live = isLiveVenue(v) && !areaId; // on an approved venue new venue photos wait for admin approval; playing area photos do not
    const waitingBefore = live ? await hasWaiting(v.id) : true;
    const hasCover = !areaId && !live && (await ctx.db.query('SELECT 1 FROM venue_images WHERE venue_id=$1 AND area_id IS NULL AND is_cover', [v.id])).rows[0];
    const { rows } = await ctx.db.query(
      `INSERT INTO venue_images (venue_id, url, kind, is_cover, sort_order, is_pending, area_id, geo_lat, geo_lng, geo_distance_m, geo_address) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [v.id, url, panorama ? 'panorama' : f.type.startsWith('video') ? 'video' : 'image', !panorama && !areaId && !live && !hasCover && f.type.startsWith('image'), count, live, areaId ?? null, geo?.lat ?? null, geo?.lng ?? null, geo?.distanceM ?? null, geo?.address ?? null]);
    if (live && !waitingBefore) await alertAdminsOfChange(v, req.user!.fullName, areaId ? 'playing area photos' : 'photos or videos');
    res.status(201).json({ media: rows[0] });
  });
  r.put('/media/:id/cover', async (req, res) => {
    const m = (await ctx.db.query('SELECT i.*, v.owner_id, v.status AS venue_status FROM venue_images i JOIN venues v ON v.id=i.venue_id WHERE i.id=$1', [parse(z.uuid(), req.params.id)])).rows[0];
    if (!m) throw notFound();
    if (m.owner_id !== uid(req)) throw forbidden();
    unlocked({ status: m.venue_status });
    if (m.kind !== 'image') throw badRequest('Only images can be the cover');
    if (m.area_id) throw badRequest('A playing area photo cannot be the venue cover');
    const own = (await ctx.db.query('SELECT * FROM venues WHERE id=$1', [m.venue_id])).rows[0];
    if (isLiveVenue(own)) { await holdChange(own, req.user!.fullName, { fields: { cover_image_id: m.id } }); return void res.status(204).end(); } // the cover customers see changes on approval
    await ctx.db.tx(async (q) => { await q.query('UPDATE venue_images SET is_cover=false WHERE venue_id=$1', [m.venue_id]); await q.query('UPDATE venue_images SET is_cover=true WHERE id=$1', [m.id]); });
    res.status(204).end();
  });
  r.delete('/media/:id', async (req, res) => {
    const m = (await ctx.db.query('SELECT i.id, i.is_pending, i.area_id, v.id AS venue_id, v.name AS venue_name, v.owner_id, v.status AS venue_status FROM venue_images i JOIN venues v ON v.id=i.venue_id WHERE i.id=$1', [parse(z.uuid(), req.params.id)])).rows[0];
    if (!m) throw notFound();
    if (m.owner_id !== uid(req)) throw forbidden();
    unlocked({ status: m.venue_status });
    if (['approved', 'ready'].includes(m.venue_status) && !m.is_pending && !m.area_id) { // a live venue photo stays visible until the admin approves its removal
      const waitingBefore = await hasWaiting(m.venue_id);
      await ctx.db.query('UPDATE venue_images SET delete_requested=true WHERE id=$1', [m.id]);
      if (!waitingBefore) await alertAdminsOfChange({ name: m.venue_name }, req.user!.fullName, 'photos or videos');
      return void res.status(204).end();
    }
    await ctx.db.query('DELETE FROM venue_images WHERE id=$1', [m.id]);
    res.status(204).end();
  });
  r.get('/venue-documents/:id/file', async (req, res) => {
    const d = (await ctx.db.query('SELECT d.url, v.owner_id FROM venue_documents d JOIN venues v ON v.id=d.venue_id WHERE d.id=$1', [parse(z.uuid(), req.params.id)])).rows[0];
    if (!d) throw notFound('Document not found');
    if (d.owner_id !== uid(req)) throw forbidden();
    await sendStoredFile(ctx, res, d.url);
  });
  r.post('/venues/:id/documents', upload.single('file'), async (req, res) => {
    const v = await ownVenue(parse(z.uuid(), req.params.id), uid(req));
    unlocked(v);
    const waitingDocs = isLiveVenue(v) ? await hasWaiting(v.id) : true;
    const { docType } = parse(z.object({ docType: z.string().trim().min(2).max(60) }), req.body);
    const f = checkedFile(req.file, ['image/jpeg', 'image/png', 'application/pdf']);
    const key = await ctx.storage.putPrivate(`venue-docs/${v.id}`, f.buffer, f.type); // private bucket: never a public URL
    await ctx.db.query(`DELETE FROM venue_documents WHERE venue_id=$1 AND doc_type=$2 AND status='rejected'`, [v.id, docType]); // a re-upload replaces the rejected copy
    const { rows } = await ctx.db.query(`INSERT INTO venue_documents (venue_id, doc_type, url) VALUES ($1,$2,$3) RETURNING id, doc_type, status, note, created_at`, [v.id, docType, `private:${key}`]);
    await ctx.notifier.notifyAdmins('venues', { title: 'Document uploaded for review', body: `${req.user!.fullName} uploaded "${docType}" for "${v.name}".`, type: 'admin_document_uploaded', data: { link: '/admin/venues' } });
    if (isLiveVenue(v) && !waitingDocs) await alertAdminsOfChange(v, req.user!.fullName, 'documents');
    res.status(201).json({ document: rows[0] });
  });

  // ---------------- playing areas, sports, pricing, hours
  const areaSchema = z.object({
    name: z.string().trim().min(1).max(80), surface: z.string().trim().max(60).optional(), capacity: z.number().int().min(1).max(100).optional(),
    slotMinutes: z.union([z.literal(30), z.literal(60), z.literal(120), z.literal(180), z.literal(240), z.literal(300)]).default(60), minDurationMinutes: z.number().int().min(30).max(300).default(60),
    maxDurationMinutes: z.number().int().min(30).max(300).default(180), sportIds: z.array(z.number().int().positive()).min(1).max(10),
    isActive: z.boolean().default(true),
    environment: z.enum(['indoor', 'outdoor']).optional(), roofType: z.enum(['open', 'closed', 'covered', 'retractable']).optional(), turfShape: z.enum(['round', 'rectangle']).optional(), advanceBookingDays: z.number().int().min(1).max(365).optional(), instantBooking: z.boolean().optional(),
  });
  /** Once a venue has chosen its sports, its playing areas can only offer those. */
  async function assertVenueSports(q: any, venueId: string, sportIds: number[]) {
    const has = (await q.query('SELECT sport_id FROM venue_sports WHERE venue_id=$1', [venueId])).rows.map((r: any) => r.sport_id);
    if (has.length && sportIds.some((x) => !has.includes(x))) throw badRequest('Choose sports this venue offers. Add the sport to the venue first (Edit venue > Sports available).', 'sport_not_offered_by_venue');
  }
  async function saveSports(q: any, areaId: string, sportIds: number[]) {
    await q.query('DELETE FROM playing_area_sports WHERE playing_area_id=$1', [areaId]);
    const ins = await q.query(`INSERT INTO playing_area_sports (playing_area_id, sport_id) SELECT $1, s.id FROM sports s WHERE s.id = ANY($2)`, [areaId, sportIds]);
    if (ins.rowCount !== new Set(sportIds).size) throw badRequest('One or more sports do not exist', 'bad_sport');
  }
  r.post('/venues/:id/areas', async (req, res) => {
    const v = await ownVenue(parse(z.uuid(), req.params.id), uid(req));
    unlocked(v);
    if (!isLiveVenue(v)) throw conflict('PlaynX must approve this venue before you can add playing areas', 'venue_not_approved');
    const b = parse(areaSchema.extend({ defaultPrice: z.number().gt(0, 'Enter a default price above ₹0').max(100000).optional() }), req.body);
    const a = await ctx.db.tx(async (q) => {
      const a = (await q.query(
        `INSERT INTO playing_areas (venue_id, name, surface, capacity, slot_minutes, min_duration_minutes, max_duration_minutes, is_active, environment, roof_type, advance_booking_days, instant_booking, approval_status, turf_shape) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending',$13) RETURNING *`,
        [v.id, b.name, b.surface ?? null, b.capacity ?? null, b.slotMinutes, b.minDurationMinutes, b.maxDurationMinutes, b.isActive, b.environment ?? null, b.roofType ?? null, b.advanceBookingDays ?? null, b.instantBooking ?? true, b.turfShape ?? null])).rows[0];
      await assertVenueSports(q, v.id, b.sportIds);
      await saveSports(q, a.id, b.sportIds);
      // the default price: every slot without its own price costs this (slot-wise prices set later take priority)
      if (b.defaultPrice) await q.query(`INSERT INTO pricing_rules (area_id, sport_id, day_type, day_of_week, start_time, end_time, price_per_hour) VALUES ($1,NULL,'all',NULL,'00:00','24:00',$2)`, [a.id, b.defaultPrice]);
      return a;
    });
    await ctx.notifier.notifyAdmins('venues', { title: 'Playing area awaiting approval', body: `${req.user!.fullName} added "${a.name}" to "${v.name}". Review it before customers can book it.`, type: 'admin_area_created', email: true, data: { link: '/admin/area-approvals' } });
    res.status(201).json({ area: a });
  });
  /** The bookings still to be played in an area: what closing it would affect. */
  r.get('/areas/:id/upcoming-bookings', async (req, res) => {
    const a = await ownArea(parse(z.uuid(), req.params.id), uid(req));
    const { rows } = await ctx.db.query(
      `SELECT b.id, b.reference, lower(b.during) AS starts_at, upper(b.during) AS ends_at, b.total::float8 AS total, COALESCE(u.full_name, b.walkin_name) AS customer_name
         FROM bookings b LEFT JOIN users u ON u.id=b.customer_id WHERE b.area_id=$1 AND b.status='confirmed' AND upper(b.during) > now() ORDER BY lower(b.during) LIMIT 200`, [a.id]);
    res.json({ bookings: rows });
  });
  r.put('/areas/:id', async (req, res) => {
    const a = await ownArea(parse(z.uuid(), req.params.id), uid(req));
    if (a.deletion_status) throw conflict(a.deletion_status === 'deleted' ? 'This playing area is deleted.' : 'This playing area is waiting for deletion approval. Cancel the request to change it.', 'area_deleting');
    unlocked({ status: a.venue_status });
    const b = parse(areaSchema.partial().extend({ bookings: z.enum(['cancel', 'keep']).optional() }), req.body);
    let cancelledBookings = 0;
    if (b.isActive === false && a.is_active) {
      const upcoming = (await ctx.db.query(`SELECT id FROM bookings WHERE area_id=$1 AND status='confirmed' AND upper(during) > now()`, [a.id])).rows;
      if (upcoming.length && !b.bookings) throw conflict('This playing area has upcoming bookings. Choose to cancel them or leave them booked.', 'has_upcoming_bookings');
      if (b.bookings === 'cancel') for (const c of upcoming) { await cancelBooking(ctx, req.user!, c.id, 'The venue closed this playing area'); cancelledBookings++; }
    }
    const out = await ctx.db.tx(async (q) => {
      const u = (await q.query(
        `UPDATE playing_areas SET name=COALESCE($2,name), surface=COALESCE($3,surface), capacity=COALESCE($4,capacity), slot_minutes=COALESCE($5,slot_minutes),
           min_duration_minutes=COALESCE($6,min_duration_minutes), max_duration_minutes=COALESCE($7,max_duration_minutes), is_active=COALESCE($8,is_active),
           environment=COALESCE($9,environment), roof_type=COALESCE($10,roof_type), advance_booking_days=COALESCE($11,advance_booking_days), instant_booking=COALESCE($12,instant_booking), turf_shape=COALESCE($13,turf_shape), approval_status=CASE WHEN approval_status='rejected' THEN 'pending' ELSE approval_status END, approval_note=CASE WHEN approval_status='rejected' THEN NULL ELSE approval_note END WHERE id=$1 RETURNING *`,
        [a.id, b.name ?? null, b.surface ?? null, b.capacity ?? null, b.slotMinutes ?? null, b.minDurationMinutes ?? null, b.maxDurationMinutes ?? null, b.isActive ?? null, b.environment ?? null, b.roofType ?? null, b.advanceBookingDays ?? null, b.instantBooking ?? null, b.turfShape ?? null])).rows[0];
      if (b.sportIds) { await assertVenueSports(q, a.venue_id, b.sportIds); await saveSports(q, a.id, b.sportIds); }
      return u;
    });
    res.json({ area: out, cancelledBookings });
  });
  /** "What would a booking cost?" using the saved pricing, before or after the venue is live. */
  r.post('/areas/:id/price-check', async (req, res) => {
    const a = await ownArea(parse(z.uuid(), req.params.id), uid(req));
    const b = parse(z.object({ sportId: z.number().int().positive(), startsAt: z.iso.datetime({ offset: true }), durationMinutes: z.number().int().min(30).max(720) }), req.body);
    const ac = await loadAreaContext(ctx.db, a.id, b.sportId, true);
    const qt = await quote(ctx.db, ac, b.sportId, b.startsAt, b.durationMinutes);
    const discount = ac.venue.discount_percent ? Math.round(qt.price * ac.venue.discount_percent) / 100 : 0;
    res.json({ price: qt.price, startsAt: qt.startsAt, endsAt: qt.endsAt, durationMinutes: b.durationMinutes, perHour: Math.round((qt.price / b.durationMinutes) * 60 * 100) / 100, venueDiscount: discount });
  });
  /**
   * Delete a playing area: it is closed for booking and greyed out at once, and an admin approves the deletion.
   * The area and all its bookings stay in the database.
   */
  r.delete('/areas/:id', async (req, res) => {
    const a = await ownArea(parse(z.uuid(), req.params.id), uid(req));
    const b = parse(z.object({ reason: z.string().trim().max(300).optional() }).default({}), req.body ?? {});
    if (a.deletion_status === 'pending') throw conflict('This playing area is already waiting for deletion approval.', 'deletion_pending');
    if (a.deletion_status === 'deleted') throw conflict('This playing area is already deleted.', 'deleted');
    const upcoming = (await ctx.db.query(`SELECT count(*)::int AS n FROM bookings WHERE area_id=$1 AND status IN ('pending','confirmed') AND lower(during) > now()`, [a.id])).rows[0].n;
    await ctx.db.query(`UPDATE playing_areas SET deletion_status='pending', deletion_requested_at=now(), deletion_reason=$2, deletion_note=NULL, active_before_delete=is_active, is_active=false WHERE id=$1`, [a.id, b.reason ?? null]);
    await audit(ctx.db, req, 'area.deletion_requested', 'area', a.id, { upcoming });
    const v = (await ctx.db.query('SELECT name FROM venues WHERE id=$1', [a.venue_id])).rows[0];
    await ctx.notifier.notifyAdmins('venues', { title: 'Playing area deletion requested', type: 'admin_area_deletion', email: true, data: { link: '/admin/area-approvals?view=deletions' },
      body: `${req.user!.fullName} asked to delete "${a.name}" at "${v?.name ?? ''}".${upcoming ? ` It has ${upcoming} upcoming booking${upcoming === 1 ? '' : 's'}.` : ''}${b.reason ? ` Reason: ${b.reason}` : ''}` });
    res.status(202).json({ deletionStatus: 'pending', upcomingBookings: upcoming });
  });
  /** take back a deletion request that an admin has not decided yet */
  r.post('/areas/:id/cancel-deletion', async (req, res) => {
    const a = await ownArea(parse(z.uuid(), req.params.id), uid(req));
    const { rows } = await ctx.db.query(`UPDATE playing_areas SET deletion_status=NULL, deletion_requested_at=NULL, deletion_reason=NULL, is_active=COALESCE(active_before_delete, is_active), active_before_delete=NULL
      WHERE id=$1 AND deletion_status='pending' RETURNING id`, [a.id]);
    if (!rows[0]) throw conflict('There is no deletion request to cancel.', 'no_request');
    await audit(ctx.db, req, 'area.deletion_cancelled', 'area', a.id);
    res.json({ deletionStatus: null });
  });
  const priceRule = z.object({
    sportId: z.number().int().positive().nullable().default(null), dayType: z.enum(['all', 'weekday', 'weekend']).default('all'), dayOfWeek: z.number().int().min(0).max(6).nullable().default(null),
    startTime: time, endTime: z.union([time, z.literal('24:00')]), pricePerHour: z.number().gt(0, 'Enter a price above ₹0 for every slot').max(100000),
  }).refine((x) => x.endTime > x.startTime, { message: 'endTime must be after startTime' })
    .refine((x) => x.dayOfWeek === null || x.dayType === 'all', { message: 'A rule for one day of the week cannot also be weekday or weekend', path: ['dayType'] });
  const dayEnd = z.union([time, z.literal('24:00')]);
  const dayRule = z.object({ dayOfWeek: z.number().int().min(0).max(6), openTime: time, closeTime: dayEnd, isClosed: z.boolean().default(false) })
    .refine((x) => x.closeTime > x.openTime, { message: 'closeTime must be after openTime' });
  /** Date-wise hours: on these dates the hours below are used instead of the day-wise ones (a holiday, an event, a shorter day). */
  const dateHours = z.object({ date: z.iso.date(), closed: z.boolean().default(true), openTime: time.optional(), closeTime: dayEnd.optional(), reason: z.string().trim().max(100).optional() })
    .refine((x) => x.closed || (!!x.openTime && !!x.closeTime && x.closeTime > x.openTime), { message: 'Set the opening and closing time (closing after opening)', path: ['closeTime'] });
  type PriceRuleIn = z.infer<typeof priceRule>;
  const replacePricing = async (q: any, req: any, areaId: string, rules: PriceRuleIn[]) => {
    const before = (await q.query(`SELECT sport_id AS "sportId", day_type AS "dayType", day_of_week AS "dayOfWeek", to_char(start_time,'HH24:MI') AS "startTime", to_char(end_time,'HH24:MI') AS "endTime", price_per_hour AS "pricePerHour" FROM pricing_rules WHERE area_id=$1 ORDER BY start_time`, [areaId])).rows;
    await audit(q, req, 'pricing.update', 'area', areaId, { before: before.slice(0, 60), after: rules.slice(0, 60), total: rules.length });
    await q.query('DELETE FROM pricing_rules WHERE area_id=$1', [areaId]);
    for (const x of rules) await q.query(`INSERT INTO pricing_rules (area_id, sport_id, day_type, day_of_week, start_time, end_time, price_per_hour) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [areaId, x.sportId, x.dayType, x.dayOfWeek, x.startTime, x.endTime, x.pricePerHour]);
  };
  const replaceHours = async (q: any, areaId: string, days: z.infer<typeof dayRule>[]) => {
    if (new Set(days.map((d) => d.dayOfWeek)).size !== days.length) throw badRequest('Duplicate day in availability');
    await q.query('DELETE FROM playing_area_hours WHERE playing_area_id=$1', [areaId]);
    for (const d of days) await q.query(`INSERT INTO playing_area_hours (playing_area_id, day_of_week, open_time, close_time, is_closed) VALUES ($1,$2,$3,$4,$5)`, [areaId, d.dayOfWeek, d.openTime, d.closeTime, d.isClosed]);
  };
  /** Pricing > Default pricing. `applyToAll` replaces every other price the area had; otherwise only the default price changes. */
  r.put('/areas/:id/default-price', async (req, res) => {
    const a = await ownArea(parse(z.uuid(), req.params.id), uid(req));
    const b = parse(z.object({ basePrice: z.number().gt(0).max(100000), applyToAll: z.boolean().default(false) }), req.body);
    const out = await ctx.db.tx(async (q) => {
      const before = (await q.query(`SELECT sport_id AS "sportId", day_type AS "dayType", day_of_week AS "dayOfWeek", to_char(start_time,'HH24:MI') AS "startTime", to_char(end_time,'HH24:MI') AS "endTime", price_per_hour AS "pricePerHour" FROM pricing_rules WHERE area_id=$1 ORDER BY start_time`, [a.id])).rows;
      let removed = 0;
      if (b.applyToAll) { removed = (await q.query('DELETE FROM pricing_rules WHERE area_id=$1', [a.id])).rowCount ?? 0; removed += (await q.query(`UPDATE pricing_date_slots SET status='REMOVED', ended_at=now(), updated_at=now() WHERE playing_area_id=$1 AND status='ACTIVE'`, [a.id])).rowCount ?? 0; }
      else await q.query(`DELETE FROM pricing_rules WHERE area_id=$1 AND sport_id IS NULL AND day_type='all' AND day_of_week IS NULL AND start_time='00:00' AND end_time='24:00'`, [a.id]);
      await q.query(`INSERT INTO pricing_rules (area_id, sport_id, day_type, day_of_week, start_time, end_time, price_per_hour) VALUES ($1,NULL,'all',NULL,'00:00','24:00',$2)`, [a.id, b.basePrice]);
      await audit(q, req, 'pricing.update', 'area', a.id, { before: before.slice(0, 60), after: [{ startTime: '00:00', endTime: '24:00', pricePerHour: b.basePrice }], total: 1, applyToAll: b.applyToAll });
      return removed;
    });
    res.json({ basePrice: b.basePrice, applyToAll: b.applyToAll, removedRules: out });
  });
  // ---- Pricing > slot prices for chosen dates (pricing_date_slots): a price for one date and time window, ahead of the weekly rules
  r.get('/areas/:id/date-prices', async (req, res) => {
    const a = await ownArea(parse(z.uuid(), req.params.id), uid(req));
    const { rows } = await ctx.db.query(`SELECT id, price_date::text AS date, to_char(start_time,'HH24:MI') AS "startTime", to_char(end_time,'HH24:MI') AS "endTime", price_per_hour::float8 AS "pricePerHour"
        FROM pricing_date_slots WHERE playing_area_id=$1 AND status='ACTIVE' AND price_date >= current_date ORDER BY price_date, start_time`, [a.id]);
    res.json({ prices: rows });
  });
  r.put('/areas/:id/date-prices', async (req, res) => {
    const a = await ownArea(parse(z.uuid(), req.params.id), uid(req));
    const { entries } = parse(z.object({ entries: z.array(z.object({ date: z.iso.date(), startTime: time, endTime: z.union([time, z.literal('24:00')]), pricePerHour: z.number().gt(0).max(100000) })
      .refine((x) => x.endTime > x.startTime, { message: 'endTime must be after startTime' })).min(1).max(200) }), req.body);
    await ctx.db.tx(async (q) => {
      for (const e of entries) { // a price saved again for the same date replaces the earlier one it overlaps
        await q.query(`UPDATE pricing_date_slots SET status='SUPERSEDED', ended_at=now(), updated_at=now() WHERE playing_area_id=$1 AND price_date=$2 AND status='ACTIVE' AND start_time < $4::time AND end_time > $3::time`, [a.id, e.date, e.startTime, e.endTime]);
        await q.query(`INSERT INTO pricing_date_slots (playing_area_id, price_date, start_time, end_time, price_per_hour, created_by) VALUES ($1,$2,$3,$4,$5,$6)`, [a.id, e.date, e.startTime, e.endTime, e.pricePerHour, uid(req)]);
      }
      await audit(q, req, 'pricing.date_updated', 'area', a.id, { entries: entries.slice(0, 60) });
    });
    res.status(204).end();
  });
  r.delete('/areas/:id/date-prices/:slotId', async (req, res) => {
    const a = await ownArea(parse(z.uuid(), req.params.id), uid(req));
    const { rowCount } = await ctx.db.query(`UPDATE pricing_date_slots SET status='REMOVED', ended_at=now(), updated_at=now() WHERE id=$1 AND playing_area_id=$2 AND status='ACTIVE'`, [parse(z.uuid(), req.params.slotId), a.id]);
    if (!rowCount) throw notFound('Price not found');
    res.status(204).end();
  });
  r.put('/areas/:id/pricing', async (req, res) => {
    const a = await ownArea(parse(z.uuid(), req.params.id), uid(req));
    const { rules } = parse(z.object({ rules: z.array(priceRule).min(1).max(1000) }), req.body);
    await ctx.db.tx((q) => replacePricing(q, req, a.id, rules));
    res.status(204).end();
  });
  r.put('/areas/:id/availability', async (req, res) => {
    const a = await ownArea(parse(z.uuid(), req.params.id), uid(req));
    const { days, exceptions } = parse(z.object({ days: z.array(dayRule).min(1).max(7), exceptions: z.array(dateHours).max(366).optional() }), req.body);
    if (exceptions && new Set(exceptions.map((x) => x.date)).size !== exceptions.length) throw badRequest('A date is listed twice in the date-wise hours', 'duplicate_date');
    await ctx.db.tx(async (q) => {
      await replaceHours(q, a.id, days);
      if (exceptions) { // the list sent replaces the old one
        await q.query('DELETE FROM playing_area_hour_exceptions WHERE playing_area_id=$1', [a.id]);
        for (const x of exceptions) await q.query(`INSERT INTO playing_area_hour_exceptions (playing_area_id, venue_id, exception_date, closed, open_time, close_time, reason) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [a.id, a.venue_id, x.date, x.closed, x.closed ? null : x.openTime, x.closed ? null : x.closeTime, x.reason || null]);
      }
    });
    res.status(204).end();
  });
  /** Opening hours and every slot's price saved together, in one step: either both change or neither does. */
  r.put('/areas/:id/schedule', async (req, res) => {
    const a = await ownArea(parse(z.uuid(), req.params.id), uid(req));
    const b = parse(z.object({ days: z.array(dayRule).min(1).max(7), rules: z.array(priceRule).max(1500) }), req.body);
    await ctx.db.tx(async (q) => { await replaceHours(q, a.id, b.days); await replacePricing(q, req, a.id, b.rules); });
    res.status(204).end();
  });

  // ---------------- slot blocking (maintenance, private events, walk-ins)
  r.get('/areas/:id/blocks', async (req, res) => {
    const a = await ownArea(parse(z.uuid(), req.params.id), uid(req));
    const { rows } = await ctx.db.query(`SELECT id, lower(during) AS starts_at, upper(during) AS ends_at, notes AS reason FROM bookings WHERE area_id=$1 AND status='blocked' AND upper(during) > now() ORDER BY lower(during)`, [a.id]);
    res.json({ blocks: rows });
  });
  r.post('/areas/:id/blocks', async (req, res) => {
    const a = await ownArea(parse(z.uuid(), req.params.id), uid(req));
    const b = parse(z.object({ startsAt: z.iso.datetime({ offset: true }), endsAt: z.iso.datetime({ offset: true }), reason: z.string().trim().max(200).optional() })
      .refine((x) => new Date(x.endsAt) > new Date(x.startsAt), { message: 'endsAt must be after startsAt' }), req.body);
    // Overlap with a live booking/block violates the exclusion constraint -> 409 slot_unavailable.
    const { rows } = await ctx.db.query(
      `INSERT INTO bookings (reference, venue_id, area_id, during, status, notes, block_kind) VALUES ($1,$2,$3,tstzrange($4::timestamptz,$5::timestamptz,'[)'),'blocked',$6,'blocked')
       RETURNING id, lower(during) AS starts_at, upper(during) AS ends_at, notes AS reason`,
      [`BLK-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1000)}`, a.venue_id, a.id, b.startsAt, b.endsAt, b.reason ?? null]);
    ctx.realtime.toVenue(a.venue_id, 'slots:changed', { areaId: a.id });
    res.status(201).json({ block: rows[0] });
  });
  /** JusGo's "Upcoming events": the weekly blocks (every week / a date range) still running. */
  r.get('/weekly-blocks', async (req, res) => {
    const { rows } = await ctx.db.query(
      `SELECT w.id, w.days_of_week, to_char(w.start_time,'HH24:MI') AS start_time, to_char(w.end_time,'HH24:MI') AS end_time, w.reason, w.note, w.valid_from::text AS valid_from, w.valid_until::text AS valid_until,
              a.id AS area_id, a.name AS area_name, v.name AS venue_name
         FROM weekly_blocks w JOIN playing_areas a ON a.id=w.playing_area_id JOIN venues v ON v.id=a.venue_id
        WHERE v.owner_id=$1 AND w.status='ACTIVE' AND (w.valid_until IS NULL OR w.valid_until >= (now() AT TIME ZONE v.timezone)::date) ORDER BY w.valid_from NULLS FIRST, w.start_time`, [uid(req)]);
    res.json({ weeklyBlocks: rows });
  });
  /** Remove a weekly block: it is marked removed and its blocked time still to come is freed. */
  r.delete('/weekly-blocks/:id', async (req, res) => {
    const w = (await ctx.db.query(
      `SELECT w.*, v.timezone, v.id AS venue_id FROM weekly_blocks w JOIN playing_areas a ON a.id=w.playing_area_id JOIN venues v ON v.id=a.venue_id WHERE w.id=$1 AND v.owner_id=$2 AND w.status='ACTIVE'`, [parse(z.uuid(), req.params.id), uid(req)])).rows[0];
    if (!w) throw notFound('Event not found');
    await ctx.db.tx(async (q) => {
      await q.query(`UPDATE weekly_blocks SET status='REMOVED', removed_by=$2, removed_at=now() WHERE id=$1`, [w.id, uid(req)]);
      await q.query(
        `DELETE FROM bookings b WHERE b.area_id=$1 AND b.status='blocked' AND lower(b.during) > now()
            AND (lower(b.during) AT TIME ZONE $2)::time = $3::time AND (upper(b.during) AT TIME ZONE $2)::time = $4::time
            AND extract(dow FROM lower(b.during) AT TIME ZONE $2)::int = ANY($5::int[])
            AND ($6::date IS NULL OR (lower(b.during) AT TIME ZONE $2)::date >= $6::date) AND ($7::date IS NULL OR (lower(b.during) AT TIME ZONE $2)::date <= $7::date)`,
        [w.playing_area_id, w.timezone, w.start_time, w.end_time, w.days_of_week, w.valid_from, w.valid_until]);
    });
    ctx.realtime.toVenue(w.venue_id, 'slots:changed', { areaId: w.playing_area_id });
    res.status(204).end();
  });
  r.delete('/blocks/:id', async (req, res) => {
    const { rows } = await ctx.db.query(
      `DELETE FROM bookings b USING venues v WHERE b.id=$1 AND b.status='blocked' AND v.id=b.venue_id AND v.owner_id=$2 RETURNING b.venue_id, b.area_id`, [parse(z.uuid(), req.params.id), uid(req)]);
    if (!rows[0]) throw notFound('Block not found');
    ctx.realtime.toVenue(rows[0].venue_id, 'slots:changed', { areaId: rows[0].area_id });
    res.status(204).end();
  });

  // ---------------- bookings
  // ---------------- customers (everyone who booked: app customers and walk-ins, one row each)
  const CUSTOMER_KEY = `COALESCE(b.customer_id::text, 'walkin:' || COALESCE(NULLIF(b.walkin_phone, ''), lower(COALESCE(b.walkin_name, 'unknown'))))`;
  r.get('/customers', async (req, res) => {
    const id = uid(req);
    const q = parse(z.object({ search: z.string().trim().max(80).optional() }), req.query);
    const rows = (await ctx.db.query(
      `SELECT ${CUSTOMER_KEY} AS key, max(b.customer_id::text) AS customer_id,
              COALESCE(max(u.full_name), max(b.walkin_name), 'Walk-in customer') AS name,
              COALESCE(max(u.phone), max(b.walkin_phone)) AS mobile, COALESCE(max(u.email), max(b.walkin_email)) AS email, max(cp.city) AS city,
              count(*) FILTER (WHERE b.status IN ('confirmed','completed','cancelled','no_show','blocked'))::int AS bookings,
              count(*) FILTER (WHERE b.status = 'cancelled')::int AS cancelled,
              COALESCE(sum(b.total) FILTER (WHERE b.status IN ('confirmed','completed','blocked')), 0)::float8 AS spent,
              max(lower(b.during)) FILTER (WHERE b.status IN ('confirmed','completed','cancelled','no_show','blocked')) AS last_booking, array_agg(b.reference) AS refs
         FROM bookings b JOIN venues v ON v.id = b.venue_id
         LEFT JOIN users u ON u.id = b.customer_id LEFT JOIN customer_profiles cp ON cp.user_id = b.customer_id
        WHERE v.owner_id = $1 AND b.deleted_at IS NULL AND (b.block_kind IS NULL OR b.event_kind IS NOT NULL) AND b.status IN ('confirmed','completed','cancelled','no_show','blocked')
        GROUP BY ${CUSTOMER_KEY} ORDER BY max(lower(b.during)) DESC`, [id])).rows;
    // people the owner added by hand (or who were an opponent) join the list; one with the same mobile number as a booking customer is merged into that row
    const manual = (await ctx.db.query('SELECT id, name, mobile, email, city, source, note FROM owner_customers WHERE owner_id=$1 ORDER BY created_at DESC', [id])).rows;
    const digits = (m?: string | null) => String(m ?? '').replace(/\D/g, '').slice(-10);
    for (const m of manual) {
      const hit = rows.find((c: any) => digits(c.mobile) && digits(c.mobile) === digits(m.mobile));
      if (hit) { hit.manual_id = m.id; hit.source = m.source; hit.note = m.note; hit.city = hit.city ?? m.city; hit.email = hit.email ?? m.email; }
      else rows.push({ key: `manual:${m.id}`, customer_id: null, name: m.name, mobile: m.mobile, email: m.email, city: m.city, bookings: 0, cancelled: 0, spent: 0, last_booking: null, manual_id: m.id, source: m.source, note: m.note, refs: [] });
    }
    const needle = q.search?.toLowerCase();
    const customers = needle ? rows.filter((c: any) => [c.name, c.mobile, c.email, c.city, ...(c.refs ?? [])].some((x) => x && String(x).toLowerCase().includes(needle))) : rows; // name, mobile or booking ID
    for (const c of customers) delete (c as any).refs;
    res.json({ customers, summary: { customers: rows.length, repeat: rows.filter((c: any) => c.bookings > 1).length, bookings: rows.reduce((n: number, c: any) => n + c.bookings, 0), cancellations: rows.reduce((n: number, c: any) => n + c.cancelled, 0) } });
  });
  const customerBody = z.object({ name: z.string().trim().min(2, 'Enter the name').max(100), mobile: z.string().regex(INDIAN_MOBILE, INDIAN_MOBILE_MESSAGE), email: z.union([z.email().max(254), z.literal('')]).optional(), city: z.string().trim().min(2, 'Enter the city').max(80), note: z.string().trim().max(200).optional() });
  r.post('/customers', async (req, res) => {
    const b = parse(customerBody, req.body); const mobile = normalizePhone(b.mobile);
    try {
      const c = (await ctx.db.query(`INSERT INTO owner_customers (owner_id, name, mobile, email, city, note) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [uid(req), b.name, mobile, b.email || null, b.city, b.note || null])).rows[0];
      res.status(201).json({ customer: c });
    } catch (e: any) { if (e?.code === '23505') throw conflict('You already have a customer with this mobile number', 'customer_exists'); throw e; }
  });
  r.put('/customers/:id', async (req, res) => {
    const id = parse(z.uuid(), req.params.id); const b = parse(customerBody, req.body);
    try {
      const c = (await ctx.db.query(`UPDATE owner_customers SET name=$3, mobile=$4, email=$5, city=$6, note=$7, source='manual' WHERE id=$1 AND owner_id=$2 RETURNING *`, [id, uid(req), b.name, normalizePhone(b.mobile), b.email || null, b.city, b.note || null])).rows[0];
      if (!c) throw notFound('Customer not found');
      res.json({ customer: c });
    } catch (e: any) { if (e?.code === '23505') throw conflict('You already have a customer with this mobile number', 'customer_exists'); throw e; }
  });
  r.delete('/customers/:id', async (req, res) => {
    const gone = await ctx.db.query('DELETE FROM owner_customers WHERE id=$1 AND owner_id=$2 RETURNING id', [parse(z.uuid(), req.params.id), uid(req)]);
    if (!gone.rows[0]) throw notFound('Customer not found');
    res.status(204).end();
  });
  r.get('/customers/history', async (req, res) => {
    const id = uid(req);
    const key = parse(z.string().min(1).max(200), req.query.key);
    if (key.startsWith('manual:')) { // added by hand: their bookings are the ones that carry their mobile number
      const m = (await ctx.db.query('SELECT mobile FROM owner_customers WHERE id=$1 AND owner_id=$2', [key.slice(7), id])).rows[0];
      if (!m) throw notFound('Customer not found');
      const mine = (await ctx.db.query(
        `SELECT b.id, b.reference, b.status, b.total::float8 AS total, lower(b.during) AS starts_at, upper(b.during) AS ends_at, v.name AS venue, a.name AS area, b.payment_method, b.source, b.cancel_reason, sp.name AS sport,
              COALESCE(b.amount_paid, CASE WHEN b.status IN ('confirmed','completed') THEN b.total ELSE 0 END)::float8 AS paid
           FROM bookings b JOIN venues v ON v.id = b.venue_id JOIN playing_areas a ON a.id = b.area_id LEFT JOIN sports sp ON sp.id = b.sport_id
          WHERE v.owner_id = $1 AND b.block_kind IS NULL AND (b.walkin_phone = $2 OR b.opponent_phone = $2) ORDER BY lower(b.during) DESC LIMIT 200`, [id, m.mobile])).rows;
      return void res.json({ bookings: mine });
    }
    const { rows } = await ctx.db.query(
      `SELECT b.id, b.reference, b.status, b.total::float8 AS total, lower(b.during) AS starts_at, upper(b.during) AS ends_at, v.name AS venue, a.name AS area, b.payment_method, b.source, b.cancel_reason, sp.name AS sport,
              COALESCE(b.amount_paid, CASE WHEN b.status IN ('confirmed','completed') THEN b.total ELSE 0 END)::float8 AS paid
         FROM bookings b JOIN venues v ON v.id = b.venue_id JOIN playing_areas a ON a.id = b.area_id LEFT JOIN sports sp ON sp.id = b.sport_id
        WHERE v.owner_id = $1 AND (b.block_kind IS NULL OR b.event_kind IS NOT NULL) AND ${CUSTOMER_KEY} = $2 ORDER BY lower(b.during) DESC LIMIT 200`, [id, key]);
    res.json({ bookings: rows });
  });

  r.get('/bookings', async (req, res) => {
    const f = parse(z.object({
      venueId: z.uuid().optional(), areaId: z.uuid().optional(), sportId: z.coerce.number().int().optional(), status: z.string().max(20).optional(),
      payment: z.string().max(20).optional(), view: z.enum(['all', 'upcoming', 'history', 'cancelled']).default('all'), q: z.string().trim().max(100).optional(),
      from: z.iso.date().optional(), to: z.iso.date().optional(),
    }), req.query);
    const { limit, offset } = page(req.query, 100);
    const sql = BOOKING_SELECT
      .replace('SELECT b.id,', 'SELECT COALESCE(u.full_name, b.walkin_name) AS customer_name, COALESCE(u.email, b.walkin_email) AS customer_email, COALESCE(u.phone, b.walkin_phone) AS customer_phone, b.walkin_phone, b.walkin_city, b.notes AS booking_notes, b.owner_amount, b.commission_amount, b.source AS booking_source, b.sport_id, b.amount_paid::float8 AS amount_paid, b.advance_amount::float8 AS advance_amount, COALESCE(b.payment_discount,0)::float8 AS payment_discount, b.payment_method, b.opponent1_name, b.opponent1_phone, b.opponent1_city, b.opponent_name, b.opponent_phone, b.opponent_city, b.refund_amount::float8 AS refund_amount, b.refund_mode, b.cancel_reason, (SELECT environment FROM playing_areas pa WHERE pa.id=b.area_id) AS area_environment, count(*) OVER()::int AS total_rows, b.id,')
      .replace('FROM bookings b', 'FROM bookings b LEFT JOIN users u ON u.id=b.customer_id');
    const like = f.q ? '%' + f.q.replace(/[%_\\]/g, '\\$&') + '%' : null;
    const { rows } = await ctx.db.query(
      `${sql} WHERE v.owner_id=$1 AND b.status <> 'blocked' AND b.deleted_at IS NULL AND ($2::uuid IS NULL OR b.venue_id=$2) AND ($3::text IS NULL OR b.status=$3)
         AND ($4::date IS NULL OR (lower(b.during) AT TIME ZONE v.timezone)::date >= $4::date) AND ($5::date IS NULL OR (lower(b.during) AT TIME ZONE v.timezone)::date <= $5::date)
         AND ($6::uuid IS NULL OR b.area_id=$6) AND ($7::int IS NULL OR b.sport_id=$7) AND ($8::text IS NULL OR p.status=$8)
         AND ($9::text IS NULL OR b.reference ILIKE $9 OR COALESCE(u.full_name, b.walkin_name) ILIKE $9 OR COALESCE(u.email, b.walkin_email) ILIKE $9 OR COALESCE(u.phone, b.walkin_phone) ILIKE $9)
         AND (CASE $10::text WHEN 'upcoming' THEN b.status IN ('pending','confirmed') AND upper(b.during) > now()
                             WHEN 'history' THEN b.status IN ('confirmed','completed','no_show') AND upper(b.during) <= now()
                             WHEN 'cancelled' THEN b.status IN ('cancelled','expired') ELSE true END)
       ORDER BY CASE WHEN $10::text = 'upcoming' THEN lower(b.during) END ASC, lower(b.during) DESC LIMIT $11 OFFSET $12`,
      [uid(req), f.venueId ?? null, f.status ?? null, f.from ?? null, f.to ?? null, f.areaId ?? null, f.sportId ?? null, f.payment ?? null, like, f.view, limit, offset]);
    res.json({ bookings: rows.map(({ total_rows, ...r }: any) => r), total: rows[0]?.total_rows ?? 0 });
  });

  /** Gate check-in: look a booking up by its reference (for example PX-AB12CD) to see if it is good for entry. */
  r.post('/bookings/verify', async (req, res) => {
    const { reference } = parse(z.object({ reference: z.string().trim().min(6).max(20).transform((x) => x.toUpperCase()) }), req.body);
    const { rows } = await ctx.db.query(
      `SELECT b.reference, b.status, lower(b.during) AS starts_at, upper(b.during) AS ends_at, a.name AS area_name, v.name AS venue_name, COALESCE(u.full_name, b.walkin_name) AS customer_name, COALESCE(u.phone, b.walkin_phone) AS customer_phone
         FROM bookings b JOIN venues v ON v.id=b.venue_id JOIN playing_areas a ON a.id=b.area_id LEFT JOIN users u ON u.id=b.customer_id
        WHERE b.reference=$1 AND v.owner_id=$2`, [reference, uid(req)]);
    if (!rows[0]) throw notFound('No matching booking for your venues');
    const b = rows[0];
    res.json({ valid: b.status === 'confirmed' && new Date(b.ends_at) > ctx.now(), booking: b });
  });

  /** A walk-in: the owner books a slot for someone who is not using the app. It is confirmed at once and no online payment is taken. */
  r.post('/bookings/offline', async (req, res) => {
    const b = parse(z.object({
      areaId: z.uuid(), sportId: z.number().int().positive(), startsAt: z.iso.datetime({ offset: true }), durationMinutes: z.number().int().min(30).max(720),
      customerName: z.string().trim().min(2, "Enter the customer's name").max(100), customerPhone: z.string().regex(INDIAN_MOBILE, INDIAN_MOBILE_MESSAGE),
      customerEmail: z.union([z.email().max(254), z.literal('')]).optional(), amount: z.number().min(0).max(1000000).optional(), amountPaid: z.number().min(0).max(1000000).optional(),
      opponentName: z.string().trim().min(2).max(100).optional(), opponentPhone: z.string().regex(INDIAN_MOBILE, INDIAN_MOBILE_MESSAGE).optional(), opponentCity: z.string().trim().min(2).max(80).optional(),
      customerCity: z.string().trim().min(2).max(80).optional(), opponent1Name: z.string().trim().min(2).max(100).optional(), opponent1Phone: z.string().regex(INDIAN_MOBILE, INDIAN_MOBILE_MESSAGE).optional(), opponent1City: z.string().trim().min(2).max(80).optional(),
      eventKind: z.enum(['event', 'academic']).optional(), eventTitle: z.string().trim().min(2).max(120).optional(),
      paymentMethod: z.enum(['cash', 'upi', 'card', 'unpaid', 'online', 'offline']).default('cash'), notes: z.string().trim().max(300).optional(),
    }).refine((x) => !x.opponent1Phone || !!x.opponent1Name, { message: 'Enter the name of opponent 1', path: ['opponent1Name'] }).refine((x) => !x.opponentPhone || !!x.opponentName, { message: 'Enter the name of the opponent', path: ['opponentName'] }).refine((x) => !x.eventKind || !!x.eventTitle, { message: 'Give the event a name', path: ['eventTitle'] }), req.body);
    const out = await createOfflineBooking(ctx, req.user!, { ...b, customerPhone: normalizePhone(b.customerPhone), opponentPhone: b.opponentPhone ? normalizePhone(b.opponentPhone) : undefined, opponent1Phone: b.opponent1Phone ? normalizePhone(b.opponent1Phone) : undefined });
    res.status(201).json(out);
  });
  // ---------------- edit, delete and restore a booking the owner made (walk-in / phone bookings), and record a refund given on a cancelled one
  const loadOwn = async (q: any, id: string, ownerId: string) => {
    const b = (await q.query(`SELECT b.*, v.owner_id, lower(b.during) AS s, upper(b.during) AS e FROM bookings b JOIN venues v ON v.id=b.venue_id WHERE b.id=$1 FOR UPDATE OF b`, [id])).rows[0];
    if (!b) throw notFound('Booking not found');
    if (b.owner_id !== ownerId) throw forbidden();
    if (b.source !== 'offline') throw badRequest('Only bookings you made yourself can be edited here. Online bookings are paid through PlaynX.', 'not_offline');
    return b;
  };
  const cityField = z.string().trim().min(2).max(80);
  r.patch('/bookings/:id', async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    const b = parse(z.object({
      customerName: z.string().trim().min(2).max(100).optional(), customerPhone: z.string().regex(INDIAN_MOBILE, INDIAN_MOBILE_MESSAGE).optional(), customerCity: cityField.optional(), note: z.string().trim().max(200).optional(),
      opponent1Name: z.string().trim().min(2).max(100).optional(), opponent1Phone: z.string().regex(INDIAN_MOBILE, INDIAN_MOBILE_MESSAGE).optional(), opponent1City: cityField.optional(),
      opponentName: z.string().trim().min(2).max(100).optional(), opponentPhone: z.string().regex(INDIAN_MOBILE, INDIAN_MOBILE_MESSAGE).optional(), opponentCity: cityField.optional(),
      startsAt: z.iso.datetime({ offset: true }).optional(), durationMinutes: z.number().int().min(30).max(720).optional(), price: z.number().min(0).max(1000000).optional(),
      payment: z.object({ status: z.enum(['paid', 'partial', 'unpaid']), amountPaid: z.number().min(0).max(1000000).optional(), mode: z.enum(['online', 'offline']).optional() }).optional(),
      refund: z.object({ amount: z.number().min(0).max(1000000), mode: z.enum(['online', 'offline']).optional() }).optional(),
    }), req.body);
    const out = await ctx.db.tx(async (q) => {
      const cur = await loadOwn(q, id, uid(req));
      if (cur.deleted_at) throw conflict('This booking was deleted. Restore it first.', 'deleted');
      const set: string[] = []; const vals: unknown[] = [id]; const add = (col: string, v: unknown) => { vals.push(v); set.push(`${col}=$${vals.length}`); };
      if (b.customerName !== undefined) add('walkin_name', b.customerName);
      if (b.customerPhone !== undefined) add('walkin_phone', normalizePhone(b.customerPhone));
      if (b.customerCity !== undefined) add('walkin_city', b.customerCity);
      if (b.note !== undefined) add('notes', b.note || null);
      if (b.opponent1Name !== undefined) add('opponent1_name', b.opponent1Name);
      if (b.opponent1Phone !== undefined) add('opponent1_phone', normalizePhone(b.opponent1Phone));
      if (b.opponent1City !== undefined) add('opponent1_city', b.opponent1City);
      if (b.opponentName !== undefined) add('opponent_name', b.opponentName);
      if (b.opponentPhone !== undefined) add('opponent_phone', normalizePhone(b.opponentPhone));
      if (b.opponentCity !== undefined) add('opponent_city', b.opponentCity);
      let total = Number(cur.total);
      if (b.startsAt || b.durationMinutes) { // move it to another slot: an upcoming confirmed booking only, checked like a new booking
        if (cur.status !== 'confirmed' || new Date(cur.s) <= ctx.now()) throw conflict('Only an upcoming booking can move to another date or slot.', 'not_movable');
        const ac = await loadAreaContext(q, cur.area_id, cur.sport_id, true);
        const dur = b.durationMinutes ?? Math.round((new Date(cur.e).getTime() - new Date(cur.s).getTime()) / 60000);
        const qt = await quote(q, ac, cur.sport_id, b.startsAt ?? new Date(cur.s).toISOString(), dur);
        if (qt.endsAt.getTime() <= ctx.now().getTime()) throw badRequest('That time has already passed', 'past');
        vals.push(qt.startsAt.toISOString(), qt.endsAt.toISOString()); set.push(`during=tstzrange($${vals.length - 1}::timestamptz,$${vals.length}::timestamptz,'[)')`);
        if (b.price === undefined) total = qt.price;
      }
      if (b.price !== undefined) total = b.price;
      if (total !== Number(cur.total)) { add('subtotal', total); add('total', total); add('owner_amount', total); add('discount', 0); }
      let paid = Number(cur.amount_paid ?? 0);
      if (b.payment) {
        if (b.payment.status !== 'unpaid' && !b.payment.mode) throw badRequest('Choose the mode of payment', 'validation_error');
        paid = b.payment.status === 'paid' ? total : b.payment.status === 'partial' ? (b.payment.amountPaid ?? 0) : 0;
        if (b.payment.status === 'partial' && !(paid > 0 && paid < total)) throw badRequest(`Enter an initial payment more than 0 and less than ₹${total}`, 'validation_error');
        add('payment_method', b.payment.status === 'unpaid' ? 'unpaid' : b.payment.mode);
      }
      if (paid > total) paid = total; // a lower price never leaves more paid than the booking costs
      if (paid !== Number(cur.amount_paid ?? 0)) add('amount_paid', paid);
      if (b.refund) {
        if (cur.status !== 'cancelled') throw badRequest('A refund can be recorded only on a cancelled booking.', 'not_cancelled');
        if (b.refund.amount > Number(cur.amount_paid ?? 0) + 0.001) throw badRequest(`The refund cannot be more than the ₹${Number(cur.amount_paid ?? 0)} the customer paid.`, 'validation_error');
        if (b.refund.amount > 0 && !b.refund.mode) throw badRequest('Choose the mode of refund', 'validation_error');
        add('refund_amount', b.refund.amount); add('refund_mode', b.refund.amount > 0 ? b.refund.mode : null);
      }
      if (!set.length) return { id } as { id: string; venueId?: string; areaId?: string };
      try { await q.query(`UPDATE bookings SET ${set.join(', ')} WHERE id=$1`, vals); }
      catch (e: any) { if (e?.code === '23P01') throw conflict('That slot is already booked or blocked', 'slot_unavailable'); throw e; }
      await audit(q, req, 'booking.edited', 'booking', id, { fields: set.map((x) => x.split('=')[0]) });
      return { id, venueId: cur.venue_id as string, areaId: cur.area_id as string };
    });
    if (out.venueId) ctx.realtime.toVenue(out.venueId, 'slots:changed', { areaId: out.areaId });
    res.json({ updated: true });
  });
  r.delete('/bookings/:id', async (req, res) => {
    const id = parse(z.uuid(), req.params.id); const { reason } = parse(z.object({ reason: z.string().trim().max(200).optional() }), req.body ?? {});
    const cur = await ctx.db.tx(async (q) => {
      const row = await loadOwn(q, id, uid(req));
      if (row.deleted_at) throw conflict('This booking is already deleted', 'deleted');
      await q.query(`UPDATE bookings SET deleted_at=now(), deleted_by=$2, delete_reason=$3, prev_status=status, status=CASE WHEN status IN ('confirmed','pending') THEN 'cancelled' ELSE status END, cancelled_at=COALESCE(cancelled_at, now()), cancelled_by=COALESCE(cancelled_by, 'venue') WHERE id=$1`, [id, uid(req), reason || null]);
      await audit(q, req, 'booking.deleted', 'booking', id, { reason: reason ?? null });
      return row;
    });
    ctx.realtime.toVenue(cur.venue_id, 'slots:changed', { areaId: cur.area_id });
    res.status(204).end();
  });
  r.post('/bookings/:id/restore', async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    const cur = await ctx.db.tx(async (q) => {
      const row = await loadOwn(q, id, uid(req));
      if (!row.deleted_at && row.status !== 'cancelled') throw conflict('This booking is not cancelled or deleted', 'not_restorable');
      if (new Date(row.s) <= ctx.now()) throw conflict('Its slot has already started, so it cannot be restored.', 'started');
      try { await q.query(`UPDATE bookings SET status=COALESCE(prev_status, 'confirmed'), deleted_at=NULL, deleted_by=NULL, delete_reason=NULL, prev_status=NULL, cancelled_at=NULL, cancel_reason=NULL, cancelled_by=NULL, refund_amount=0, refund_mode=NULL WHERE id=$1`, [id]); }
      catch (e: any) { if (e?.code === '23P01') throw conflict('That slot is no longer free, so the booking cannot be restored.', 'slot_unavailable'); throw e; }
      await audit(q, req, 'booking.restored', 'booking', id);
      return row;
    });
    ctx.realtime.toVenue(cur.venue_id, 'slots:changed', { areaId: cur.area_id });
    res.json({ restored: true });
  });
  // ---------------- pending payments (walk-in bookings paid in parts) and "record payment"
  r.get('/pending-payments', async (req, res) => {
    const id = uid(req);
    const { rows } = await ctx.db.query(
      `SELECT b.id, b.reference, b.total::float8 AS total, COALESCE(b.amount_paid,0)::float8 AS paid, COALESCE(b.payment_discount,0)::float8 AS discount, (b.total - COALESCE(b.amount_paid,0) - COALESCE(b.payment_discount,0))::float8 AS pending,
              lower(b.during) AS starts_at, v.name AS venue, a.name AS area, b.walkin_name AS name, b.walkin_phone AS mobile
         FROM bookings b JOIN venues v ON v.id=b.venue_id JOIN playing_areas a ON a.id=b.area_id
        WHERE v.owner_id=$1 AND b.deleted_at IS NULL AND b.source='offline' AND (b.block_kind IS NULL OR b.event_kind IS NOT NULL) AND b.status IN ('confirmed','completed','blocked') AND b.total - COALESCE(b.amount_paid,0) - COALESCE(b.payment_discount,0) > 0
        ORDER BY lower(b.during)`, [id]);
    const byCustomer = new Map<string, any>();
    for (const b of rows) {
      const key = b.mobile || b.name || 'unknown';
      const c = byCustomer.get(key) ?? { key, name: b.name ?? 'Walk-in customer', mobile: b.mobile, total: 0, paid: 0, pending: 0, bills: [] };
      c.total += b.total; c.paid += b.paid; c.pending += b.pending; c.bills.push(b); byCustomer.set(key, c);
    }
    res.json({ customers: [...byCustomer.values()], totalPending: rows.reduce((n: number, b: any) => n + b.pending, 0) });
  });
  r.post('/bookings/:id/payments', async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    const b = parse(z.object({ amount: z.number().min(0).max(1000000).default(0), discount: z.number().min(0).max(1000000).default(0), mode: z.enum(['cash', 'upi', 'card', 'online', 'offline']).optional(), note: z.string().trim().max(200).optional() })
      .refine((x) => x.amount > 0 || x.discount > 0, { message: 'Enter an amount received or a discount', path: ['amount'] })
      .refine((x) => x.amount === 0 || !!x.mode, { message: 'Choose the mode of payment', path: ['mode'] }), req.body);
    const out = await ctx.db.tx(async (q) => {
      const bk = (await q.query(`SELECT b.id, b.total, COALESCE(b.amount_paid,0) AS paid, COALESCE(b.payment_discount,0) AS disc, b.status, b.source, b.event_kind, b.advance_amount FROM bookings b JOIN venues v ON v.id=b.venue_id WHERE b.id=$1 AND v.owner_id=$2 FOR UPDATE OF b`, [id, uid(req)])).rows[0];
      if (!bk) throw notFound('Booking not found');
      if (bk.source !== 'offline' && bk.advance_amount == null) throw badRequest('Online bookings are paid through PlaynX. Only walk-in bookings can have payments recorded here.', 'not_offline');
      if (!['confirmed', 'completed'].includes(bk.status) && !(bk.status === 'blocked' && bk.event_kind)) throw badRequest('This booking is not active', 'not_active');
      const due = Math.round((Number(bk.total) - Number(bk.paid) - Number(bk.disc)) * 100) / 100;
      if (b.amount + b.discount > due + 0.001) throw badRequest(`Only ₹${due} is pending on this booking`, 'overpayment');
      await q.query(`INSERT INTO booking_payments (booking_id, amount, discount, mode, note, recorded_by) VALUES ($1,$2,$3,$4,$5,$6)`, [id, b.amount, b.discount, b.mode ?? 'offline', b.note ?? null, uid(req)]);
      const u = (await q.query(`UPDATE bookings SET amount_paid = COALESCE(amount_paid,0) + $2, payment_discount = COALESCE(payment_discount,0) + $4, payment_method = CASE WHEN payment_method='unpaid' AND $3 IN ('cash','upi','card') AND $2 > 0 THEN $3 ELSE payment_method END WHERE id=$1 RETURNING total::float8 AS total, amount_paid::float8 AS paid, payment_discount::float8 AS discount`, [id, b.amount, b.mode ?? 'offline', b.discount])).rows[0];
      await audit(q, req, 'booking.payment_recorded', 'booking', id, { amount: b.amount, discount: b.discount, mode: b.mode });
      return { total: u.total, paid: u.paid, discount: u.discount, pending: Math.round((u.total - u.paid - u.discount) * 100) / 100 };
    });
    res.status(201).json(out);
  });
  r.post('/bookings/:id/cancel', async (req, res) => {
    const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(300) }), req.body);
    res.json(await cancelBooking(ctx, req.user!, parse(z.uuid(), req.params.id), reason));
  });

  // ---------------- earnings, transactions, payouts, reports
  r.get('/earnings', async (req, res) => {
    const id = uid(req);
    const [sum, monthly, byVenue, payouts] = await Promise.all([
      ctx.db.query(`SELECT COALESCE(sum(b.total),0)::float8 AS gross, COALESCE(sum(b.commission_amount),0)::float8 AS commission, COALESCE(sum(b.owner_amount),0)::float8 AS net
          FROM bookings b JOIN venues v ON v.id=b.venue_id WHERE v.owner_id=$1 AND b.status IN ('confirmed','completed')`, [id]),
      ctx.db.query(`SELECT to_char(date_trunc('month', lower(b.during)), 'YYYY-MM') AS month, count(*)::int AS bookings, sum(b.owner_amount)::float8 AS net
          FROM bookings b JOIN venues v ON v.id=b.venue_id WHERE v.owner_id=$1 AND b.status IN ('confirmed','completed') GROUP BY 1 ORDER BY 1 DESC LIMIT 12`, [id]),
      ctx.db.query(`SELECT v.id, v.name, count(*)::int AS bookings, sum(b.owner_amount)::float8 AS net
          FROM bookings b JOIN venues v ON v.id=b.venue_id WHERE v.owner_id=$1 AND b.status IN ('confirmed','completed') GROUP BY v.id, v.name ORDER BY net DESC`, [id]),
      ctx.db.query(`SELECT COALESCE(sum(amount) FILTER (WHERE status='paid'),0)::float8 AS paid, COALESCE(sum(amount) FILTER (WHERE status='pending'),0)::float8 AS pending FROM owner_payouts WHERE owner_id=$1`, [id]),
    ]);
    res.json({ summary: sum.rows[0], monthly: monthly.rows, byVenue: byVenue.rows, payouts: payouts.rows[0] });
  });
  r.get('/payouts', async (req, res) =>
    res.json({ payouts: (await ctx.db.query('SELECT * FROM owner_payouts WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 100', [uid(req)])).rows }));
  /**
   * Account: where the money of each PlaynX booking stands. Gross value is what the customer pays. The owner's share waits
   * "On hold" until the hold time after the game has passed; then it is "Ready to pay" (the gross value less the platform fee),
   * or, when the customer raised a complaint on that booking, the full amount stays with PlaynX under "Dispute" until it is
   * settled (what is refunded to the customer is shown there).
   */
  r.get('/payout-status', async (req, res) => {
    const hours = await holdHours(ctx.db); const now = ctx.now();
    const { rows } = await ctx.db.query(
      `SELECT b.id, b.reference, b.status, lower(b.during) AS starts_at, upper(b.during) AS ends_at, COALESCE(b.advance_amount, b.total)::float8 AS gross, COALESCE(b.commission_amount,0)::float8 AS fee, (CASE WHEN b.advance_amount IS NOT NULL THEN GREATEST(0, b.advance_amount - COALESCE(b.commission_amount,0)) ELSE COALESCE(b.owner_amount,0) END)::float8 AS owner_amount,
              v.name AS venue_name, a.name AS area_name, COALESCE(u.full_name, b.walkin_name) AS customer_name,
              EXISTS (SELECT 1 FROM support_tickets t WHERE t.booking_id=b.id AND t.user_id=b.customer_id AND t.status IN ('open','in_progress')) AS disputed,
              (SELECT COALESCE(sum(r.amount),0)::float8 FROM refunds r JOIN payments p ON p.id=r.payment_id WHERE p.booking_id=b.id AND r.status='processed') AS refunded,
              (SELECT COALESCE(sum(r.amount),0)::float8 FROM refunds r WHERE r.booking_id=b.id AND r.status <> 'failed' AND r.reason LIKE 'Complaint%') AS complaint_refund
         FROM bookings b JOIN venues v ON v.id=b.venue_id JOIN playing_areas a ON a.id=b.area_id LEFT JOIN users u ON u.id=b.customer_id
        WHERE v.owner_id=$1 AND b.source <> 'offline' AND b.block_kind IS NULL AND b.deleted_at IS NULL AND b.status IN ('confirmed','completed')
        ORDER BY lower(b.during) DESC LIMIT 500`, [uid(req)]);
    const r2 = (x: number) => Math.round(x * 100) / 100;
    const out = rows.map((b: any) => {
      const rel = releaseOf(b.ends_at, now, hours, b.status, b.disputed);
      const state = rel.state === 'complaint' ? 'dispute' : rel.state === 'released' ? 'ready' : 'hold';
      return { id: b.id, reference: b.reference, venue_name: b.venue_name, area_name: b.area_name, customer_name: b.customer_name, starts_at: b.starts_at, release_at: rel.releaseAt, state,
        gross: b.gross, fee: b.fee, on_hold: state === 'hold' ? b.owner_amount : 0, ready_to_pay: state === 'ready' ? b.owner_amount : 0,
        // an open complaint holds the whole booking; a settled one leaves what was refunded to the customer under Dispute
        dispute: state === 'dispute' ? b.gross : b.complaint_refund, refunded: b.refunded, complaint_refund: b.complaint_refund };
    });
    const sum = (k: string) => r2(out.reduce((n: number, x: any) => n + (x[k] || 0), 0));
    res.json({ holdHours: hours, totals: { gross: sum('gross'), fee: sum('fee'), on_hold: sum('on_hold'), ready_to_pay: sum('ready_to_pay'), dispute: sum('dispute') }, bookings: out });
  });
  r.get('/transactions', async (req, res) => {
    const f = parse(z.object({ q: z.string().trim().max(100).optional(), status: z.string().max(20).optional(), from: z.iso.date().optional(), to: z.iso.date().optional() }), req.query);
    const { limit, offset } = page(req.query, 100);
    const like = f.q ? '%' + f.q.replace(/[%_\\]/g, '\\$&') + '%' : null;
    const { rows } = await ctx.db.query(
      `SELECT p.id, p.amount, p.status, p.method, p.paid_at, p.created_at, p.razorpay_payment_id, b.id AS booking_id, b.reference, CASE WHEN b.is_split THEN b.subtotal * p.amount / NULLIF(b.total,0) WHEN b.series_id IS NULL THEN b.subtotal ELSE (SELECT sum(x.subtotal) FROM bookings x WHERE x.series_id=b.series_id) END AS subtotal, CASE WHEN b.is_split THEN b.discount * p.amount / NULLIF(b.total,0) WHEN b.series_id IS NULL THEN b.discount ELSE (SELECT sum(x.discount) FROM bookings x WHERE x.series_id=b.series_id) END AS discount,
         CASE WHEN b.is_split THEN b.owner_amount * p.amount / NULLIF(b.total,0) WHEN b.series_id IS NULL THEN b.owner_amount ELSE (SELECT sum(x.owner_amount) FROM bookings x WHERE x.series_id=b.series_id) END AS owner_amount, CASE WHEN b.is_split THEN b.commission_amount * p.amount / NULLIF(b.total,0) WHEN b.series_id IS NULL THEN b.commission_amount ELSE (SELECT sum(x.commission_amount) FROM bookings x WHERE x.series_id=b.series_id) END AS commission_amount,
         b.commission_rate, (SELECT count(*)::int FROM bookings x WHERE x.series_id=b.series_id) AS series_count, b.status AS booking_status, upper(b.during) AS ends_at,
         EXISTS (SELECT 1 FROM support_tickets t WHERE t.booking_id=b.id AND t.user_id=b.customer_id AND t.status IN ('open','in_progress')) AS disputed,
         v.name AS venue_name, COALESCE(py.full_name, u.full_name) AS customer_name, count(*) OVER()::int AS total_rows,
         (SELECT COALESCE(sum(r.amount),0)::float8 FROM refunds r WHERE r.payment_id=p.id AND r.status='processed') AS refunded
         FROM payments p JOIN bookings b ON b.id=p.booking_id JOIN venues v ON v.id=b.venue_id JOIN users u ON u.id=b.customer_id LEFT JOIN users py ON py.id=p.payer_id
        WHERE v.owner_id=$1 AND p.status <> 'created' AND ($2::text IS NULL OR p.status=$2)
          AND ($3::text IS NULL OR b.reference ILIKE $3 OR u.full_name ILIKE $3 OR p.razorpay_payment_id ILIKE $3)
          AND ($4::date IS NULL OR COALESCE(p.paid_at, p.created_at)::date >= $4::date) AND ($5::date IS NULL OR COALESCE(p.paid_at, p.created_at)::date <= $5::date)
        ORDER BY COALESCE(p.paid_at, p.created_at) DESC LIMIT $6 OFFSET $7`, [uid(req), f.status ?? null, like, f.from ?? null, f.to ?? null, limit, offset]);
    const hours = await holdHours(ctx.db); const now = ctx.now();
    // money that went back to the customer is neither a platform fee nor the owner's earning: both shrink by the refunded share of the payment
    const kept = (t: any) => { const paid = Number(t.amount) || 0; return t.status === 'refunded' ? 0 : paid > 0 ? Math.max(0, 1 - Number(t.refunded ?? 0) / paid) : 1; };
    const money2 = (n: unknown, k: number) => (n == null ? n : Math.round(Number(n) * k * 100) / 100);
    res.json({ transactions: rows.map(({ total_rows, razorpay_payment_id, disputed, ...t }: any) => ({ ...t, commission_amount: money2(t.commission_amount, kept(t)), owner_amount: money2(t.owner_amount, kept(t)), transaction_id: razorpay_payment_id ? '…' + String(razorpay_payment_id).slice(-8) : t.id.slice(0, 8),
      release_at: releaseOf(t.ends_at, now, hours, t.booking_status, disputed).releaseAt, release_state: releaseOf(t.ends_at, now, hours, t.booking_status, disputed).state })), total: rows[0]?.total_rows ?? 0 });
  });
  /** One month of the owner's online earnings as a CSV: what each booking made, what PlaynX kept, and when each payout is released. */
  r.get('/statements/monthly.csv', async (req, res) => {
    const f = parse(z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }), req.query);
    const hours = await holdHours(ctx.db); const now = ctx.now();
    const { rows } = await ctx.db.query(
      `SELECT b.reference, lower(b.during) AS starts_at, upper(b.during) AS ends_at, b.status, b.subtotal, b.discount, b.total, b.commission_amount, b.owner_amount,
              v.name AS venue_name, a.name AS area_name, u.full_name AS customer_name,
              EXISTS (SELECT 1 FROM support_tickets t WHERE t.booking_id=b.id AND t.user_id=b.customer_id AND t.status IN ('open','in_progress')) AS disputed
         FROM bookings b JOIN venues v ON v.id=b.venue_id JOIN playing_areas a ON a.id=b.area_id JOIN users u ON u.id=b.customer_id
        WHERE v.owner_id=$1 AND b.source='online' AND b.status IN ('confirmed','completed')
          AND to_char(lower(b.during) AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM')=$2 ORDER BY lower(b.during)`, [uid(req), f.month]);
    const out: Record<string, unknown>[] = rows.map((r: any) => { const rel = releaseOf(r.ends_at, now, hours, r.status, r.disputed);
      return { booking: r.reference, game_date: new Date(r.starts_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }), venue: r.venue_name, area: r.area_name, customer: r.customer_name,
        booking_amount: r.subtotal, discount: r.discount, customer_paid: r.total, playnx_commission: r.commission_amount, you_earn: r.owner_amount,
        release_date: rel.releaseAt ? new Date(rel.releaseAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) : '', payout_status: rel.state }; });
    const sum = (k: string) => Math.round(rows.reduce((n: number, r: any) => n + Number(r[k]), 0) * 100) / 100;
    if (out.length) out.push({ booking: 'TOTAL', game_date: '', venue: '', area: '', customer: '', booking_amount: sum('subtotal'), discount: sum('discount'), customer_paid: sum('total'), playnx_commission: sum('commission_amount'), you_earn: sum('owner_amount'), release_date: '', payout_status: '' });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="statement-${f.month}.csv"`);
    res.send(out.length ? csv(out) : 'No online bookings this month');
  });
  r.get('/reports/bookings.csv', async (req, res) => {
    const f = parse(z.object({ from: z.iso.date(), to: z.iso.date() }), req.query);
    const { rows } = await ctx.db.query(
      `SELECT b.reference, v.name AS venue, a.name AS area, sp.name AS sport, COALESCE(u.full_name, b.walkin_name) AS customer, b.source, lower(b.during) AS start, upper(b.during) AS "end", b.status,
              b.subtotal, b.discount, b.total, b.commission_amount AS commission, b.owner_amount AS net
         FROM bookings b JOIN venues v ON v.id=b.venue_id JOIN playing_areas a ON a.id=b.area_id LEFT JOIN users u ON u.id=b.customer_id LEFT JOIN sports sp ON sp.id=b.sport_id
        WHERE v.owner_id=$1 AND lower(b.during) >= $2::date AND lower(b.during) < $3::date + 1 ORDER BY lower(b.during)`, [uid(req), f.from, f.to]);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="bookings-${f.from}-${f.to}.csv"`);
    res.send(rows.length ? csv(rows) : 'No bookings in this period');
  });

  // ---------------- offers (venue-scoped coupons)
  const couponSchema = z.object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,20}$/), description: z.string().trim().max(200).optional(), venueId: z.uuid(),
    discountType: z.enum(['percent', 'flat']), value: z.number().positive(), maxDiscount: z.number().positive().optional(), minAmount: z.number().min(0).default(0),
    validFrom: z.iso.datetime({ offset: true }).optional(), validTo: z.iso.datetime({ offset: true }), usageLimit: z.number().int().positive().optional(), perUserLimit: z.number().int().positive().default(1),
  }).refine((c) => c.discountType !== 'percent' || c.value <= 100, { message: 'Percent discount cannot exceed 100', path: ['value'] });
  r.get('/coupons', async (req, res) =>
    res.json({ coupons: (await ctx.db.query(`SELECT c.*, v.name AS venue_name FROM coupons c JOIN venues v ON v.id=c.venue_id WHERE v.owner_id=$1 ORDER BY c.valid_to DESC`, [uid(req)])).rows }));
  r.post('/coupons', async (req, res) => {
    const b = parse(couponSchema, req.body);
    await ownVenue(b.venueId, uid(req));
    const { rows } = await ctx.db.query(
      `INSERT INTO coupons (code, description, discount_type, value, max_discount, min_amount, valid_from, valid_to, usage_limit, per_user_limit, venue_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::timestamptz, now()),$8,$9,$10,$11,$12) RETURNING *`,
      [b.code, b.description ?? null, b.discountType, b.value, b.maxDiscount ?? null, b.minAmount, b.validFrom ?? null, b.validTo, b.usageLimit ?? null, b.perUserLimit, b.venueId, uid(req)]);
    await ctx.notifier.notifyAdmins('coupons', { title: 'New owner offer created', body: `${req.user!.fullName} created coupon ${b.code}.`, type: 'admin_coupon_created', data: { link: '/admin/coupons' } });
    res.status(201).json({ coupon: rows[0] });
  });
  r.patch('/coupons/:id', async (req, res) => {
    const { isActive } = parse(z.object({ isActive: z.boolean() }), req.body);
    const { rows } = await ctx.db.query(`UPDATE coupons c SET is_active=$2 FROM venues v WHERE c.id=$1 AND v.id=c.venue_id AND v.owner_id=$3 RETURNING c.*`, [parse(z.uuid(), req.params.id), isActive, uid(req)]);
    if (!rows[0]) throw notFound('Coupon not found');
    res.json({ coupon: rows[0] });
  });

  // ---------------- reviews
  r.get('/reviews', async (req, res) => {
    const { rows } = await ctx.db.query(
      `SELECT rv.id, rv.rating, rv.comment, rv.owner_reply, rv.created_at, rv.is_hidden, v.name AS venue_name, u.full_name AS author
         FROM reviews rv JOIN venues v ON v.id=rv.venue_id JOIN users u ON u.id=rv.customer_id WHERE v.owner_id=$1 ORDER BY rv.created_at DESC LIMIT 200`, [uid(req)]);
    res.json({ reviews: rows });
  });
  r.post('/reviews/:id/reply', async (req, res) => {
    const { reply } = parse(z.object({ reply: z.string().trim().min(1).max(1000) }), req.body);
    const { rows } = await ctx.db.query(`UPDATE reviews rv SET owner_reply=$2 FROM venues v WHERE rv.id=$1 AND v.id=rv.venue_id AND v.owner_id=$3 RETURNING rv.*`, [parse(z.uuid(), req.params.id), reply, uid(req)]);
    if (!rows[0]) throw notFound('Review not found');
    res.json({ review: rows[0] });
  });

  return r;
}
