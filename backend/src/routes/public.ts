import { venueAreaDays } from '../lib/ownerDay.js';
import { Router } from 'express';
import { adjustmentOn } from '../lib/slots.js';
import { z } from 'zod';
import type { Ctx } from '../types.js';
import { optionalAuth } from '../middleware/auth.js';
import { notFound, badRequest } from '../errors.js';
import { page, parse } from '../lib/http.js';
import { listSlots, loadAreaContext } from '../lib/slots.js';
import { evaluateCoupon } from '../lib/coupons.js';
import { authenticate } from '../middleware/auth.js';

const HAVERSINE = (lat: string, lng: string) =>
  `(2 * 6371 * asin(sqrt(least(1, power(sin(radians(v.lat - ${lat}) / 2), 2) + cos(radians(${lat})) * cos(radians(v.lat)) * power(sin(radians(v.lng - ${lng}) / 2), 2)))))`;

const searchSchema = z.object({
  q: z.string().trim().max(100).optional(), city: z.string().trim().max(80).optional(), state: z.string().trim().max(80).optional(),
  sport: z.string().trim().max(40).optional(), minPrice: z.coerce.number().min(0).optional(), maxPrice: z.coerce.number().min(0).optional(),
  minRating: z.coerce.number().min(0).max(5).optional(), lat: z.coerce.number().min(-90).max(90).optional(), lng: z.coerce.number().min(-180).max(180).optional(),
  radiusKm: z.coerce.number().min(0.1).max(500).optional(), date: z.iso.date().optional(), from: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(), to: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  facilities: z.string().regex(/^\d+(,\d+)*$/).max(60).optional(), category: z.string().trim().max(60).optional(),
  sort: z.enum(['distance', 'rating', 'price_asc', 'price_desc', 'newest', 'popular']).default('rating'),
});

export function publicRoutes(ctx: Ctx) {
  const r = Router();
  const opt = optionalAuth(ctx);

  r.get('/sports', async (_req, res) => res.json({ sports: (await ctx.db.query('SELECT id, name, slug FROM sports WHERE is_active ORDER BY name')).rows }));
  r.get('/facilities', async (_req, res) => res.json({ facilities: (await ctx.db.query('SELECT id, name FROM facilities ORDER BY name')).rows }));
  /** Banners for everyone, plus those aimed at the visitor's city: the one in the request, or the signed-in customer's own city. */
  r.get('/banners', opt, async (req, res) => {
    const asked = typeof req.query.city === 'string' ? req.query.city.trim().slice(0, 80) : '';
    const mine = !asked && req.user ? (await ctx.db.query('SELECT city FROM customer_profiles WHERE user_id=$1', [req.user.id])).rows[0]?.city ?? '' : '';
    const city = asked || mine;
    res.json({ banners: (await ctx.db.query(
      `SELECT id, title, image_url, link_url, city FROM banners WHERE is_active AND (city IS NULL OR ($1::text <> '' AND lower(city) = lower($1))) ORDER BY (city IS NULL), sort_order, created_at DESC`, [city])).rows });
  });
  r.get('/cities', async (_req, res) =>
    res.json({ cities: (await ctx.db.query(`SELECT city, count(*)::int AS venues FROM venues WHERE status='approved' GROUP BY city ORDER BY venues DESC LIMIT 50`)).rows }));

  r.get('/venues', opt, async (req, res) => {
    const f = parse(searchSchema, req.query);
    const { limit, offset, page: pageNo } = page(req.query);
    if (f.sort === 'distance' && (f.lat === undefined || f.lng === undefined)) throw badRequest('lat and lng are required to sort by distance');
    const p: unknown[] = [];
    const add = (v: unknown) => { p.push(v); return `$${p.length}`; };
    const where: string[] = [`v.status = 'approved'`];
    if (f.q) { const t = add(`%${f.q.replace(/[%_\\]/g, '\\$&')}%`); where.push(`(v.name ILIKE ${t} OR v.address ILIKE ${t} OR v.city ILIKE ${t})`); }
    if (f.state) where.push(`lower(v.state) = lower(${add(f.state)})`);
    if (f.city) where.push(`lower(v.city) = lower(${add(f.city)})`);
    if (f.sport) where.push(`EXISTS (SELECT 1 FROM playing_areas a JOIN playing_area_sports s ON s.playing_area_id=a.id JOIN sports sp ON sp.id=s.sport_id WHERE a.venue_id=v.id AND a.is_active AND sp.slug=${add(f.sport)})`);
    if (f.category) where.push(`v.category = ${add(f.category)}`);
    if (f.facilities) { const ids = f.facilities.split(',').map(Number); where.push(`(SELECT count(DISTINCT vf.facility_id) FROM venue_facilities vf WHERE vf.venue_id=v.id AND vf.facility_id = ANY(${add(ids)}::int[])) = ${ids.length}`); }
    if (f.minRating !== undefined) where.push(`v.rating_avg >= ${add(f.minRating)}`);
    const latP = f.lat !== undefined ? add(f.lat) : null, lngP = f.lng !== undefined ? add(f.lng) : null;
    const dist = latP && lngP ? HAVERSINE(`${latP}::float8`, `${lngP}::float8`) : null;
    if (dist && f.radiusKm) where.push(`${dist} <= ${add(f.radiusKm)}`);
    if (f.minPrice !== undefined) where.push(`mp.min_price >= ${add(f.minPrice)}`);
    if (f.maxPrice !== undefined) where.push(`mp.min_price <= ${add(f.maxPrice)}`);
    if (f.date || f.from || f.to) {
      // date / time: only venues with a slot a customer can book then, worked out the same way as the slot list (opening hours
      // of that date, a price set for it, nothing booked, held or blocked, not already past). A slot counts when it starts in the window.
      if (f.to && f.from && f.to <= f.from) throw badRequest('The end time must be after the start time');
      const day = f.date ?? ctx.now().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      const cand = (await ctx.db.query(`SELECT v.id FROM venues v LEFT JOIN LATERAL (SELECT min(pr.price_per_hour) AS min_price FROM pricing_rules pr JOIN playing_areas a ON a.id=pr.area_id WHERE a.venue_id=v.id AND a.is_active) mp ON true WHERE ${where.join(' AND ')}`, p)).rows.map((r: any) => r.id as string);
      const toM = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
      const lo = f.from ? toM(f.from) : 0, hi = f.to ? toM(f.to) : 24 * 60;
      const days = await venueAreaDays(ctx.db, cand, day, f.sport);
      const ok = [...new Set(days.filter((d) => d.freeStarts.some((m) => m >= lo && m < hi)).map((d) => d.venueId))];
      where.push(`v.id = ANY(${add(ok)}::uuid[])`);
    }
    const order = { distance: `distance_km ASC`, rating: 'v.rating_avg DESC, v.rating_count DESC', price_asc: 'mp.min_price ASC NULLS LAST', price_desc: 'mp.min_price DESC NULLS LAST', newest: 'v.created_at DESC', popular: 'popularity DESC, v.rating_avg DESC' }[f.sort];
    const uid = req.user ? add(req.user.id) : null;
    const sql = `
      SELECT v.id, v.name, v.address, v.city, v.category, v.lat, v.lng, v.rating_avg, v.rating_count, v.discount_percent, mp.min_price,
        (SELECT count(*)::int FROM bookings pb WHERE pb.venue_id=v.id AND pb.status IN ('confirmed','completed')) AS popularity,
        (SELECT COALESCE(json_agg(fc.name ORDER BY fc.name), '[]') FROM venue_facilities vf JOIN facilities fc ON fc.id=vf.facility_id WHERE vf.venue_id=v.id) AS facilities,
        ${dist ? `round((${dist})::numeric, 1)::float8` : 'NULL::float8'} AS distance_km,
        (SELECT url FROM venue_images i WHERE i.venue_id=v.id AND i.area_id IS NULL AND i.kind='image' AND NOT i.is_pending ORDER BY i.is_cover DESC, i.sort_order LIMIT 1) AS cover_image,
        (SELECT COALESCE(json_agg(x.url), '[]') FROM (SELECT url FROM venue_images i WHERE i.venue_id=v.id AND i.area_id IS NULL AND i.kind='image' AND NOT i.is_pending ORDER BY i.is_cover DESC, i.sort_order LIMIT 4) x) AS photos,
        (SELECT COALESCE(json_agg(DISTINCT sp.name), '[]') FROM playing_areas a JOIN playing_area_sports s ON s.playing_area_id=a.id JOIN sports sp ON sp.id=s.sport_id WHERE a.venue_id=v.id AND a.is_active) AS sports,
        ${uid ? `EXISTS (SELECT 1 FROM favourites f WHERE f.user_id=${uid} AND f.venue_id=v.id)` : 'false'} AS is_favourite,
        count(*) OVER()::int AS total
      FROM venues v
      LEFT JOIN LATERAL (SELECT min(pr.price_per_hour) AS min_price FROM pricing_rules pr JOIN playing_areas a ON a.id=pr.area_id WHERE a.venue_id=v.id AND a.is_active) mp ON true
      WHERE ${where.join(' AND ')}
      ORDER BY ${order}, v.id LIMIT ${add(limit)} OFFSET ${add(offset)}`;
    const { rows } = await ctx.db.query(sql, p);
    res.json({ venues: rows.map(({ total, ...v }) => v), total: rows[0]?.total ?? 0, page: pageNo, limit });
  });

  r.get('/venues/:id', opt, async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    const v = (await ctx.db.query(
      `SELECT v.*, op.business_name FROM venues v JOIN owner_profiles op ON op.user_id=v.owner_id WHERE v.id=$1`, [id])).rows[0];
    const viewer = req.user;
    if (!v || (v.status !== 'approved' && viewer?.id !== v.owner_id && viewer?.role !== 'admin')) throw notFound('Venue not found');
    const [images, facilities, areas, pricing, avail, fav, areaImages] = await Promise.all([
      ctx.db.query("SELECT id, url, kind, is_cover FROM venue_images WHERE venue_id=$1 AND area_id IS NULL AND NOT is_pending AND kind <> 'panorama' ORDER BY is_cover DESC, sort_order", [id]),
      ctx.db.query('SELECT f.id, f.name FROM venue_facilities vf JOIN facilities f ON f.id=vf.facility_id WHERE vf.venue_id=$1 ORDER BY f.name', [id]),
      ctx.db.query(
        `SELECT a.id, a.name, a.surface, a.capacity, a.slot_minutes, a.min_duration_minutes, a.max_duration_minutes, a.environment, a.roof_type, a.advance_booking_days, a.instant_booking,
           (SELECT COALESCE(json_agg(json_build_object('id', sp.id, 'name', sp.name, 'slug', sp.slug)), '[]') FROM playing_area_sports s JOIN sports sp ON sp.id=s.sport_id WHERE s.playing_area_id=a.id) AS sports
         FROM playing_areas a WHERE a.venue_id=$1 AND a.is_active AND a.approval_status='approved' ORDER BY a.name`, [id]),
      ctx.db.query(`SELECT pr.area_id, pr.sport_id, pr.day_type, pr.day_of_week, pr.start_time::text, pr.end_time::text, pr.price_per_hour FROM pricing_rules pr JOIN playing_areas a ON a.id=pr.area_id WHERE a.venue_id=$1 AND a.is_active`, [id]),
      ctx.db.query(`SELECT ar.playing_area_id AS area_id, ar.day_of_week, ar.open_time::text, ar.close_time::text, ar.is_closed FROM playing_area_hours ar JOIN playing_areas a ON a.id=ar.playing_area_id WHERE a.venue_id=$1`, [id]),
      viewer ? ctx.db.query('SELECT 1 FROM favourites WHERE user_id=$1 AND venue_id=$2', [viewer.id, id]) : Promise.resolve({ rows: [] as any[] }),
      ctx.db.query("SELECT id, url, area_id FROM venue_images WHERE venue_id=$1 AND area_id IS NOT NULL AND kind='image' AND NOT is_pending ORDER BY sort_order", [id]),
    ]);
    const { owner_id, contact_phone2: _alt, ...pub } = v; // the second contact number is for the owner and KickOff, not shown to customers
    const panorama = (await ctx.db.query("SELECT url FROM venue_images WHERE venue_id=$1 AND kind='panorama' AND NOT is_pending LIMIT 1", [id])).rows[0]?.url ?? null;
    res.json({ venue: { ...pub, panorama, images: images.rows, facilities: facilities.rows, is_favourite: !!fav.rows[0],
      areas: areas.rows.map((a: any) => ({ ...a, images: areaImages.rows.filter((i: any) => i.area_id === a.id).map(({ area_id, ...i }: any) => i), pricing: pricing.rows.filter((p: any) => p.area_id === a.id), availability: avail.rows.filter((x: any) => x.area_id === a.id) })) } });
  });


  r.get('/venues/:id/reviews', async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    const { limit, offset } = page(req.query);
    const { rows } = await ctx.db.query(
      `SELECT rv.id, rv.rating, rv.comment, rv.owner_reply, rv.created_at, u.full_name AS author
         FROM reviews rv JOIN users u ON u.id=rv.customer_id WHERE rv.venue_id=$1 AND NOT rv.is_hidden ORDER BY rv.created_at DESC LIMIT $2 OFFSET $3`, [id, limit, offset]);
    res.json({ reviews: rows });
  });

  /** Real customer reviews for the landing page. Only public-safe fields: first name + last initial, no contact data. */
  r.get('/reviews/featured', async (_req, res) => {
    const { rows } = await ctx.db.query(
      `SELECT rv.id, rv.rating, rv.comment, rv.created_at, v.id AS venue_id, v.name AS venue_name,
              split_part(u.full_name, ' ', 1) || CASE WHEN position(' ' in trim(u.full_name)) > 0 THEN ' ' || left(split_part(trim(u.full_name), ' ', 2), 1) || '.' ELSE '' END AS author
         FROM reviews rv JOIN venues v ON v.id = rv.venue_id AND v.status = 'approved' JOIN users u ON u.id = rv.customer_id
        WHERE NOT rv.is_hidden AND rv.rating >= 4 AND rv.comment IS NOT NULL AND length(trim(rv.comment)) > 0
        ORDER BY rv.created_at DESC LIMIT 6`);
    res.json({ reviews: rows });
  });

  r.get('/areas/:id/slots', opt, async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    const q = parse(z.object({ date: z.iso.date(), sportId: z.coerce.number().int().positive(), duration: z.coerce.number().int().positive().default(60) }), req.query);
    const ac = await loadAreaContext(ctx.db, id, q.sportId);
    const slots = await listSlots(ctx.db, ac, q.sportId, q.date, q.duration, ctx.now(), req.user?.id);
    res.json({ areaId: id, venueId: ac.venue.id, date: q.date, timezone: ac.venue.timezone, durationMinutes: q.duration, discountPercent: ac.venue.discount_percent, specialPricing: adjustmentOn(ac, q.date), slots });
  });

  r.post('/coupons/validate', authenticate(ctx), async (req, res) => {
    const b = parse(z.object({ code: z.string().min(2).max(40), venueId: z.uuid(), amount: z.number().min(0) }), req.body);
    const c = await evaluateCoupon(ctx.db, b.code, req.user!.id, b.venueId, b.amount, ctx.now());
    res.json({ code: c.code, discount: c.discount, total: Math.max(0, b.amount - c.discount) });
  });

  return r;
}
