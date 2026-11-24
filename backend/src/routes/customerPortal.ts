import { Router } from 'express';
import { WALLET_MONTHS, walletBalance } from '../lib/wallet.js';
import { z } from 'zod';
import type { Ctx } from '../types.js';
import { authenticate, requireRole, optionalAuth } from '../middleware/auth.js';
import { forbidden, notFound } from '../errors.js';
import { page, parse } from '../lib/http.js';
import { BOOKING_SELECT } from './bookings.js';

const star = z.number().int().min(1).max(5);
export const reviewBody = z.object({
  rating: star, comment: z.string().trim().max(1000).optional(),
  groundRating: star.optional(), cleanlinessRating: star.optional(), facilitiesRating: star.optional(), staffRating: star.optional(),
});

/** Customer-portal reads and review management that sit beside the booking and account routes. */
export function customerPortalRoutes(ctx: Ctx) {
  const r = Router();
  const auth = authenticate(ctx);
  const customer = [auth, requireRole('customer')];

  // ---- offers: active coupons are public; usage by the signed-in customer is added when known
  r.get('/offers', optionalAuth(ctx), async (req, res) => {
    const expired = req.query.expired === '1';
    const uid = req.user?.id ?? null;
    const { rows } = await ctx.db.query(
      `SELECT c.id, c.code, c.description, c.discount_type, c.value::float8 AS value, c.max_discount::float8 AS max_discount, c.min_amount::float8 AS min_amount,
              c.valid_from, c.valid_to, c.per_user_limit, c.venue_id, v.name AS venue_name,
              CASE WHEN c.usage_limit IS NULL THEN NULL ELSE GREATEST(c.usage_limit - c.used_count, 0) END AS uses_left,
              ${uid ? `(SELECT count(*)::int FROM coupon_redemptions cr WHERE cr.coupon_id=c.id AND cr.user_id=$1)` : '0'} AS used_by_me
         FROM coupons c LEFT JOIN venues v ON v.id=c.venue_id
        WHERE c.is_active AND (c.venue_id IS NULL OR v.status='approved')
          AND ${expired ? `c.valid_to < now()` : `c.valid_from <= now() AND c.valid_to >= now() AND (c.usage_limit IS NULL OR c.used_count < c.usage_limit)`}
        ORDER BY c.valid_to ${expired ? 'DESC' : 'ASC'} LIMIT 100`, uid ? [uid] : []);
    res.json({ offers: rows });
  });

  // ---- payments and refunds for the signed-in customer
  r.get('/me/payments', ...customer, async (req, res) => {
    const { limit, offset } = page(req.query);
    const uid = req.user!.id;
    const [rows, sum, refunds] = await Promise.all([
      ctx.db.query(
        `SELECT p.id, p.razorpay_payment_id AS transaction_id, p.razorpay_order_id AS order_id, p.amount::float8 AS amount, p.status, p.method, p.created_at, p.paid_at,
                b.id AS booking_id, b.reference, v.name AS venue_name
           FROM payments p JOIN bookings b ON b.id=p.booking_id JOIN venues v ON v.id=b.venue_id
          WHERE b.customer_id=$1 AND p.status <> 'created' ORDER BY COALESCE(p.paid_at, p.created_at) DESC LIMIT $2 OFFSET $3`, [uid, limit, offset]),
      ctx.db.query(
        `SELECT COALESCE(sum(p.amount) FILTER (WHERE p.status IN ('captured','refunded','partially_refunded')),0)::float8 AS paid_total,
                count(*) FILTER (WHERE p.status IN ('captured','refunded','partially_refunded'))::int AS successful,
                count(*) FILTER (WHERE p.status='failed')::int AS failed,
                count(*) FILTER (WHERE p.status='created')::int AS pending
           FROM payments p JOIN bookings b ON b.id=p.booking_id WHERE b.customer_id=$1`, [uid]),
      ctx.db.query(
        `SELECT rf.id, rf.amount::float8 AS amount, rf.status, rf.reason, rf.created_at, rf.processed_at, b.id AS booking_id, b.reference, v.name AS venue_name
           FROM refunds rf JOIN bookings b ON b.id=rf.booking_id JOIN venues v ON v.id=b.venue_id WHERE b.customer_id=$1 ORDER BY rf.created_at DESC LIMIT 50`, [uid]),
    ]);
    res.json({ payments: rows.rows, summary: sum.rows[0], refunds: refunds.rows });
  });

  // ---- wallet
  r.get('/me/wallet', ...customer, async (req, res) => {
    const uid = req.user!.id; const now = ctx.now();
    const [balance, entries, soon] = await Promise.all([
      walletBalance(ctx.db, uid, now),
      ctx.db.query(`SELECT l.id, l.delta::float8 AS delta, l.kind, l.note, l.created_at, b.reference FROM wallet_ledger l LEFT JOIN bookings b ON b.id=l.booking_id WHERE l.user_id=$1 ORDER BY l.created_at DESC, l.id DESC LIMIT 100`, [uid]),
      ctx.db.query(`SELECT COALESCE(sum(remaining),0)::float8 AS amount, min(expires_at) AS at FROM wallet_lots WHERE user_id=$1 AND remaining > 0 AND expires_at > $2::timestamptz AND expires_at <= $2::timestamptz + interval '30 days'`, [uid, now.toISOString()])]);
    res.json({ balance, entries: entries.rows, expiringSoon: soon.rows[0].amount > 0 ? { amount: soon.rows[0].amount, at: soon.rows[0].at } : null, expiryMonths: WALLET_MONTHS });
  });

  // ---- reviews
  r.get('/me/reviews', ...customer, async (req, res) => {
    const uid = req.user!.id;
    const [mine, todo] = await Promise.all([
      ctx.db.query(
        `SELECT rv.id, rv.booking_id, rv.rating, rv.comment, rv.ground_rating, rv.cleanliness_rating, rv.facilities_rating, rv.staff_rating, rv.owner_reply, rv.created_at, rv.updated_at,
                v.id AS venue_id, v.name AS venue_name, b.reference
           FROM reviews rv JOIN venues v ON v.id=rv.venue_id JOIN bookings b ON b.id=rv.booking_id WHERE rv.customer_id=$1 AND NOT rv.is_hidden ORDER BY rv.created_at DESC`, [uid]),
      ctx.db.query(
        `SELECT b.id AS booking_id, b.reference, v.id AS venue_id, v.name AS venue_name, lower(b.during) AS starts_at, a.name AS area_name
           FROM bookings b JOIN venues v ON v.id=b.venue_id JOIN playing_areas a ON a.id=b.area_id
          WHERE b.customer_id=$1 AND (b.status='completed' OR (b.status='confirmed' AND upper(b.during) <= now()))
            AND NOT EXISTS (SELECT 1 FROM reviews rv WHERE rv.booking_id=b.id) ORDER BY lower(b.during) DESC LIMIT 50`, [uid]),
    ]);
    res.json({ reviews: mine.rows, toReview: todo.rows });
  });

  const refreshRating = (q: { query: Ctx['db']['query'] }, venueId: string) =>
    q.query(`UPDATE venues SET rating_avg=COALESCE((SELECT round(avg(rating)::numeric,2) FROM reviews WHERE venue_id=$1 AND NOT is_hidden),0), rating_count=(SELECT count(*) FROM reviews WHERE venue_id=$1 AND NOT is_hidden) WHERE id=$1`, [venueId]);

  r.put('/reviews/:id', ...customer, async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    const b = parse(reviewBody, req.body);
    const rv = (await ctx.db.query('SELECT id, customer_id, venue_id FROM reviews WHERE id=$1', [id])).rows[0];
    if (!rv) throw notFound('Review not found');
    if (rv.customer_id !== req.user!.id) throw forbidden();
    await ctx.db.tx(async (q) => {
      await q.query(`UPDATE reviews SET rating=$2, comment=$3, ground_rating=$4, cleanliness_rating=$5, facilities_rating=$6, staff_rating=$7, updated_at=now() WHERE id=$1`,
        [id, b.rating, b.comment ?? null, b.groundRating ?? null, b.cleanlinessRating ?? null, b.facilitiesRating ?? null, b.staffRating ?? null]);
      await refreshRating(q, rv.venue_id);
    });
    res.json({ ok: true });
  });
  r.delete('/reviews/:id', ...customer, async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    const rv = (await ctx.db.query('SELECT id, customer_id, venue_id FROM reviews WHERE id=$1', [id])).rows[0];
    if (!rv) throw notFound('Review not found');
    if (rv.customer_id !== req.user!.id) throw forbidden();
    await ctx.db.tx(async (q) => { await q.query('DELETE FROM reviews WHERE id=$1', [id]); await refreshRating(q, rv.venue_id); });
    res.status(204).end();
  });

  // ---- security: recent sign-ins for this account
  r.get('/me/login-history', auth, async (req, res) => {
    const { rows } = await ctx.db.query(
      `SELECT action, ip, created_at FROM audit_logs WHERE actor_id=$1 AND action IN ('user.login','user.login_google','user.password_change','user.password_reset') ORDER BY created_at DESC LIMIT 20`, [req.user!.id]);
    res.json({ history: rows });
  });

  return r;
}

