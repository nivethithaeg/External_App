import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import { WEBHOOK_SECRET, createAdmin, createApprovedVenue, dateIn, ist, pay, registerUser, setup, startBooking, type TestEnv } from './helpers.js';

let env: TestEnv; let fx: Awaited<ReturnType<typeof createApprovedVenue>>;
beforeAll(async () => { env = await setup(); fx = await createApprovedVenue(env, await createAdmin(env)); });

const send = (body: object, opts: { secret?: string; eventId?: string } = {}) => {
  const raw = JSON.stringify(body);
  const sig = crypto.createHmac('sha256', opts.secret ?? WEBHOOK_SECRET).update(raw).digest('hex');
  return request(env.app).post('/api/webhooks/razorpay').set('Content-Type', 'application/json').set('x-razorpay-signature', sig)
    .set('x-razorpay-event-id', opts.eventId ?? `evt_${crypto.randomUUID()}`).send(raw);
};
const notes = async (userId: string) =>
  (await env.db.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND type='booking_confirmed'`, [userId])).rows[0].n;

describe('Razorpay webhook', () => {
  it('rejects bad signatures and does not touch the booking', async () => {
    const c = await registerUser(env, 'customer');
    const { booking } = await startBooking(env, c, fx, ist(dateIn(6), '10:00'));
    const res = await send({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_x', order_id: booking.body.order.id } } } }, { secret: 'wrong' });
    expect(res.status).toBe(400);
    expect((await env.db.query('SELECT status FROM bookings WHERE id=$1', [booking.body.bookingId])).rows[0].status).toBe('pending');
  });

  it('confirms the booking on payment.captured and ignores replays of the same event id', async () => {
    const c = await registerUser(env, 'customer');
    const { booking } = await startBooking(env, c, fx, ist(dateIn(6), '11:00'));
    const evt = { event: 'payment.captured', payload: { payment: { entity: { id: 'pay_wh1', order_id: booking.body.order.id, method: 'upi' } } } };
    expect((await send(evt, { eventId: 'evt_fixed_1' })).status).toBe(200);
    expect((await env.db.query('SELECT status FROM bookings WHERE id=$1', [booking.body.bookingId])).rows[0].status).toBe('confirmed');
    const replay = await send(evt, { eventId: 'evt_fixed_1' });
    expect(replay.body.duplicate).toBe(true);
    expect(await notes(c.id)).toBe(1);
    expect((await env.db.query('SELECT status, method FROM payments WHERE razorpay_order_id=$1', [booking.body.order.id])).rows[0]).toMatchObject({ status: 'captured', method: 'upi' });
  });

  it('a new event id for an already-captured payment is still safe (idempotent confirm)', async () => {
    const c = await registerUser(env, 'customer');
    const { booking } = await startBooking(env, c, fx, ist(dateIn(6), '12:00'));
    const evt = { event: 'payment.captured', payload: { payment: { entity: { id: 'pay_wh2', order_id: booking.body.order.id } } } };
    expect((await send(evt)).status).toBe(200);
    expect((await send(evt)).status).toBe(200);
    expect(await notes(c.id)).toBe(1);
  });

  it('webhook and client verification racing each other still confirm exactly once', async () => {
    const c = await registerUser(env, 'customer');
    const { booking } = await startBooking(env, c, fx, ist(dateIn(6), '14:00'));
    const pid = 'pay_race';
    const sig = crypto.createHmac('sha256', 'rzp_secret_test').update(`${booking.body.order.id}|${pid}`).digest('hex');
    const [a, b] = await Promise.all([
      send({ event: 'payment.captured', payload: { payment: { entity: { id: pid, order_id: booking.body.order.id } } } }),
      request(env.app).post(`/api/bookings/${booking.body.bookingId}/verify-payment`).set(c.auth)
        .send({ razorpay_order_id: booking.body.order.id, razorpay_payment_id: pid, razorpay_signature: sig }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await notes(c.id)).toBe(1);
  });

  it('records payment.failed without confirming', async () => {
    const c = await registerUser(env, 'customer');
    const { booking } = await startBooking(env, c, fx, ist(dateIn(6), '13:00'));
    expect((await send({ event: 'payment.failed', payload: { payment: { entity: { id: 'pay_f', order_id: booking.body.order.id } } } })).status).toBe(200);
    expect((await env.db.query('SELECT status FROM payments WHERE razorpay_order_id=$1', [booking.body.order.id])).rows[0].status).toBe('failed');
    expect((await env.db.query('SELECT status FROM bookings WHERE id=$1', [booking.body.bookingId])).rows[0].status).toBe('pending');
  });
});

describe('a payment that did not go through', () => {
  it('frees the slot at once, marks the payment failed, and only the booking owner can do it', async () => {
    const c = await registerUser(env, 'customer'); const other = await registerUser(env, 'customer');
    const at = ist(dateIn(6), '17:00');
    const { booking } = await startBooking(env, c, fx, at);
    const id = booking.body.bookingId;
    expect((await request(env.app).post(`/api/bookings/${id}/payment-failed`).set(other.auth)).status).toBe(403);
    const taken = await startBooking(env, other, fx, at); expect(taken.lock.status).toBe(409); // held for the first customer meanwhile
    const res = await request(env.app).post(`/api/bookings/${id}/payment-failed`).set(c.auth);
    expect(res.status).toBe(200); expect(res.body.released).toBe(true);
    expect((await env.db.query('SELECT status, cancel_reason FROM bookings WHERE id=$1', [id])).rows[0]).toMatchObject({ status: 'cancelled', cancel_reason: 'Payment not completed' });
    expect((await env.db.query('SELECT status FROM payments WHERE booking_id=$1', [id])).rows[0].status).toBe('failed');
    const again = await startBooking(env, other, fx, at); expect(again.lock.status).toBe(201); // the slot is free for someone else
    expect((await request(env.app).post(`/api/bookings/${id}/payment-failed`).set(c.auth)).body.released).toBe(false); // idempotent
  });

  it('does not touch a booking that was paid in the meantime', async () => {
    const c = await registerUser(env, 'customer');
    const { booking } = await startBooking(env, c, fx, ist(dateIn(6), '18:00'));
    await pay(env, c, booking.body.bookingId, booking.body.order.id).then((r) => expect(r.status).toBe(200));
    expect((await request(env.app).post(`/api/bookings/${booking.body.bookingId}/payment-failed`).set(c.auth)).body.released).toBe(false);
    expect((await env.db.query('SELECT status FROM bookings WHERE id=$1', [booking.body.bookingId])).rows[0].status).toBe('confirmed');
  });
});
