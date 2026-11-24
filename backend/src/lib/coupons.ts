import type { Queryable } from '../db.js';
import { badRequest } from '../errors.js';
import { round2 } from './pricing.js';

export interface CouponResult { couponId: string; code: string; discount: number }

export async function evaluateCoupon(q: Queryable, code: string, userId: string, venueId: string, subtotal: number, now: Date): Promise<CouponResult> {
  const { rows } = await q.query(`SELECT * FROM coupons WHERE upper(code)=upper($1)`, [code.trim()]);
  const c = rows[0];
  if (!c || !c.is_active) throw badRequest('Invalid coupon code', 'coupon_invalid');
  if (now < new Date(c.valid_from) || now > new Date(c.valid_to)) throw badRequest('This coupon has expired', 'coupon_expired');
  if (c.venue_id && c.venue_id !== venueId) throw badRequest('This coupon is not valid for this venue', 'coupon_wrong_venue');
  if (subtotal < Number(c.min_amount)) throw badRequest(`Minimum booking amount for this coupon is ₹${c.min_amount}`, 'coupon_min_amount');
  if (c.usage_limit !== null && c.used_count >= c.usage_limit) throw badRequest('This coupon has been fully redeemed', 'coupon_exhausted');
  const used = await q.query('SELECT count(*)::int AS n FROM coupon_redemptions WHERE coupon_id=$1 AND user_id=$2', [c.id, userId]);
  if (used.rows[0].n >= c.per_user_limit) throw badRequest('You have already used this coupon', 'coupon_used');
  let discount = c.discount_type === 'percent' ? (subtotal * Number(c.value)) / 100 : Number(c.value);
  if (c.max_discount !== null) discount = Math.min(discount, Number(c.max_discount));
  discount = round2(Math.min(discount, subtotal));
  return { couponId: c.id, code: c.code, discount };
}
