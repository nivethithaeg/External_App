// Test-only: walk-in bookings can no longer be made in the app, but older ones (and venue events, also source 'offline') are still edited,
// paid and cancelled there. This puts one in the database the way the old "Add offline booking" did, so those paths stay tested.
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Ctx, AuthUser } from '../src/types.js';
import { HttpError, badRequest, conflict, forbidden } from '../src/errors.js';
import { loadAreaContext, quote } from '../src/lib/slots.js';
import { round2 } from '../src/lib/pricing.js';
import { reference } from '../src/lib/bookings.js';
import { normalizePhone } from '../src/lib/phone.js';
import type { TestEnv } from './helpers.js';

interface OfflineBookingInput { customerCity?: string; opponent1Name?: string; opponent1Phone?: string; opponent1City?: string; opponentCity?: string; areaId: string; sportId: number; startsAt: string; durationMinutes: number; customerName: string; customerPhone: string; customerEmail?: string | null; opponentName?: string; opponentPhone?: string; eventKind?: 'event' | 'academic'; eventTitle?: string; amount?: number; amountPaid?: number; paymentMethod: 'cash' | 'upi' | 'card' | 'unpaid' | 'online' | 'offline'; notes?: string }

/**
 * The owner books a slot for someone who is not using the app. The slot is checked exactly as for an online booking (opening hours, slot grid,
 * price, nobody else on it, nobody holding it), then confirmed at once. No payment is taken through PlaynX, so there is no commission and
 * the booking is not part of any payout. The amount is what the owner collects at the venue.
 */
async function createOfflineBooking(ctx: Ctx, owner: AuthUser, input: OfflineBookingInput) {
  const now = ctx.now();
  const out = await ctx.db.tx(async (q) => {
    const ac = await loadAreaContext(q, input.areaId, input.sportId);
    if (ac.venue.owner_id !== owner.id) throw forbidden();
    const qt = await quote(q, ac, input.sportId, input.startsAt, input.durationMinutes);
    if (qt.endsAt.getTime() <= now.getTime()) throw badRequest('That time has already passed', 'past');
    const range = [qt.startsAt.toISOString(), qt.endsAt.toISOString()];
    const taken = await q.query(`SELECT 1 FROM bookings WHERE area_id=$1 AND status IN ('pending','confirmed','completed','blocked') AND during && tstzrange($2::timestamptz,$3::timestamptz,'[)') LIMIT 1`, [input.areaId, ...range]);
    if (taken.rows[0]) throw conflict('That slot is already booked or blocked', 'slot_unavailable');
    const held = await q.query(`SELECT 1 FROM slot_locks WHERE area_id=$1 AND expires_at > $4 AND during && tstzrange($2::timestamptz,$3::timestamptz,'[)') LIMIT 1`, [input.areaId, ...range, now.toISOString()]);
    if (held.rows[0]) throw conflict('A customer is booking that slot right now. Try again in a few minutes, or choose another slot.', 'slot_held');
    const subtotal = qt.price;
    const total = round2(input.amount ?? subtotal);
    const discount = round2(Math.max(0, subtotal - total));
    const paid = round2(Math.min(total, input.amountPaid ?? (input.paymentMethod === 'unpaid' ? 0 : total)));
    const ref = reference();
    const b = (await q.query(
      `INSERT INTO bookings (reference, customer_id, venue_id, area_id, sport_id, during, status, subtotal, discount, total, commission_rate, commission_amount, owner_amount, notes, qr_token,
                             source, walkin_name, walkin_phone, walkin_email, payment_method, amount_paid, opponent_name, opponent_phone, event_kind, event_title, walkin_city, opponent1_name, opponent1_phone, opponent1_city, opponent_city)
       VALUES ($1,NULL,$2,$3,$4,tstzrange($5::timestamptz,$6::timestamptz,'[)'),'confirmed',$7,$8,$9,0,0,$9,$10,$11,'offline',$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25) RETURNING id, reference`,
      [ref, ac.venue.id, input.areaId, input.sportId, ...range, subtotal, discount, total, input.notes ?? null, crypto.randomBytes(24).toString('hex'),
       input.customerName, input.customerPhone, input.customerEmail || null, input.paymentMethod, paid, input.opponentName || null, input.opponentPhone || null, input.eventKind ?? null, input.eventTitle || null, input.customerCity || null, input.opponent1Name || null, input.opponent1Phone || null, input.opponent1City || null, input.opponentCity || null])).rows[0];
    for (const [n, m, c] of [[input.opponentName, input.opponentPhone, input.opponentCity], [input.opponent1Name, input.opponent1Phone, input.opponent1City]] as const) if (n && m) await q.query(`INSERT INTO owner_customers (owner_id, name, mobile, city, source) VALUES ($1,$2,$3,$4,'opponent') ON CONFLICT (owner_id, mobile) DO NOTHING`, [owner.id, n, m, c || null]);
    if (paid > 0) await q.query(`INSERT INTO booking_payments (booking_id, amount, mode, note, recorded_by) VALUES ($1,$2,$3,'Recorded when the booking was made',$4)`, [b.id, paid, input.paymentMethod === 'unpaid' ? 'offline' : input.paymentMethod, owner.id]);
    await q.query(`INSERT INTO audit_logs (actor_id, action, entity, entity_id, metadata) VALUES ($1,'booking.offline_created','booking',$2,$3::jsonb)`, [owner.id, b.id, JSON.stringify({ reference: b.reference, total, paymentMethod: input.paymentMethod })]);
    return { bookingId: b.id as string, reference: b.reference as string, venueId: ac.venue.id, venueName: ac.venue.name, areaName: ac.area.name, timezone: ac.venue.timezone, startsAt: qt.startsAt, endsAt: qt.endsAt, subtotal, total, discount };
  });
  ctx.realtime.toVenue(out.venueId, 'slots:changed', { areaId: input.areaId });
  return out;
}

/** Like the old POST /api/owner/bookings/offline: `walkIn(env, owner.auth).send(body)`, then `.expect(201)` or read `.status` / `.body`. */
export function walkIn(env: TestEnv, auth: { Authorization: string }) {
  const ownerId = (jwt.decode(auth.Authorization.replace(/^Bearer /, '')) as any).sub as string;
  return {
    send(body: any) {
      const run = (async () => {
        try {
          const input = { paymentMethod: 'cash', ...body, customerPhone: normalizePhone(body.customerPhone), ...(body.opponentPhone ? { opponentPhone: normalizePhone(body.opponentPhone) } : {}), ...(body.opponent1Phone ? { opponent1Phone: normalizePhone(body.opponent1Phone) } : {}) };
          const out = await createOfflineBooking(env.ctx as Ctx, { id: ownerId, role: 'owner' } as AuthUser, input);
          return { status: 201, body: out as any };
        } catch (e: any) { if (e instanceof HttpError) return { status: e.status, body: { error: { code: e.code, message: e.message } } as any }; throw e; }
      })();
      return Object.assign(run, { expect: async (code: number) => { const r = await run; if (r.status !== code) throw new Error(`expected ${code}, got ${r.status} ${JSON.stringify(r.body)}`); return r; } });
    },
  };
}
