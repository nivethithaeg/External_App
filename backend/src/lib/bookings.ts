import crypto from 'node:crypto';
import type { Ctx, AuthUser } from '../types.js';
import type { Queryable } from '../db.js';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../errors.js';
import { assertDuration, loadAreaContext, quote } from './slots.js';
import { evaluateCoupon } from './coupons.js';
import { round2 } from './pricing.js';
import { releaseWalletFor, walletBalance, walletCredit, walletDebit } from './wallet.js';
import { getSetting } from './settings.js';
import { emailLayout } from './mailer.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function reference() {
  const rnd = Array.from(crypto.randomBytes(7), (b) => ALPHABET[b % ALPHABET.length]).join('');
  return `PX-${rnd}`;
}
const fmt = (d: Date, tz: string) => d.toLocaleString('en-IN', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' });

// ---------------------------------------------------------------- slot locks
export async function lockSlot(ctx: Ctx, user: AuthUser, input: { areaId: string; sportId: number; startsAt: string; durationMinutes: number }) {
  const now = ctx.now();
  const lockMinutes = await getSetting<number>(ctx.db, 'slot_lock_minutes', 10);
  const result = await ctx.db.tx(async (q) => {
    const ac = await loadAreaContext(q, input.areaId, input.sportId);
    if (!ac.area.instant_booking) throw new HttpError(409, 'This playing area takes bookings through the venue. Please contact the venue to book it.', 'request_only');
    const qt = await quote(q, ac, input.sportId, input.startsAt, input.durationMinutes);
    if (qt.startsAt.getTime() <= now.getTime()) throw badRequest('That time has already passed', 'past');
    const maxDays = Math.min(await getSetting<number>(q, 'max_advance_booking_days', 60), ac.area.advance_booking_days ?? 365);
    if (qt.startsAt.getTime() - now.getTime() > maxDays * 86400000) throw badRequest(`Bookings open up to ${maxDays} days in advance`, 'too_far');

    await q.query(`DELETE FROM slot_locks WHERE expires_at <= $1`, [now.toISOString()]);
    await q.query(`DELETE FROM slot_locks WHERE user_id = $1`, [user.id]); // one active hold per user
    const range = [qt.startsAt.toISOString(), qt.endsAt.toISOString()];
    // Free the slot of any unpaid hold that has run out, and of this customer's own unpaid hold (they came back after closing the payment window).
    const stale = await q.query(
      `UPDATE bookings SET status='expired', cancel_reason='Payment not completed in time' WHERE area_id=$1 AND status='pending' AND during && tstzrange($2::timestamptz,$3::timestamptz,'[)')
         AND (expires_at <= $4::timestamptz OR (customer_id=$5 AND NOT is_split AND series_id IS NULL AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.booking_id=bookings.id AND p.status='captured'))) RETURNING id`,
      [input.areaId, ...range, now.toISOString(), user.id]);
    for (const r of stale.rows) { await releaseCoupon(q, r.id); await releaseWalletFor(q, r.id, now); }
    const taken = await q.query(
      `SELECT 1 FROM bookings WHERE area_id=$1 AND status IN ('pending','confirmed','completed','blocked') AND during && tstzrange($2::timestamptz,$3::timestamptz,'[)') LIMIT 1`,
      [input.areaId, ...range]);
    if (taken.rows[0]) throw conflict('That slot has just been taken', 'slot_unavailable');
    const expires = new Date(now.getTime() + lockMinutes * 60000);
    // The EXCLUDE constraint is the real arbiter if two users race here (-> 23P01 -> HTTP 409).
    const ins = await q.query(
      `INSERT INTO slot_locks (area_id, user_id, sport_id, during, expires_at)
       VALUES ($1,$2,$3,tstzrange($4::timestamptz,$5::timestamptz,'[)'),$6) RETURNING id`,
      [input.areaId, user.id, input.sportId, ...range, expires.toISOString()]);
    return { lockId: ins.rows[0].id as string, venueId: ac.venue.id, expiresAt: expires, startsAt: qt.startsAt, endsAt: qt.endsAt, price: qt.price };
  });
  ctx.realtime.toVenue(result.venueId, 'slots:changed', { areaId: input.areaId });
  return result;
}

export async function releaseLock(ctx: Ctx, user: AuthUser, lockId: string) {
  const { rows } = await ctx.db.query(
    `DELETE FROM slot_locks l USING playing_areas a WHERE l.id=$1 AND l.user_id=$2 AND a.id=l.area_id RETURNING a.venue_id, l.area_id`, [lockId, user.id]);
  if (rows[0]) ctx.realtime.toVenue(rows[0].venue_id, 'slots:changed', { areaId: rows[0].area_id });
}

// ---------------------------------------------------------------- booking creation
export async function createBooking(ctx: Ctx, user: AuthUser, input: { lockId: string; couponCode?: string; useWallet?: boolean }) {
  const now = ctx.now();
  const created = await ctx.db.tx(async (q) => {
    const lk = await q.query(
      `SELECT id, area_id, sport_id, lower(during) AS s, upper(during) AS e, expires_at FROM slot_locks WHERE id=$1 AND user_id=$2 FOR UPDATE`, [input.lockId, user.id]);
    const lock = lk.rows[0];
    if (!lock) throw new HttpError(410, 'Your slot hold has expired. Please select the slot again.', 'lock_expired');
    if (new Date(lock.expires_at) <= now) {
      await q.query('DELETE FROM slot_locks WHERE id=$1', [lock.id]);
      throw new HttpError(410, 'Your slot hold has expired. Please select the slot again.', 'lock_expired');
    }
    const ac = await loadAreaContext(q, lock.area_id, lock.sport_id);
    const start = new Date(lock.s), end = new Date(lock.e);
    const qt = await quote(q, ac, lock.sport_id, start.toISOString(), Math.round((end.getTime() - start.getTime()) / 60000));
    const subtotal = qt.price;

    // the venue's own discount comes off first; a coupon is then worked out on what is left
    const venueDiscount = round2((subtotal * (ac.venue.discount_percent ?? 0)) / 100);
    let discount = venueDiscount, couponId: string | null = null;
    if (input.couponCode) {
      const c = await evaluateCoupon(q, input.couponCode, user.id, ac.venue.id, round2(subtotal - venueDiscount), now);
      discount = round2(venueDiscount + c.discount); couponId = c.couponId;
    }
    const addonsTotal = 0; // extras (add-ons) are not sold any more
    const total = round2(subtotal - discount);
    // pay part (or all) from the wallet if the customer asked; the card is charged only for what is left
    // the venue owner may take only an advance online (a percentage); the rest is paid at the venue after the game
    const adv = (await q.query(`SELECT payment_collection, advance_percent FROM owner_onboarding WHERE owner_id=$1`, [ac.venue.owner_id])).rows[0];
    const advance = adv?.payment_collection === 'advance' && adv.advance_percent && total > 0 ? round2((total * Number(adv.advance_percent)) / 100) : null;
    const dueNow = advance ?? total;
    const walletUse = input.useWallet && dueNow > 0 ? round2(Math.min(await walletBalance(q, user.id, now), dueNow)) : 0;
    const cardDue = round2(dueNow - walletUse);
    const owner = await q.query('SELECT commission_override FROM owner_profiles WHERE user_id=$1', [ac.venue.owner_id]);
    const rate = Number(owner.rows[0]?.commission_override ?? (await getSetting<number>(q, 'commission_percent', 10)));
    const commission = round2((total * rate) / 100);
    const ref = reference();
    const free = cardDue === 0;

    const b = await q.query(
      `INSERT INTO bookings (reference, customer_id, venue_id, area_id, sport_id, during, status, subtotal, discount, venue_discount, total, wallet_amount,
         commission_rate, commission_amount, owner_amount, coupon_id, qr_token, expires_at, addons_total, advance_amount, amount_paid)
       VALUES ($1,$2,$3,$4,$5,tstzrange($6::timestamptz,$7::timestamptz,'[)'),$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING id`,
      [ref, user.id, ac.venue.id, lock.area_id, lock.sport_id, start.toISOString(), end.toISOString(), free ? 'confirmed' : 'pending',
       subtotal, discount, venueDiscount, total, walletUse, rate, commission, round2(total - commission), couponId, crypto.randomBytes(24).toString('hex'), lock.expires_at, addonsTotal, advance, advance]);
    if (walletUse > 0 && !(await walletDebit(q, { userId: user.id, amount: walletUse, kind: 'booking_payment', note: `Booking ${ref}`, bookingId: b.rows[0].id, now }))) throw conflict('Your wallet balance changed. Please try again.', 'wallet_changed');
    await q.query('DELETE FROM slot_locks WHERE id=$1', [lock.id]);

    if (couponId) {
      const upd = await q.query(
        `UPDATE coupons SET used_count = used_count + 1 WHERE id=$1 AND (usage_limit IS NULL OR used_count < usage_limit)`, [couponId]);
      if (!upd.rowCount) throw badRequest('This coupon has been fully redeemed', 'coupon_exhausted');
      await q.query('INSERT INTO coupon_redemptions (coupon_id,user_id,booking_id) VALUES ($1,$2,$3)', [couponId, user.id, b.rows[0].id]);
    }
    return { bookingId: b.rows[0].id as string, reference: ref, total, cardDue, walletUse, free, ac, start, end, advance };
  });

  if (created.free) {
    await afterConfirmed(ctx, created.bookingId);
    return { bookingId: created.bookingId, reference: created.reference, total: created.total, walletUsed: created.walletUse, cardDue: 0, order: null };
  }
  try {
    const order = await ctx.gateway.createOrder(created.cardDue, created.reference);
    await ctx.db.query(
      `INSERT INTO payments (booking_id, razorpay_order_id, amount, currency) VALUES ($1,$2,$3,$4)`,
      [created.bookingId, order.id, created.cardDue, order.currency]);
    return {
      bookingId: created.bookingId, reference: created.reference, total: created.total, walletUsed: created.walletUse, cardDue: created.cardDue, advance: created.advance, payAtVenue: created.advance != null ? round2(created.total - created.advance) : 0,
      order: { id: order.id, amount: order.amount, currency: order.currency, keyId: ctx.gateway.keyId() },
    };
  } catch (e) {
    await expireBooking(ctx, created.bookingId, 'Payment order could not be created');
    throw e;
  }
}

/** Everyone who paid a share of a booking that did not go ahead gets their money back, and the shares are closed. */
export async function refundSplitPayments(ctx: Ctx, bookingId: string, reason: string) {
  const pays = (await ctx.db.query(`SELECT id, payer_id, amount::float8 AS amount FROM payments WHERE booking_id=$1 AND status IN ('captured','partially_refunded') AND razorpay_payment_id IS NOT NULL`, [bookingId])).rows;
  const b = (await ctx.db.query('SELECT reference FROM bookings WHERE id=$1', [bookingId])).rows[0];
  for (const p of pays) {
    await issueRefund(ctx, { bookingId, paymentRowId: p.id, amount: null, reason, requestedBy: null });
    if (p.payer_id) await ctx.notifier.notify(p.payer_id, { title: 'Your share was refunded', type: 'booking_cancelled', email: true, body: `Booking ${b?.reference ?? ''} did not go ahead (${reason.toLowerCase()}). Your ₹${p.amount} is being refunded.` });
  }
  return pays.length;
}

/**
 * The same slot, every week for 2 to 8 weeks, paid for in one go. Every week is checked (free, priced, inside the booking window) and held
 * together: if any single week is not available nothing is booked and the customer is told which dates clash. Each week is its own booking.
 * Coupons are not used on a series. The venue's own discount and any special-date prices apply to each week as they would to a single booking.
 */
export async function createSeries(ctx: Ctx, user: AuthUser, input: { areaId: string; sportId: number; startsAt: string; durationMinutes: number; weeks: number; useWallet?: boolean }) {
  const now = ctx.now();
  const lockMinutes = await getSetting<number>(ctx.db, 'slot_lock_minutes', 10);
  const created = await ctx.db.tx(async (q) => {
    const ac = await loadAreaContext(q, input.areaId, input.sportId);
    const maxDays = await getSetting<number>(q, 'max_advance_booking_days', 60);
    const weeksStart = Array.from({ length: input.weeks }, (_, i) => new Date(new Date(input.startsAt).getTime() + i * 7 * 86400000).toISOString());
    const rate = Number((await q.query('SELECT commission_override FROM owner_profiles WHERE user_id=$1', [ac.venue.owner_id])).rows[0]?.commission_override ?? (await getSetting<number>(q, 'commission_percent', 10)));
    await q.query('DELETE FROM slot_locks WHERE expires_at <= $1', [now.toISOString()]);
    await q.query('DELETE FROM slot_locks WHERE user_id = $1', [user.id]);
    const plan: { qt: Awaited<ReturnType<typeof quote>>; clash: boolean }[] = [];
    for (const iso of weeksStart) {
      const qt = await quote(q, ac, input.sportId, iso, input.durationMinutes); // throws a clear error for a closed day, off-grid time, or unpriced slot
      if (qt.startsAt.getTime() <= now.getTime()) throw badRequest('That time has already passed', 'past');
      if (qt.startsAt.getTime() - now.getTime() > maxDays * 86400000) throw badRequest(`Bookings open up to ${maxDays} days in advance. Choose fewer weeks.`, 'too_far');
      const range = [qt.startsAt.toISOString(), qt.endsAt.toISOString()];
      const taken = await q.query(`SELECT 1 FROM bookings WHERE area_id=$1 AND status IN ('pending','confirmed','completed','blocked') AND during && tstzrange($2::timestamptz,$3::timestamptz,'[)') LIMIT 1`, [input.areaId, ...range]);
      const held = await q.query(`SELECT 1 FROM slot_locks WHERE area_id=$1 AND expires_at > $4::timestamptz AND during && tstzrange($2::timestamptz,$3::timestamptz,'[)') LIMIT 1`, [input.areaId, ...range, now.toISOString()]);
      plan.push({ qt, clash: !!(taken.rows[0] || held.rows[0]) });
    }
    const clashes = plan.filter((p) => p.clash).map((p) => p.qt.startsAt.toISOString());
    if (clashes.length) throw new HttpError(409, `${clashes.length === 1 ? 'One week is' : `${clashes.length} weeks are`} not available, so nothing was booked.`, 'series_unavailable', { unavailable: clashes });

    const totals = plan.map((p) => { const venueDiscount = round2((p.qt.price * (ac.venue.discount_percent ?? 0)) / 100); return { subtotal: p.qt.price, venueDiscount, total: round2(p.qt.price - venueDiscount) }; });
    const grand = round2(totals.reduce((n, t) => n + t.total, 0));
    let walletLeft = input.useWallet ? round2(Math.min(await walletBalance(q, user.id, now), grand)) : 0;
    const walletUse = walletLeft; const cardDue = round2(grand - walletUse); const free = cardDue === 0;
    const series = (await q.query('INSERT INTO booking_series (customer_id, weeks) VALUES ($1,$2) RETURNING id', [user.id, input.weeks])).rows[0].id as string;
    const expires = new Date(now.getTime() + lockMinutes * 60000);
    const bookings: { id: string; reference: string; startsAt: string; total: number }[] = []; let anchor: string | null = null;
    for (let i = 0; i < plan.length; i++) {
      const t = totals[i]; const w = round2(Math.min(walletLeft, t.total)); walletLeft = round2(walletLeft - w);
      const commission = round2((t.total * rate) / 100); const ref = reference();
      const b = (await q.query(
        `INSERT INTO bookings (reference, customer_id, venue_id, area_id, sport_id, during, status, subtotal, discount, venue_discount, total, wallet_amount, commission_rate, commission_amount, owner_amount, qr_token, expires_at, series_id, series_index, pay_booking_id)
         VALUES ($1,$2,$3,$4,$5,tstzrange($6::timestamptz,$7::timestamptz,'[)'),$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING id`,
        [ref, user.id, ac.venue.id, input.areaId, input.sportId, plan[i].qt.startsAt.toISOString(), plan[i].qt.endsAt.toISOString(), free ? 'confirmed' : 'pending', t.subtotal, t.venueDiscount, t.venueDiscount, t.total, w, rate, commission, round2(t.total - commission),
         crypto.randomBytes(24).toString('hex'), free ? null : expires.toISOString(), series, i, anchor])).rows[0].id as string;
      if (i === 0) { anchor = b; await q.query('UPDATE bookings SET pay_booking_id=$1 WHERE id=$1', [b]); }
      if (w > 0 && !(await walletDebit(q, { userId: user.id, amount: w, kind: 'booking_payment', note: `Booking ${ref}`, bookingId: b, now }))) throw conflict('Your wallet balance changed. Please try again.', 'wallet_changed');
      bookings.push({ id: b, reference: ref, startsAt: plan[i].qt.startsAt.toISOString(), total: t.total });
    }
    return { series, anchor: anchor as string, bookings, grand, walletUse, cardDue, free, venueId: ac.venue.id };
  });
  ctx.realtime.toVenue(created.venueId, 'slots:changed', { areaId: input.areaId });
  if (created.free) { await afterSeriesConfirmed(ctx, created.series); return { seriesId: created.series, bookingId: created.anchor, bookings: created.bookings, total: created.grand, walletUsed: created.walletUse, cardDue: 0, order: null }; }
  try {
    const order = await ctx.gateway.createOrder(created.cardDue, created.bookings[0].reference);
    await ctx.db.query(`INSERT INTO payments (booking_id, razorpay_order_id, amount, currency) VALUES ($1,$2,$3,$4)`, [created.anchor, order.id, created.cardDue, order.currency]);
    return { seriesId: created.series, bookingId: created.anchor, bookings: created.bookings, total: created.grand, walletUsed: created.walletUse, cardDue: created.cardDue, order: { id: order.id, amount: order.amount, currency: order.currency, keyId: ctx.gateway.keyId() } };
  } catch (e) {
    await ctx.db.tx(async (q) => { // the payment order could not be made: free every week and hand the wallet money back
      const rows = (await q.query(`UPDATE bookings SET status='expired', cancel_reason='Payment order could not be created' WHERE series_id=$1 AND status='pending' RETURNING id`, [created.series])).rows;
      for (const r of rows) await releaseWalletFor(q, r.id, ctx.now());
    });
    ctx.realtime.toVenue(created.venueId, 'slots:changed', { areaId: input.areaId });
    throw e;
  }
}

/** One message for the whole series instead of one per week. */
async function afterSeriesConfirmed(ctx: Ctx, seriesId: string) {
  const { rows } = await ctx.db.query(
    `SELECT b.id, b.reference, b.total::float8 AS total, b.customer_id, lower(b.during) AS s, v.id AS venue_id, v.name AS venue_name, v.owner_id, v.timezone, a.name AS area_name, a.id AS area_id
       FROM bookings b JOIN venues v ON v.id=b.venue_id JOIN playing_areas a ON a.id=b.area_id WHERE b.series_id=$1 ORDER BY b.series_index`, [seriesId]);
  if (!rows.length) return;
  const first = rows[0]; const sum = round2(rows.reduce((n: number, r: any) => n + r.total, 0));
  ctx.realtime.toVenue(first.venue_id, 'slots:changed', { areaId: first.area_id });
  await ctx.notifier.notify(first.customer_id, { title: 'Weekly booking confirmed', type: 'booking_confirmed', email: true,
    body: `${first.venue_name} (${first.area_name}): ${rows.length} weekly games from ${fmt(new Date(first.s), first.timezone)}. First reference ${first.reference}.`, data: { bookingId: first.id } });
  await ctx.notifier.notify(first.owner_id, { title: 'New weekly booking', type: 'owner_new_booking', email: true,
    body: `${first.area_name} booked for ${rows.length} weeks from ${fmt(new Date(first.s), first.timezone)} (₹${sum} in all). First ref ${first.reference}.`, data: { bookingId: first.id } });
}

async function releaseCoupon(q: Queryable, bookingId: string) {
  const r = await q.query('DELETE FROM coupon_redemptions WHERE booking_id=$1 RETURNING coupon_id', [bookingId]);
  for (const row of r.rows) await q.query('UPDATE coupons SET used_count = GREATEST(used_count-1,0) WHERE id=$1', [row.coupon_id]);
}

export async function expireBooking(ctx: Ctx, bookingId: string, reason: string) {
  const venue = await ctx.db.tx(async (q) => {
    const r = await q.query(`UPDATE bookings SET status='expired', cancel_reason=$2 WHERE id=$1 AND status='pending' RETURNING venue_id, area_id`, [bookingId, reason]);
    if (r.rows[0]) { await releaseCoupon(q, bookingId); await releaseWalletFor(q, bookingId, ctx.now()); }
    return r.rows[0];
  });
  if (venue) ctx.realtime.toVenue(venue.venue_id, 'slots:changed', { areaId: venue.area_id });
}

// ---------------------------------------------------------------- payment confirmation (idempotent)
export interface CapturedPayment { orderId: string; paymentId: string; signature?: string; method?: string }

export async function confirmPayment(ctx: Ctx, p: CapturedPayment): Promise<{ status: 'confirmed' | 'refunded' | 'partial'; bookingId: string; paid?: number; of?: number }> {
  const out = await ctx.db.tx(async (q) => {
    const pay = (await q.query(`SELECT * FROM payments WHERE razorpay_order_id=$1 FOR UPDATE`, [p.orderId])).rows[0];
    if (!pay) throw notFound('Unknown payment order');
    const booking = (await q.query(`SELECT id, status, customer_id, reference, series_id, is_split, wallet_amount::float8 AS wallet_amount, wallet_released FROM bookings WHERE id=$1 FOR UPDATE`, [pay.booking_id])).rows[0];
    if (pay.status === 'captured' || pay.status === 'refunded' || pay.status === 'partially_refunded') {
      return { status: booking.status === 'confirmed' || booking.status === 'completed' ? 'confirmed' as const : 'refunded' as const, bookingId: booking.id as string, fresh: false, payId: pay.id as string };
    }
    if (pay.razorpay_payment_id && pay.razorpay_payment_id !== p.paymentId) throw conflict('Order already paid with a different payment');
    await q.query(
      `UPDATE payments SET status='captured', razorpay_payment_id=$2, razorpay_signature=$3, method=$4, paid_at=$5 WHERE id=$1`,
      [pay.id, p.paymentId, p.signature ?? null, p.method ?? null, ctx.now().toISOString()]);

    if (booking.status === 'pending') {
      await q.query(`UPDATE bookings SET status='confirmed', expires_at=NULL WHERE id=$1 OR (series_id IS NOT NULL AND series_id=(SELECT series_id FROM bookings WHERE id=$1) AND status='pending')`, [booking.id]);
      return { status: 'confirmed' as const, bookingId: booking.id as string, fresh: true, payId: pay.id as string };
    }
    if (booking.status === 'expired' && !booking.series_id) {
      // Payment arrived after the hold lapsed: revive if nobody else took the slot, otherwise refund.
      await q.query('SAVEPOINT revive');
      try {
        // the wallet part was handed back when the hold lapsed: take it again, or if it is gone, refund the card instead
        if (booking.wallet_released && booking.wallet_amount > 0) {
          if (!(await walletDebit(q, { userId: booking.customer_id, amount: booking.wallet_amount, kind: 'booking_payment', note: `Booking ${booking.reference}`, bookingId: booking.id, now: ctx.now() }))) throw Object.assign(new Error('wallet gone'), { code: '23P01' });
          await q.query('UPDATE bookings SET wallet_released=false WHERE id=$1', [booking.id]);
        }
        await q.query(`UPDATE bookings SET status='confirmed', expires_at=NULL, cancel_reason=NULL WHERE id=$1`, [booking.id]);
        return { status: 'confirmed' as const, bookingId: booking.id as string, fresh: true, payId: pay.id as string };
      } catch (e: any) {
        if (e?.code !== '23P01') throw e;
        await q.query('ROLLBACK TO SAVEPOINT revive');
        return { status: 'refunded' as const, bookingId: booking.id as string, fresh: false, payId: pay.id as string, needsRefund: true };
      }
    }
    return { status: 'refunded' as const, bookingId: booking.id as string, fresh: false, payId: pay.id as string, needsRefund: true };
  });

  if ((out as any).needsRefund) {
    await issueRefund(ctx, { bookingId: out.bookingId, paymentRowId: (out as any).refundPayId, amount: null, reason: 'Slot no longer available after payment', requestedBy: null });
    return { status: 'refunded', bookingId: out.bookingId };
  }
  if (out.fresh) {
    const sid = (await ctx.db.query('SELECT series_id FROM bookings WHERE id=$1', [out.bookingId])).rows[0]?.series_id;
    if (sid) await afterSeriesConfirmed(ctx, sid); else await afterConfirmed(ctx, out.bookingId);
  }
  return { status: out.status, bookingId: out.bookingId };
}

export async function recordPaymentFailure(ctx: Ctx, orderId: string) {
  await ctx.db.query(`UPDATE payments SET status='failed' WHERE razorpay_order_id=$1 AND status='created'`, [orderId]);
}

async function afterConfirmed(ctx: Ctx, bookingId: string) {
  const { rows } = await ctx.db.query(
    `SELECT b.id, b.reference, b.total, b.customer_id, lower(b.during) AS s, upper(b.during) AS e, b.area_id,
            v.id AS venue_id, v.name AS venue_name, v.owner_id, v.timezone, a.name AS area_name
       FROM bookings b JOIN venues v ON v.id=b.venue_id JOIN playing_areas a ON a.id=b.area_id WHERE b.id=$1`, [bookingId]);
  const b = rows[0]; if (!b) return;
  const when = fmt(new Date(b.s), b.timezone);
  ctx.realtime.toVenue(b.venue_id, 'slots:changed', { areaId: b.area_id });
  await ctx.notifier.notify(b.customer_id, {
    title: 'Booking confirmed', type: 'booking_confirmed', email: true,
    body: `${b.venue_name} (${b.area_name}) on ${when}. Reference ${b.reference}.`, data: { bookingId: b.id },
  });
  await ctx.notifier.notify(b.owner_id, {
    title: 'New booking', type: 'owner_new_booking', email: true,
    body: `${b.area_name} booked for ${when} (₹${b.total}). Ref ${b.reference}.`, data: { bookingId: b.id },
  });
}

// ---------------------------------------------------------------- cancellation + refunds
export function refundableAmount(total: number, hoursUntilStart: number, cancellationHours: number, byVenue: boolean) {
  if (byVenue) return total;
  return hoursUntilStart >= cancellationHours ? total : 0;
}

export async function cancelBooking(ctx: Ctx, user: AuthUser, bookingId: string, reason?: string, opts: { refundTo?: 'original' | 'wallet' } = {}) {
  const now = ctx.now();
  const info = await ctx.db.tx(async (q) => {
    const r = await q.query(
      `SELECT b.*, lower(b.during) AS s, v.owner_id, v.name AS venue_name, v.cancellation_hours FROM bookings b JOIN venues v ON v.id=b.venue_id WHERE b.id=$1 FOR UPDATE OF b`, [bookingId]);
    const b = r.rows[0];
    if (!b) throw notFound('Booking not found');
    const byVenue = user.role === 'admin' || (user.role === 'owner' && b.owner_id === user.id);
    if (!byVenue && b.customer_id !== user.id) throw forbidden();
    if (b.status === 'pending') {
      // an unpaid weekly series is one purchase: cancelling any week before payment frees every week
      const ids = b.series_id ? (await q.query(`SELECT id FROM bookings WHERE series_id=$1 AND status='pending'`, [b.series_id])).rows.map((x: any) => x.id as string) : [b.id as string];
      for (const id of ids) {
        await q.query(`UPDATE bookings SET status='cancelled', cancelled_at=$2, cancel_reason=$3, cancelled_by=$4 WHERE id=$1`, [id, now.toISOString(), reason ?? 'Cancelled before payment', byVenue ? 'venue' : 'customer']);
        await releaseCoupon(q, id); await releaseWalletFor(q, id, now);
      }
      return { b, refund: 0, byVenue, paid: false };
    }
    if (b.status !== 'confirmed') throw conflict(`A ${b.status} booking cannot be cancelled`, 'not_cancellable');
    const start = new Date(b.s);
    if (!byVenue && start <= now) throw conflict('This booking has already started', 'already_started');
    const hours = (start.getTime() - now.getTime()) / 3600000;
    const offline = b.source === 'offline'; // paid (or not) at the venue, never through PlaynX: there is nothing to refund here
    const refund = offline ? 0 : refundableAmount(Number(b.advance_amount ?? b.total), hours, b.cancellation_hours, byVenue); // an advance booking: only the advance was paid online
    await q.query(`UPDATE bookings SET status='cancelled', cancelled_at=$2, cancel_reason=$3, cancelled_by=$4 WHERE id=$1`, [b.id, now.toISOString(), reason ?? null, byVenue ? 'venue' : 'customer']);
    await releaseCoupon(q, b.id);
    return { b, refund, byVenue, paid: !offline };
  });

  ctx.realtime.toVenue(info.b.venue_id, 'slots:changed', { areaId: info.b.area_id });
  let refundRow = null; let toWallet = 0;
  if (info.b.is_split) { // a group booking: refund each person's payment by the same share of the refund
    if (!info.paid) await refundSplitPayments(ctx, bookingId, reason ?? 'The organizer cancelled before everyone paid');
    else if (info.refund > 0) {
      const ratio = info.refund / Number(info.b.total);
      const pays = (await ctx.db.query(`SELECT id, payer_id, amount::float8 AS amount FROM payments WHERE booking_id=$1 AND status IN ('captured','partially_refunded') AND razorpay_payment_id IS NOT NULL`, [bookingId])).rows;
      for (const p of pays) {
        refundRow = await issueRefund(ctx, { bookingId, paymentRowId: p.id, amount: ratio >= 0.999 ? null : round2(p.amount * ratio), reason: reason ?? 'Booking cancelled', requestedBy: user.id });
      }
    }
  } else if (info.paid && info.refund > 0) {
    // The part that was paid from the wallet always goes back to the wallet. The card part goes to the original payment method, unless the
    // customer asked to keep it as wallet credit (only for their own cancellations; a venue cancelling always refunds to the original method).
    const walletPart = Math.min(round2(Number(info.b.wallet_amount ?? 0)), info.refund);
    const cardPart = round2(info.refund - walletPart);
    const keep = !info.byVenue && opts.refundTo === 'wallet';
    toWallet = round2(walletPart + (keep ? cardPart : 0));
    if (toWallet > 0) await walletCredit(ctx.db, { userId: info.b.customer_id, amount: toWallet, source: 'refund', note: `Booking ${info.b.reference} cancelled`, bookingId, now: ctx.now() });
    if (cardPart > 0 && !keep) refundRow = await issueRefund(ctx, { bookingId, payBookingId: info.b.pay_booking_id ?? undefined, amount: cardPart, reason: reason ?? 'Booking cancelled', requestedBy: user.id });
  }
  const cardRefunded = refundRow ? round2(Number(refundRow.amount)) : 0;
  const money = (n: number) => `₹${n.toLocaleString('en-IN')}`;
  if (info.b.source === 'online' && info.b.customer_id) { // the customer always gets a confirmation that says exactly what happens to their money
    const lines: string[] = [];
    if (info.paid && info.refund > 0) {
      if (toWallet > 0) lines.push(`${money(toWallet)} has been added to your PlaynX wallet and can be used on your next booking.`);
      if (cardRefunded > 0) lines.push(`${money(cardRefunded)} is being refunded to your original payment method. It usually reaches your account in 5 to 7 working days.`);
    } else if (info.paid) lines.push(`No refund applies because it was cancelled less than ${info.b.cancellation_hours} hours before the game.`);
    await ctx.notifier.notify(info.b.customer_id, {
      title: 'Booking cancelled', type: 'booking_cancelled', email: true, data: { bookingId },
      body: `Your booking ${info.b.reference} at ${info.b.venue_name} was cancelled${info.byVenue ? ' by the venue' : ''}.${lines.length ? ' ' + lines.join(' ') : ''}`,
    });
  }
  if (!info.byVenue && info.b.owner_id) await ctx.notifier.notify(info.b.owner_id, {
    title: 'Booking cancelled', type: 'booking_cancelled', email: true, data: { bookingId },
    body: `Booking ${info.b.reference} at ${info.b.venue_name} was cancelled by the customer.${info.refund > 0 ? ` A refund of ₹${info.refund} has been initiated.` : ''}`,
  });
  return { status: 'cancelled', refundAmount: info.paid ? info.refund : 0, refund: refundRow, toWallet };
}

/** Cancels this week and every later week of the series that has not started, each by its own cancellation rules. */
export async function cancelSeriesFrom(ctx: Ctx, user: AuthUser, bookingId: string, reason?: string, opts: { refundTo?: 'original' | 'wallet' } = {}) {
  const b = (await ctx.db.query('SELECT series_id, series_index, customer_id FROM bookings WHERE id=$1', [bookingId])).rows[0];
  if (!b) throw notFound('Booking not found');
  if (b.customer_id !== user.id) throw forbidden();
  if (!b.series_id) throw conflict('This booking is not part of a weekly series', 'not_in_series');
  const ids = (await ctx.db.query(`SELECT id FROM bookings WHERE series_id=$1 AND series_index >= $2 AND status='confirmed' AND lower(during) > $3::timestamptz ORDER BY series_index`, [b.series_id, b.series_index, ctx.now().toISOString()])).rows.map((r: any) => r.id as string);
  let refund = 0, toWallet = 0;
  for (const id of ids) { const r = await cancelBooking(ctx, user, id, reason, opts); refund = round2(refund + (r.refundAmount ?? 0)); toWallet = round2(toWallet + (r.toWallet ?? 0)); }
  return { cancelled: ids.length, refundAmount: refund, toWallet };
}

/**
 * The customer's payment did not go through (declined, failed, or the checkout was closed unpaid).
 * Marks the payment failed and frees the slot at once instead of holding it until the timer ends.
 * Does nothing if the booking was paid in the meantime. No notification: nothing was lost.
 */
export async function releaseUnpaidBooking(ctx: Ctx, user: AuthUser, bookingId: string) {
  const info = await ctx.db.tx(async (q) => {
    const b = (await q.query(`SELECT id, venue_id, area_id, customer_id, status, series_id, is_split FROM bookings WHERE id=$1 FOR UPDATE`, [bookingId])).rows[0];
    if (!b) throw notFound('Booking not found');
    if (b.customer_id !== user.id) throw forbidden();
    if (b.status !== 'pending') return { b, released: false };
    await q.query(`UPDATE payments SET status='failed' WHERE booking_id=$1 AND status='created'`, [bookingId]);
    const ids = b.series_id ? (await q.query(`SELECT id FROM bookings WHERE series_id=$1 AND status='pending'`, [b.series_id])).rows.map((x: any) => x.id as string) : [bookingId];
    for (const id of ids) {
      await q.query(`UPDATE bookings SET status='cancelled', cancelled_at=$2, cancel_reason='Payment not completed' WHERE id=$1`, [id, ctx.now().toISOString()]);
      await releaseCoupon(q, id); await releaseWalletFor(q, id, ctx.now());
    }
    return { b, released: true };
  });
  if (info.released) {
    ctx.realtime.toVenue(info.b.venue_id, 'slots:changed', { areaId: info.b.area_id });
    if (info.b.is_split) await refundSplitPayments(ctx, bookingId, 'The organizer did not complete payment'); // friends who already paid get their money back
  }
  return { released: info.released };
}

/** Creates a refund record then calls the gateway. amount=null refunds the full captured amount. */
export async function issueRefund(ctx: Ctx, input: { bookingId: string; payBookingId?: string; paymentRowId?: string; amount: number | null; reason: string; requestedBy: string | null }) {
  const row = await ctx.db.tx(async (q) => {
    const pay = (input.paymentRowId
      ? await q.query(`SELECT * FROM payments WHERE id=$1 AND razorpay_payment_id IS NOT NULL AND status IN ('captured','partially_refunded') FOR UPDATE`, [input.paymentRowId])
      : await q.query(`SELECT * FROM payments WHERE booking_id=$1 AND razorpay_payment_id IS NOT NULL AND status IN ('captured','partially_refunded') FOR UPDATE`, [input.payBookingId ?? input.bookingId])).rows[0]; // a weekly series is paid once, on its first booking
    if (!pay) throw conflict('No captured payment to refund', 'no_payment');
    const already = (await q.query(`SELECT COALESCE(sum(amount),0)::float8 AS n FROM refunds WHERE payment_id=$1 AND status <> 'failed'`, [pay.id])).rows[0].n as number;
    const amount = input.amount ?? round2(Number(pay.amount) - already);
    if (amount <= 0 || amount + already > Number(pay.amount) + 0.001) throw badRequest('Refund amount exceeds the amount paid', 'refund_too_large');
    const r = await q.query(
      `INSERT INTO refunds (payment_id, booking_id, amount, reason, requested_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [pay.id, input.bookingId, amount, input.reason, input.requestedBy]);
    return { refund: r.rows[0], paymentId: pay.razorpay_payment_id as string, payRowId: pay.id as string, total: Number(pay.amount), already };
  });
  return processRefund(ctx, row.refund.id, row.paymentId, row.payRowId, row.total, row.already + Number(row.refund.amount));
}

async function processRefund(ctx: Ctx, refundId: string, razorpayPaymentId: string, payRowId: string, payTotal: number, refundedAfter: number) {
  const refund = (await ctx.db.query('SELECT * FROM refunds WHERE id=$1', [refundId])).rows[0];
  try {
    const g = await ctx.gateway.refund(razorpayPaymentId, Number(refund.amount), { booking_id: refund.booking_id });
    const upd = await ctx.db.query(`UPDATE refunds SET status='processed', razorpay_refund_id=$2, processed_at=$3 WHERE id=$1 RETURNING *`, [refundId, g.id, ctx.now().toISOString()]);
    await ctx.db.query(`UPDATE payments SET status=$2 WHERE id=$1`, [payRowId, refundedAfter >= payTotal - 0.001 ? 'refunded' : 'partially_refunded']);
    await tellAboutRefund(ctx, refundId, true);
    return upd.rows[0];
  } catch (e) {
    console.error('[refund] gateway failure', e);
    const upd = await ctx.db.query(`UPDATE refunds SET status='failed' WHERE id=$1 RETURNING *`, [refundId]);
    await tellAboutRefund(ctx, refundId, false);
    return upd.rows[0];
  }
}

/** Emails the person whose money it is: refund sent (with when to expect it), or delayed (we are on it). A failure also alerts the admins. */
async function tellAboutRefund(ctx: Ctx, refundId: string, ok: boolean) {
  try {
    const r = (await ctx.db.query(
      `SELECT r.amount::float8 AS amount, r.reason, b.reference, b.customer_id, v.name AS venue_name, p.payer_id FROM refunds r JOIN bookings b ON b.id=r.booking_id JOIN venues v ON v.id=b.venue_id LEFT JOIN payments p ON p.id=r.payment_id WHERE r.id=$1`, [refundId])).rows[0];
    if (!r) return;
    if (ok && String(r.reason ?? '').startsWith('Complaint')) return; // a refund for a complaint: the complaint route sends one detailed email instead
    const who = (r.payer_id ?? r.customer_id) as string | null; const amt = `₹${Number(r.amount).toLocaleString('en-IN')}`;
    if (who) await ctx.notifier.notify(who, ok
      ? { title: 'Refund issued', type: 'refund', email: true, data: { link: '/payments' }, body: `We have sent a refund of ${amt} for booking ${r.reference} at ${r.venue_name} to your original payment method. It usually reaches your account in 5 to 7 working days.` }
      : { title: 'Your refund is delayed', type: 'refund', email: true, data: { link: '/payments' }, body: `Your refund of ${amt} for booking ${r.reference} at ${r.venue_name} could not be sent automatically. Our team has been told and will complete it. You do not need to do anything.` });
    if (!ok) await ctx.notifier.notifyAdmins('refunds', { title: 'A refund failed', type: 'admin_alert', body: `Refund of ${amt} for booking ${r.reference} failed at the payment gateway. Retry it from Refunds.`, data: { link: '/admin/refunds' } });
  } catch (e) { console.error('[refund] notify failed', e); }
}

/** Admin: retry a failed refund. */
export async function retryRefund(ctx: Ctx, refundId: string) {
  const r = (await ctx.db.query(
    `SELECT r.*, p.razorpay_payment_id, p.id AS pay_id, p.amount AS pay_total FROM refunds r JOIN payments p ON p.id=r.payment_id WHERE r.id=$1`, [refundId])).rows[0];
  if (!r) throw notFound('Refund not found');
  if (r.status === 'processed') throw conflict('Refund already processed');
  const others = (await ctx.db.query(`SELECT COALESCE(sum(amount),0)::float8 AS n FROM refunds WHERE payment_id=$1 AND status<>'failed' AND id<>$2`, [r.pay_id, refundId])).rows[0].n as number;
  return processRefund(ctx, refundId, r.razorpay_payment_id, r.pay_id, Number(r.pay_total), others + Number(r.amount));
}

// ---------------------------------------------------------------- background maintenance
export async function runMaintenance(ctx: Ctx) {
  const now = ctx.now().toISOString();
  const touched = await ctx.db.tx(async (q) => {
    await q.query('DELETE FROM slot_locks WHERE expires_at <= $1', [now]);
    const exp = await q.query(
      `UPDATE bookings SET status='expired', cancel_reason='Payment not completed in time' WHERE status='pending' AND expires_at <= $1 RETURNING id, venue_id, area_id, is_split`, [now]);
    for (const r of exp.rows) { await releaseCoupon(q, r.id); await releaseWalletFor(q, r.id, ctx.now()); }
    await q.query(`UPDATE bookings SET status='completed' WHERE status='confirmed' AND upper(during) <= $1`, [now]);
    return exp.rows as { id: string; venue_id: string; area_id: string; is_split: boolean }[];
  });
  for (const t of touched) { ctx.realtime.toVenue(t.venue_id, 'slots:changed', { areaId: t.area_id }); if (t.is_split) await refundSplitPayments(ctx, t.id, 'Not everyone paid in time').catch((e) => console.error('[split refund]', e)); }
  await sendGameReminders(ctx).catch((e) => console.error('[reminders]', e));
  return touched.length;
}

/**
 * Tells players their game is coming up: once about a day before and once about two hours before (a booking made inside those
 * windows gets just the nearest reminder). Each is marked as sent in the same statement that claims it, so it can never go out twice.
 */
export async function sendGameReminders(ctx: Ctx) {
  const now = ctx.now();
  const { rows } = await ctx.db.query(
    `SELECT b.id, b.customer_id, b.reference, lower(b.during) AS starts_at, upper(b.during) AS ends_at, v.name AS venue_name, v.timezone, a.name AS area_name,
            (b.reminder_24h_at IS NULL) AS need24, (lower(b.during) <= $1::timestamptz + interval '2 hours') AS within2
       FROM bookings b JOIN venues v ON v.id=b.venue_id JOIN playing_areas a ON a.id=b.area_id
      WHERE b.status='confirmed' AND b.source='online' AND b.customer_id IS NOT NULL
        AND lower(b.during) > $1::timestamptz AND lower(b.during) <= $1::timestamptz + interval '24 hours'
        AND (b.reminder_24h_at IS NULL OR (b.reminder_2h_at IS NULL AND lower(b.during) <= $1::timestamptz + interval '2 hours'))
      LIMIT 200`, [now.toISOString()]);
  for (const r of rows) {
    const soon = r.within2;
    const claimed = await ctx.db.query(
      soon ? `UPDATE bookings SET reminder_2h_at=$2, reminder_24h_at=COALESCE(reminder_24h_at,$2) WHERE id=$1 AND reminder_2h_at IS NULL RETURNING id`
           : `UPDATE bookings SET reminder_24h_at=$2 WHERE id=$1 AND reminder_24h_at IS NULL RETURNING id`, [r.id, now.toISOString()]);
    if (!claimed.rowCount) continue;
    const when = new Date(r.starts_at).toLocaleString('en-IN', { timeZone: r.timezone, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
    await ctx.notifier.notify(r.customer_id, {
      title: soon ? 'Your game starts soon' : 'Your game is tomorrow', type: 'booking_reminder', email: true,
      body: `${r.venue_name} · ${r.area_name} · ${when}. Booking ${r.reference}. Show this booking reference at the venue.`, data: { link: `/bookings/${r.id}` } });
  }
  return rows.length;
}

/**
 * Moves a confirmed, paid booking to another slot of the same area and sport, once, and only to a slot with the same price (so nothing
 * needs to be paid or refunded), and only before the venue's cancellation window starts. The booking keeps its reference.
 */
export async function rescheduleBooking(ctx: Ctx, user: AuthUser, bookingId: string, startsAt: string) {
  const now = ctx.now();
  const out = await ctx.db.tx(async (q) => {
    const r = await q.query(
      `SELECT b.*, lower(b.during) AS s, upper(b.during) AS e, v.owner_id, v.name AS venue_name, v.cancellation_hours, v.timezone, a.name AS area_name
         FROM bookings b JOIN venues v ON v.id=b.venue_id JOIN playing_areas a ON a.id=b.area_id WHERE b.id=$1 FOR UPDATE OF b`, [bookingId]);
    const b = r.rows[0];
    if (!b) throw notFound('Booking not found');
    if (b.customer_id !== user.id) throw forbidden();
    if (b.source !== 'online' || b.status !== 'confirmed') throw conflict('Only a confirmed booking can be rescheduled', 'not_reschedulable');
    if (b.reschedule_count >= 1) throw conflict('A booking can be rescheduled once. Cancel it and book again if your plan changes.', 'already_rescheduled');
    if (now.getTime() >= new Date(b.s).getTime() - b.cancellation_hours * 3600000)
      throw conflict(`A booking can be rescheduled up to ${b.cancellation_hours} hours before it starts`, 'too_late');
    const ac = await loadAreaContext(q, b.area_id, b.sport_id);
    const minutes = Math.round((new Date(b.e).getTime() - new Date(b.s).getTime()) / 60000);
    const qt = await quote(q, ac, b.sport_id, startsAt, minutes);
    if (qt.startsAt.getTime() <= now.getTime()) throw badRequest('That time has already passed', 'past');
    const maxDays = await getSetting<number>(q, 'max_advance_booking_days', 60);
    if (qt.startsAt.getTime() - now.getTime() > maxDays * 86400000) throw badRequest(`Bookings open up to ${maxDays} days in advance`, 'too_far');
    if (qt.startsAt.getTime() === new Date(b.s).getTime()) throw badRequest('Choose a different time', 'same_slot');
    if (round2(qt.price) !== round2(Number(b.subtotal)))
      throw conflict('That time is priced differently. Pick a slot with the same price, or cancel and book again.', 'price_differs');
    const range = [qt.startsAt.toISOString(), qt.endsAt.toISOString()];
    const taken = await q.query(
      `SELECT 1 FROM bookings WHERE area_id=$1 AND id <> $4 AND status IN ('pending','confirmed','completed','blocked') AND during && tstzrange($2::timestamptz,$3::timestamptz,'[)') LIMIT 1`, [b.area_id, ...range, b.id]);
    const held = await q.query(
      `SELECT 1 FROM slot_locks WHERE area_id=$1 AND expires_at > $4::timestamptz AND during && tstzrange($2::timestamptz,$3::timestamptz,'[)') LIMIT 1`, [b.area_id, ...range, now.toISOString()]);
    if (taken.rows[0] || held.rows[0]) throw conflict('That slot has just been taken', 'slot_unavailable');
    await q.query(
      `UPDATE bookings SET during=tstzrange($2::timestamptz,$3::timestamptz,'[)'), reschedule_count=reschedule_count+1, rescheduled_at=$4, previous_starts_at=$5, reminder_24h_at=NULL, reminder_2h_at=NULL WHERE id=$1`,
      [b.id, ...range, now.toISOString(), new Date(b.s).toISOString()]);
    await q.query(`INSERT INTO audit_logs (actor_id, action, entity, entity_id, metadata) VALUES ($1,'booking.reschedule','booking',$2,$3)`, [user.id, b.id, JSON.stringify({ from: new Date(b.s).toISOString(), to: range[0] })]);
    return { b, startsAt: qt.startsAt, endsAt: qt.endsAt };
  });
  const fmt = (d: Date | string) => new Date(d).toLocaleString('en-IN', { timeZone: out.b.timezone, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
  ctx.realtime.toVenue(out.b.venue_id, 'slots:changed', { areaId: out.b.area_id });
  await ctx.notifier.notify(user.id, { title: 'Booking rescheduled', type: 'booking_rescheduled', email: true, body: `${out.b.venue_name} · ${out.b.area_name}: now ${fmt(out.startsAt)} (was ${fmt(out.b.s)}). Booking ${out.b.reference}; the reference is unchanged.`, data: { link: `/bookings/${out.b.id}` } });
  await ctx.notifier.notify(out.b.owner_id, { title: 'A customer rescheduled', type: 'owner_booking_rescheduled', body: `${out.b.venue_name} · ${out.b.area_name}: ${out.b.reference} moved from ${fmt(out.b.s)} to ${fmt(out.startsAt)}.`, data: { link: '/owner/bookings' } });
  return { bookingId: out.b.id as string, reference: out.b.reference as string, startsAt: out.startsAt.toISOString(), endsAt: out.endsAt.toISOString() };
}

export { assertDuration, emailLayout };


