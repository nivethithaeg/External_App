import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import type { Ctx } from '../types.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { HttpError, notFound } from '../errors.js';
import { parse } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { jusgoInboundStatus } from '../lib/jusgoBookings.js';

/*
 * Booking sync for partner apps such as JusGo. A venue owner makes an API key in the owner portal and gives it to the partner,
 * which then reads that owner's venues and bookings every few minutes:
 *   GET /api/playnx/venues     the owner's approved venues and their playing areas ("courts")
 *   GET /api/playnx/bookings   bookings, blocks and cancellations, optionally only those changed since a time
 * The key goes in the Authorization header as "Bearer <key>" (the key on its own is accepted too). Only the owner's own data is returned,
 * and no customer contact details.
 */

const hashKey = (key: string) => crypto.createHash('sha256').update(`playnx-sync:${key}`).digest('hex');

/** The owner side: make, replace and remove the key. */
export function ownerSyncKeyRoutes(ctx: Ctx) {
  const r = Router();
  r.use('/sync-key', authenticate(ctx), requireRole('owner'));
  r.get('/sync-key', async (req, res) => {
    const k = (await ctx.db.query('SELECT key_prefix, created_at, last_used_at FROM owner_sync_keys WHERE owner_id=$1', [req.user!.id])).rows[0];
    // and whether bookings made on JusGo are reaching PlaynX (shown on the same page)
    res.json({ key: k ? { prefix: k.key_prefix, createdAt: k.created_at, lastUsedAt: k.last_used_at } : null,
      inbound: { configured: !!ctx.jusgo?.configured, ...jusgoInboundStatus } });
  });
  /** Makes a new key, replacing any old one (which stops working at once). The key is returned this one time only. */
  r.post('/sync-key', async (req, res) => {
    const key = `pnx_${crypto.randomBytes(24).toString('base64url')}`;
    const prefix = key.slice(0, 10);
    await ctx.db.query(
      `INSERT INTO owner_sync_keys (owner_id, key_hash, key_prefix) VALUES ($1,$2,$3)
       ON CONFLICT (owner_id) DO UPDATE SET key_hash=EXCLUDED.key_hash, key_prefix=EXCLUDED.key_prefix, created_at=now(), last_used_at=NULL`, [req.user!.id, hashKey(key), prefix]);
    await audit(ctx.db, req, 'sync_key.created', 'user', req.user!.id, { prefix });
    res.status(201).json({ key, prefix });
  });
  r.delete('/sync-key', async (req, res) => {
    const { rowCount } = await ctx.db.query('DELETE FROM owner_sync_keys WHERE owner_id=$1', [req.user!.id]);
    if (!rowCount) throw notFound('There is no key to remove');
    await audit(ctx.db, req, 'sync_key.revoked', 'user', req.user!.id, {});
    res.status(204).end();
  });
  return r;
}

/** The partner side, mounted at /api/playnx. */
export function partnerSyncRoutes(ctx: Ctx) {
  const r = Router();
  r.use(async (req: any, _res, next) => {
    try {
      const raw = String(req.get('authorization') ?? '').trim().replace(/^Bearer\s+/i, '');
      // without a key both lists are public: every published venue, and when its slots are taken (no booking references, no customer details)
      if (!raw && req.method === 'GET' && (req.path === '/venues' || req.path === '/bookings')) { req.syncOwnerId = null; return next(); }
      if (!raw) throw new HttpError(401, 'Send the PlaynX API key in the Authorization header: "Bearer <key>"', 'missing_key');
      const k = (await ctx.db.query('UPDATE owner_sync_keys SET last_used_at=now() WHERE key_hash=$1 RETURNING owner_id', [hashKey(raw)])).rows[0];
      if (!k) throw new HttpError(401, 'This API key is not valid. Make a new one in the PlaynX owner portal (JusGo sync).', 'invalid_key');
      req.syncOwnerId = k.owner_id;
      next();
    } catch (e) { next(e); }
  });

  /** JusGo's catalog shape (Partner API, "Your own ids"): JusGo pairs these ids with its venues and courts. */
  r.get('/venues', async (req: any, res) => {
    const { rows } = await ctx.db.query(
      `SELECT v.id, v.name, v.address, v.city, v.state, v.pincode, v.timezone, v.lat::float8 AS lat, v.lng::float8 AS lng,
              COALESCE((SELECT json_agg(json_build_object('id', a.id, 'name', a.name, 'slotMinutes', a.slot_minutes, 'isActive', a.is_active,
                  'sportTypes', (SELECT COALESCE(json_agg(sp.name ORDER BY sp.name), '[]') FROM playing_area_sports s JOIN sports sp ON sp.id=s.sport_id WHERE s.playing_area_id=a.id))
                  ORDER BY a.name) FROM playing_areas a WHERE a.venue_id=v.id), '[]') AS areas
         FROM venues v
        WHERE CASE WHEN $1::uuid IS NULL THEN v.status = 'approved'                          -- no key: every published venue
                   ELSE v.owner_id = $1::uuid AND v.status IN ('ready','approved') END        -- a key: that owner's approved venues
        ORDER BY v.name`, [req.syncOwnerId]);
    res.json({ venues: rows.map((v: any) => ({
      id: v.id, name: v.name, city: v.city, postalCode: v.pincode, state: v.state, address: v.address, latitude: v.lat, longitude: v.lng, timezone: v.timezone,
      playingAreas: v.areas, courts: v.areas, // "courts" kept for anyone already reading it
    })) });
  });

  /**
   * JusGo's booking feed (Partner API, "To JusGo: Webhook or feed"): JusGo calls this every few minutes with ?since=<the newest updatedAt it has seen>
   * and gets { bookings: [{ id, playingAreaId, venueId, start, end, status, updatedAt, ... }], hasMore }, oldest change first, at most 500.
   * Customer bookings and the owner's paid events are sent; plain blocked times are not (JusGo takes blocked times only from the owner in JusGo).
   */
  r.get('/bookings', async (req: any, res) => {
    const q = parse(z.object({
      since: z.iso.datetime({ offset: true }).optional(),
      from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional(), // the period of play; default: yesterday to 90 days ahead
      venueId: z.uuid().optional(),
    }), req.query);
    const now = ctx.now();
    const from = q.from ?? new Date(now.getTime() - 86400000).toISOString();
    const to = q.to ?? new Date(now.getTime() + 90 * 86400000).toISOString();
    const keyed = !!req.syncOwnerId;
    const params: unknown[] = [req.syncOwnerId, from, to, q.since ?? null, q.venueId ?? null];
    const scope = `(CASE WHEN $1::uuid IS NULL THEN v.status = 'approved' ELSE v.owner_id = $1::uuid END) AND ($5::uuid IS NULL OR v.id = $5::uuid)`;
    const { rows } = await ctx.db.query(
      `SELECT b.id, v.id AS venue_id, a.id AS area_id, lower(b.during) AS starts_at, upper(b.during) AS ends_at, b.status, b.event_kind, b.deleted_at, b.sync_updated_at,
              COALESCE(u.full_name, b.walkin_name) AS customer_name, COALESCE(u.phone, b.walkin_phone) AS customer_mobile, b.total::float8 AS total
         FROM bookings b JOIN venues v ON v.id=b.venue_id JOIN playing_areas a ON a.id=b.area_id LEFT JOIN users u ON u.id=b.customer_id
        WHERE ${scope} AND upper(b.during) > $2::timestamptz AND lower(b.during) < $3::timestamptz
          AND (b.status IN ('confirmed','completed','no_show','cancelled') OR (b.status = 'blocked' AND b.event_kind IS NOT NULL))
          AND ($4::timestamptz IS NULL OR b.sync_updated_at >= $4::timestamptz)
        ORDER BY b.sync_updated_at LIMIT 501`, params);
    const removed = (await ctx.db.query(
      `SELECT r.booking_id AS id, r.venue_id, r.area_id, r.starts_at, r.ends_at, r.removed_at
         FROM booking_sync_removed r JOIN venues v ON v.id=r.venue_id
        WHERE ${scope} AND r.ends_at > $2::timestamptz AND r.starts_at < $3::timestamptz AND ($4::timestamptz IS NULL OR r.removed_at >= $4::timestamptz)
        ORDER BY r.removed_at LIMIT 501`, params)).rows;
    const iso = (d: any) => new Date(d).toISOString();
    const STATUS: Record<string, string> = { confirmed: 'CONFIRMED', blocked: 'CONFIRMED', completed: 'COMPLETED', no_show: 'NO_SHOW', cancelled: 'CANCELLED' };
    const all = [
      ...rows.map((b: any) => ({
        id: b.id, playingAreaId: b.area_id, venueId: b.venue_id, start: iso(b.starts_at), end: iso(b.ends_at),
        status: b.deleted_at ? 'CANCELLED' : STATUS[b.status], updatedAt: iso(b.sync_updated_at),
        // the owner's own customers, sent only with the owner's key: JusGo shows them to that same venue owner
        ...(keyed ? { customerName: b.customer_name ?? undefined, customerMobile: b.customer_mobile ?? undefined, totalPrice: b.total, currency: 'INR' } : {}),
      })),
      ...removed.map((x: any) => ({ id: x.id, playingAreaId: x.area_id, venueId: x.venue_id, start: iso(x.starts_at), end: iso(x.ends_at), status: 'CANCELLED', updatedAt: iso(x.removed_at) })),
    ].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    res.json({ bookings: all.slice(0, 500), hasMore: all.length > 500 });
  });
  return r;
}
