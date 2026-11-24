import { Router } from 'express';
import { z } from 'zod';
import type { Ctx } from '../types.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { forbidden, notFound, HttpError } from '../errors.js';
import { page, parse } from '../lib/http.js';
import { getSetting } from '../lib/settings.js';
import { round2 } from '../lib/pricing.js';
import { cancelBooking, cancelSeriesFrom, createSeries, rescheduleBooking, releaseUnpaidBooking, confirmPayment, createBooking, lockSlot, recordPaymentFailure, releaseLock } from '../lib/bookings.js';

export const BOOKING_SELECT = `
  SELECT b.id, b.reference, b.status, lower(b.during) AS starts_at, upper(b.during) AS ends_at, b.subtotal, b.discount, b.total, b.addons_total::float8 AS addons_total,
         b.cancel_reason, b.cancelled_at, b.wallet_amount::float8 AS wallet_amount, b.series_id, b.series_index, b.is_split, (SELECT count(*)::int FROM bookings s WHERE s.series_id=b.series_id) AS series_count, b.reschedule_count, b.rescheduled_at, b.created_at, b.expires_at, b.sport_id, sp.name AS sport, b.source, b.payment_method,
         v.id AS venue_id, v.name AS venue_name, v.address, v.city, v.lat, v.lng, v.timezone, v.cancellation_hours,
         a.id AS area_id, a.name AS area_name,
         (SELECT url FROM venue_images i WHERE i.venue_id=v.id AND i.area_id IS NULL AND i.kind='image' AND NOT i.is_pending ORDER BY i.is_cover DESC, i.sort_order LIMIT 1) AS cover_image,
         p.status AS payment_status, p.razorpay_payment_id,
         (SELECT COALESCE(sum(r.amount),0)::float8 FROM refunds r WHERE r.booking_id=b.id AND r.status='processed') AS refunded,
         (SELECT r.status FROM refunds r WHERE r.booking_id=b.id ORDER BY r.created_at DESC LIMIT 1) AS refund_status,
         EXISTS (SELECT 1 FROM reviews rv WHERE rv.booking_id=b.id) AS reviewed
    FROM bookings b JOIN venues v ON v.id=b.venue_id JOIN playing_areas a ON a.id=b.area_id
    LEFT JOIN sports sp ON sp.id=b.sport_id
    LEFT JOIN LATERAL (SELECT status, razorpay_payment_id FROM payments WHERE booking_id=COALESCE(b.pay_booking_id, b.id) ORDER BY created_at DESC LIMIT 1) p ON true`;

export function bookingRoutes(ctx: Ctx) {
  const r = Router();
  r.use(['/slots', '/bookings'], authenticate(ctx)); // scoped: this router is mounted at /api and must not 401 unknown routes

  r.post('/slots/lock', requireRole('customer'), async (req, res) => {
    const b = parse(z.object({ areaId: z.uuid(), sportId: z.number().int().positive(), startsAt: z.iso.datetime({ offset: true }), durationMinutes: z.number().int().min(30).max(720) }), req.body);
    const u = (await ctx.db.query('SELECT email_verified, phone, phone_verified FROM users WHERE id=$1', [req.user!.id])).rows[0];
    if (!u.phone) throw new HttpError(403, 'Please add your mobile number in My Profile before booking', 'phone_missing');
    if (!u.email_verified) throw new HttpError(403, 'Please verify your email before booking', 'email_unverified');
    if (ctx.cfg.SMS_WEBHOOK_URL && u.phone && !u.phone_verified) throw new HttpError(403, 'Please verify your mobile number before booking', 'phone_unverified'); // only when texts can actually be sent
    const l = await lockSlot(ctx, req.user!, b);
    res.status(201).json({ lockId: l.lockId, expiresAt: l.expiresAt, startsAt: l.startsAt, endsAt: l.endsAt, price: l.price });
  });

  r.delete('/slots/lock/:id', requireRole('customer'), async (req, res) => {
    await releaseLock(ctx, req.user!, parse(z.uuid(), req.params.id));
    res.status(204).end();
  });

  r.post('/bookings', requireRole('customer'), async (req, res) => {
    const b = parse(z.object({ lockId: z.uuid(), couponCode: z.string().trim().min(2).max(40).optional(), useWallet: z.boolean().optional() }), req.body);
    res.status(201).json(await createBooking(ctx, req.user!, b));
  });

  /** Book the same slot every week for 2 to 8 weeks, paid in one go. */
  r.post('/bookings/recurring', requireRole('customer'), async (req, res) => {
    const b = parse(z.object({ areaId: z.uuid(), sportId: z.number().int().positive(), startsAt: z.iso.datetime({ offset: true }), durationMinutes: z.number().int().min(30).max(720), weeks: z.number().int().min(2).max(8), useWallet: z.boolean().optional() }), req.body);
    const u = (await ctx.db.query('SELECT email_verified, phone FROM users WHERE id=$1', [req.user!.id])).rows[0];
    if (!u.phone) throw new HttpError(403, 'Please add your mobile number in My Profile before booking', 'phone_missing');
    if (!u.email_verified) throw new HttpError(403, 'Please verify your email before booking', 'email_unverified');
    res.status(201).json(await createSeries(ctx, req.user!, b));
  });
  r.post('/bookings/:id/cancel-series', requireRole('customer'), async (req, res) => {
    const b = parse(z.object({ reason: z.string().trim().max(300).optional(), refundTo: z.enum(['original', 'wallet']).optional() }), req.body ?? {});
    res.json(await cancelSeriesFrom(ctx, req.user!, parse(z.uuid(), req.params.id), b.reason, { refundTo: b.refundTo }));
  });

  /** Resume payment for a still-held pending booking (e.g. the checkout window was closed). */
  r.get('/bookings/:id/order', requireRole('customer'), async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    const { rows } = await ctx.db.query(
      `SELECT p.razorpay_order_id AS id, p.amount, p.currency FROM bookings b JOIN payments p ON p.booking_id=b.id
        WHERE b.id=$1 AND b.customer_id=$2 AND b.status='pending' AND b.expires_at > $3 AND p.status='created' ORDER BY p.created_at DESC LIMIT 1`,
      [id, req.user!.id, ctx.now().toISOString()]);
    if (!rows[0]) throw new HttpError(409, 'This booking can no longer be paid. Please book the slot again.', 'not_payable');
    res.json({ order: { ...rows[0], keyId: ctx.gateway.keyId() } });
  });

  /** Client-side confirmation after Razorpay Checkout; the HMAC signature is verified server-side. */
  r.post('/bookings/:id/verify-payment', requireRole('customer'), async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    const b = parse(z.object({ razorpay_order_id: z.string(), razorpay_payment_id: z.string(), razorpay_signature: z.string() }), req.body);
    const pay = (await ctx.db.query(
      `SELECT p.razorpay_order_id FROM payments p JOIN bookings k ON k.id=p.booking_id WHERE k.id=$1 AND k.customer_id=$2 AND p.razorpay_order_id=$3`,
      [id, req.user!.id, b.razorpay_order_id])).rows[0];
    if (!pay) throw notFound('Payment not found for this booking');
    if (!ctx.gateway.verifyPaymentSignature(b.razorpay_order_id, b.razorpay_payment_id, b.razorpay_signature)) {
      await recordPaymentFailure(ctx, b.razorpay_order_id);
      throw new HttpError(400, 'Payment signature verification failed', 'bad_signature');
    }
    const method = (await ctx.gateway.paymentMethod?.(b.razorpay_payment_id).catch(() => null)) ?? undefined; // UPI, card, net banking…
    const out = await confirmPayment(ctx, { orderId: b.razorpay_order_id, paymentId: b.razorpay_payment_id, signature: b.razorpay_signature, method });
    res.json(out);
  });

  r.post('/bookings/:id/payment-failed', requireRole('customer'), async (req, res) => {
    res.json(await releaseUnpaidBooking(ctx, req.user!, parse(z.uuid(), req.params.id)));
  });

  r.post('/bookings/:id/cancel', async (req, res) => {
    const b = parse(z.object({ reason: z.string().trim().max(300).optional(), refundTo: z.enum(['original', 'wallet']).optional() }), req.body ?? {});
    res.json(await cancelBooking(ctx, req.user!, parse(z.uuid(), req.params.id), b.reason, { refundTo: b.refundTo }));
  });

  r.post('/bookings/:id/reschedule', requireRole('customer'), async (req, res) => {
    const b = parse(z.object({ startsAt: z.iso.datetime({ offset: true }) }), req.body);
    res.json(await rescheduleBooking(ctx, req.user!, parse(z.uuid(), req.params.id), b.startsAt));
  });

  r.get('/bookings', requireRole('customer'), async (req, res) => {
    const { limit, offset } = page(req.query);
    const status = typeof req.query.status === 'string' ? req.query.status : null;
    const upcoming = req.query.when === 'upcoming', past = req.query.when === 'past';
    const q = parse(z.object({ tab: z.enum(['completed', 'cancelled']).optional(), from: z.iso.date().optional(), to: z.iso.date().optional(), venueId: z.uuid().optional(), sportId: z.coerce.number().int().optional(), payment: z.string().max(20).optional() }), req.query);
    const { rows } = await ctx.db.query(
      `${BOOKING_SELECT} WHERE b.customer_id=$1 AND ($2::text IS NULL OR b.status=$2)
         AND ($3::bool IS NOT TRUE OR (upper(b.during) > now() AND b.status IN ('pending','confirmed')))
         AND ($4::bool IS NOT TRUE OR (upper(b.during) <= now() OR b.status NOT IN ('pending','confirmed')))
         AND ($7::text IS NULL OR ($7='completed' AND (b.status='completed' OR (b.status='confirmed' AND upper(b.during) <= now()))) OR ($7='cancelled' AND b.status IN ('cancelled','expired')))
         AND ($8::date IS NULL OR lower(b.during) >= $8::date) AND ($9::date IS NULL OR lower(b.during) < $9::date + 1)
         AND ($10::uuid IS NULL OR b.venue_id=$10) AND ($11::int IS NULL OR b.sport_id=$11) AND ($12::text IS NULL OR p.status=$12)
       ORDER BY lower(b.during) DESC LIMIT $5 OFFSET $6`, [req.user!.id, status, upcoming, past, limit, offset, q.tab ?? null, q.from ?? null, q.to ?? null, q.venueId ?? null, q.sportId ?? null, q.payment ?? null]);
    res.json({ bookings: rows });
  });

  r.get('/bookings/:id', async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    const { rows } = await ctx.db.query(
      `${BOOKING_SELECT.replace('SELECT b.id,', 'SELECT b.customer_id, v.owner_id, b.id,')} WHERE b.id=$1`, [id]);
    const b = rows[0];
    if (!b) throw notFound('Booking not found');
    const u = req.user!;
    if (!(b.customer_id === u.id || b.owner_id === u.id || u.role === 'admin')) throw forbidden();
    const { owner_id, customer_id, ...pub } = b;
    const refunds = (await ctx.db.query('SELECT id, amount, status, reason, created_at, processed_at FROM refunds WHERE booking_id=$1 ORDER BY created_at', [id])).rows;
    res.json({ booking: pub, refunds, addons: [] });
  });

  /**
   * Tax invoice for a booking. The venue is the supplier: when the owner has a GSTIN the (tax-inclusive) price is split into taxable value
   * + CGST/SGST at the configured rate; owners without a GSTIN get a plain receipt. The SAC code and rate are platform settings.
   */
  r.get('/bookings/:id/invoice', async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    const b = (await ctx.db.query(
      `SELECT b.id, b.reference, b.total::float8 AS total, b.subtotal::float8 AS subtotal, b.discount::float8 AS discount, p.status AS payment_status, b.created_at, lower(b.during) AS starts_at, b.customer_id,
              v.owner_id, v.name AS venue_name, v.address, v.city, v.state, a.name AS area_name, o.business_name, o.gstin, o.address AS business_address, u.full_name AS customer_name
         FROM bookings b JOIN playing_areas a ON a.id=b.area_id JOIN venues v ON v.id=b.venue_id JOIN owner_profiles o ON o.user_id=v.owner_id JOIN users u ON u.id=b.customer_id
         LEFT JOIN LATERAL (SELECT status FROM payments WHERE booking_id=COALESCE(b.pay_booking_id, b.id) ORDER BY created_at DESC LIMIT 1) p ON true WHERE b.id=$1`, [id])).rows[0];
    if (!b) throw notFound('Booking not found');
    const u = req.user!;
    if (!(b.customer_id === u.id || b.owner_id === u.id || u.role === 'admin')) throw forbidden();
    const rate = await getSetting<number>(ctx.db, 'gst_rate', 18);
    const sac = await getSetting<string>(ctx.db, 'gst_sac', '999692');
    const gstin: string | null = b.gstin?.trim() || null;
    const total = round2(b.total);
    const taxable = gstin ? round2(total / (1 + rate / 100)) : total;
    const tax = gstin ? round2(total - taxable) : 0;
    const fy = (() => { const d = new Date(b.created_at); const y = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1; return `${String(y).slice(2)}-${String(y + 1).slice(2)}`; })();
    const addons: { name: string; unitPrice: number; qty: number }[] = []; // extras are not sold any more
    res.json({ invoice: {
      addons, kind: gstin ? 'tax_invoice' : 'receipt', number: `INV/${fy}/${b.reference}`, date: b.created_at, reference: b.reference,
      supplier: { name: b.business_name, gstin, address: b.business_address ?? `${b.address}, ${b.city}`, state: b.state },
      customer: { name: b.customer_name }, place: { venue: b.venue_name, area: b.area_name, startsAt: b.starts_at },
      sac, rate: gstin ? rate : 0, subtotal: round2(b.subtotal), discount: round2(b.discount), taxable, cgst: round2(tax / 2), sgst: round2(tax - round2(tax / 2)), total, paymentStatus: b.payment_status } });
  });

  return r;
}
