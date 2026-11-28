import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import type { Ctx } from '../types.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { HttpError, notFound } from '../errors.js';
import { parse } from '../lib/http.js';
import { audit } from '../lib/audit.js';

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
    res.json({ key: k ? { prefix: k.key_prefix, createdAt: k.created_at, lastUsedAt: k.last_used_at } : null });
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

  r.get('/venues', async (req: any, res) => {
    const { rows } = await ctx.db.query(
      `SELECT v.id, v.name, v.address, v.city, v.state, v.pincode, v.timezone, v.lat::float8 AS lat, v.lng::float8 AS lng,
              COALESCE((SELECT json_agg(json_build_object('id', a.id, 'name', a.name, 'slotMinutes', a.slot_minutes, 'isActive', a.is_active,
                  'sports', (SELECT COALESCE(json_agg(json_build_object('id', sp.id, 'name', sp.name) ORDER BY sp.name), '[]') FROM playing_area_sports s JOIN sports sp ON sp.id=s.sport_id WHERE s.playing_area_id=a.id))
                  ORDER BY a.name) FROM playing_areas a WHERE a.venue_id=v.id), '[]') AS courts
         FROM venues v
        WHERE CASE WHEN $1::uuid IS NULL THEN v.status = 'approved'                          -- no key: every published venue
                   ELSE v.owner_id = $1::uuid AND v.status IN ('ready','approved') END        -- a key: that owner's approved venues
        ORDER BY v.name`, [req.syncOwnerId]);
    // a venue's playing areas, under both names: "courts" as partner apps call them, "playingAreas" as PlaynX does
    res.json({ venues: rows.map((v: any) => ({ ...v, playingAreas: v.courts })) });
  });

  r.get('/bookings', async (req: any, res) => {
    const q = parse(z.object({
      since: z.iso.datetime({ offset: true }).optional(), // only what changed after this time
      from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional(), // the period of play; default: yesterday to 90 days ahead
      venueId: z.uuid().optional(),
    }), req.query);
    const now = ctx.now();
    const from = q.from ?? new Date(now.getTime() - 86400000).toISOString();
    const to = q.to ?? new Date(now.getTime() + 90 * 86400000).toISOString();
    const params: unknown[] = [req.syncOwnerId, from, to, q.since ?? null, q.venueId ?? null];
    const { rows } = await ctx.db.query(
      `SELECT b.id, b.reference, v.id AS venue_id, v.name AS venue_name, a.id AS court_id, a.name AS court_name, sp.name AS sport,
              lower(b.during) AS starts_at, upper(b.during) AS ends_at, b.status, b.block_kind, b.event_kind, b.deleted_at, b.cancelled_at, b.sync_updated_at
         FROM bookings b JOIN venues v ON v.id=b.venue_id JOIN playing_areas a ON a.id=b.area_id LEFT JOIN sports sp ON sp.id=b.sport_id
        WHERE (CASE WHEN $1::uuid IS NULL THEN v.status = 'approved' ELSE v.owner_id = $1::uuid END) AND upper(b.during) > $2::timestamptz AND lower(b.during) < $3::timestamptz
          AND b.status IN ('confirmed','completed','no_show','blocked','cancelled')
          AND ($4::timestamptz IS NULL OR b.sync_updated_at > $4::timestamptz) AND ($5::uuid IS NULL OR v.id = $5::uuid)
        ORDER BY b.sync_updated_at LIMIT 5000`, params);
    const removed = (await ctx.db.query(
      `SELECT r.booking_id AS id, r.venue_id, v.name AS venue_name, r.area_id AS court_id, a.name AS court_name, r.starts_at, r.ends_at, r.removed_at
         FROM booking_sync_removed r JOIN venues v ON v.id=r.venue_id LEFT JOIN playing_areas a ON a.id=r.area_id
        WHERE (CASE WHEN $1::uuid IS NULL THEN v.status = 'approved' ELSE v.owner_id = $1::uuid END) AND r.ends_at > $2::timestamptz AND r.starts_at < $3::timestamptz
          AND ($4::timestamptz IS NULL OR r.removed_at > $4::timestamptz) AND ($5::uuid IS NULL OR v.id = $5::uuid)
        ORDER BY r.removed_at LIMIT 5000`, params)).rows;
    const iso = (d: any) => (d ? new Date(d).toISOString() : null);
    const bookings = [
      ...rows.map((b: any) => {
        const gone = b.status === 'cancelled' || !!b.deleted_at;
        return {
          id: b.id, reference: req.syncOwnerId ? b.reference : null, venueId: b.venue_id, venueName: b.venue_name, courtId: b.court_id, courtName: b.court_name, sport: b.sport ?? null,
          startsAt: iso(b.starts_at), endsAt: iso(b.ends_at),
          type: b.event_kind ? 'event' : b.status === 'blocked' ? 'block' : 'booking',
          status: gone ? 'cancelled' : b.status === 'blocked' ? 'blocked' : b.status === 'completed' ? 'completed' : 'confirmed',
          cancelledAt: gone ? iso(b.deleted_at ?? b.cancelled_at ?? b.sync_updated_at) : null, updatedAt: iso(b.sync_updated_at),
        };
      }),
      ...removed.map((x: any) => ({
        id: x.id, reference: null, venueId: x.venue_id, venueName: x.venue_name, courtId: x.court_id, courtName: x.court_name, sport: null,
        startsAt: iso(x.starts_at), endsAt: iso(x.ends_at), type: 'block', status: 'cancelled', cancelledAt: iso(x.removed_at), updatedAt: iso(x.removed_at),
      })),
    ].sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)));
    res.json({ serverTime: now.toISOString(), bookings });
  });
  return r;
}
