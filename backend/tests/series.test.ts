import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createAdmin, createApprovedVenue, dateIn, ist, pay, registerUser, setup, startBooking, type TestEnv } from './helpers.js';
import { runMaintenance } from '../src/lib/bookings.js';

let env: TestEnv; let admin: Awaited<ReturnType<typeof createAdmin>>; let fin: Awaited<ReturnType<typeof createAdmin>>; let fx: Awaited<ReturnType<typeof createApprovedVenue>>;
beforeAll(async () => { env = await setup(); admin = await createAdmin(env); fin = await createAdmin(env, 'finance'); fx = await createApprovedVenue(env, admin); });
beforeEach(() => { env.clock.offsetMs = 0; });
const series = (c: any, day: number, hhmm: string, weeks: number, extra: object = {}) => request(env.app).post('/api/bookings/recurring').set(c.auth).send({ areaId: fx.area.id, sportId: fx.football.id, startsAt: ist(dateIn(day), hhmm), durationMinutes: 60, weeks, ...extra });
const rows = async (sid: string) => (await env.db.query('SELECT id, status, total, wallet_amount, series_index, pay_booking_id, lower(during) AS s FROM bookings WHERE series_id=$1 ORDER BY series_index', [sid])).rows;
const wallet = async (c: any) => (await request(env.app).get('/api/me/wallet').set(c.auth).expect(200)).body.balance as number;
const topUp = (uid: string, amount: number) => request(env.app).post(`/api/admin/users/${uid}/wallet`).set(fin.auth).send({ amount, reason: 'Test credit' }).expect(200);

describe('weekly series', () => {
  it('books the same slot for several weeks in one payment, each week its own booking, confirmed together', async () => {
    const c = await registerUser(env, 'customer');
    const r = (await series(c, 10, '10:00', 4).expect(201)).body;
    expect(r).toMatchObject({ total: 3200, cardDue: 3200, walletUsed: 0 }); expect(r.bookings).toHaveLength(4); expect(r.order.amount).toBe(3200);
    const dates = r.bookings.map((b: any) => b.startsAt); for (let i = 1; i < 4; i++) expect(new Date(dates[i]).getTime() - new Date(dates[i - 1]).getTime()).toBe(7 * 86400000);
    expect((await rows(r.seriesId)).every((b) => b.status === 'pending')).toBe(true);
    expect((await env.db.query('SELECT count(*)::int AS n FROM payments WHERE booking_id=ANY($1::uuid[])', [r.bookings.map((b: any) => b.id)])).rows[0].n).toBe(1); // one payment for all
    await pay(env, c, r.bookingId, r.order.id);
    expect((await rows(r.seriesId)).every((b) => b.status === 'confirmed')).toBe(true);
    const n = (await env.db.query(`SELECT title FROM notifications WHERE user_id=$1 AND type='booking_confirmed'`, [c.id])).rows; expect(n).toHaveLength(1); expect(n[0].title).toBe('Weekly booking confirmed'); // one message, not four
    const mine = (await request(env.app).get('/api/bookings').set(c.auth).expect(200)).body.bookings as any[];
    expect(mine.filter((b) => b.series_id === r.seriesId)).toHaveLength(4); expect(mine.find((b) => b.id === r.bookings[2].id)).toMatchObject({ series_index: 2, series_count: 4, payment_status: 'captured' });
  });

  it('books nothing, and says which dates clash, when any week is unavailable', async () => {
    const c = await registerUser(env, 'customer'); const other = await registerUser(env, 'customer');
    await startBooking(env, other, fx, ist(dateIn(22), '10:00')); // takes the 3rd week
    const r = await series(c, 15, '10:00', 4).expect(409);
    expect(r.body.error.code).toBe('series_unavailable'); expect(r.body.error.details.unavailable).toHaveLength(1);
    expect((await env.db.query('SELECT count(*)::int AS n FROM booking_series WHERE customer_id=$1', [c.id])).rows[0].n).toBe(0);
    expect((await env.db.query(`SELECT count(*)::int AS n FROM bookings WHERE customer_id=$1`, [c.id])).rows[0].n).toBe(0);
  });

  it('checks the number of weeks, the booking window and the time of day', async () => {
    const c = await registerUser(env, 'customer');
    await series(c, 30, '10:00', 1).expect(400); await series(c, 30, '10:00', 9).expect(400);
    expect((await series(c, 35, '10:00', 5).expect(400)).body.error.code).toBe('too_far'); // 5 weeks from day 35 runs past the 60 day window
    expect((await series(c, 30, '10:20', 2).expect(400)).body.error.code).toBe('bad_start');
    await request(env.app).post('/api/bookings/recurring').send({}).expect(401);
  });

  it('applies the venue discount and special-date prices week by week', async () => {
    await request(env.app).put(`/api/owner/venues/${fx.venue.id}/discount`).set(fx.owner.auth).send({ percent: 10 }).expect(200);
    try {
      await request(env.app).post(`/api/owner/venues/${fx.venue.id}/price-adjustments`).set(fx.owner.auth).send({ label: 'Festival', startDate: dateIn(25), endDate: dateIn(25), percent: 50 }).expect(201);
      const c = await registerUser(env, 'customer'); const r = (await series(c, 18, '10:00', 2).expect(201)).body; // week 1 = day 18, week 2 = day 25 (festival)
      expect(r.bookings.map((b: any) => b.total)).toEqual([720, 1080]); expect(r.total).toBe(1800);
    } finally { await request(env.app).put(`/api/owner/venues/${fx.venue.id}/discount`).set(fx.owner.auth).send({ percent: 0 }).expect(200); }
  });

  it('frees every week when the payment fails or the hold runs out', async () => {
    const c = await registerUser(env, 'customer'); await topUp(c.id, 500);
    const a = (await series(c, 12, '12:00', 3, { useWallet: true }).expect(201)).body; expect(await wallet(c)).toBe(0);
    await request(env.app).post(`/api/bookings/${a.bookingId}/payment-failed`).set(c.auth).expect(200);
    expect((await rows(a.seriesId)).every((b) => b.status === 'cancelled')).toBe(true); expect(await wallet(c)).toBe(500);
    const b = (await series(c, 12, '12:00', 3).expect(201)).body; // the slots are free again
    env.clock.offsetMs = 20 * 60000; await runMaintenance(env.ctx);
    expect((await rows(b.seriesId)).every((x) => x.status === 'expired')).toBe(true);
    await pay(env, c, b.bookingId, b.order.id); // a late payment for a lapsed series is refunded, not revived
    expect((await rows(b.seriesId)).some((x) => x.status === 'confirmed')).toBe(false);
    expect(Number((await env.db.query('SELECT amount FROM refunds WHERE booking_id=$1', [b.bookingId])).rows[0].amount)).toBe(2400);
  });

  it('can be paid partly from the wallet', async () => {
    const c = await registerUser(env, 'customer'); await topUp(c.id, 1000);
    const r = (await series(c, 14, '14:00', 2, { useWallet: true }).expect(201)).body;
    expect(r).toMatchObject({ total: 1600, walletUsed: 1000, cardDue: 600 }); expect((await rows(r.seriesId)).map((b) => Number(b.wallet_amount))).toEqual([800, 200]); expect(await wallet(c)).toBe(0);
    await pay(env, c, r.bookingId, r.order.id);
    const full = (await series(await (async () => { const d = await registerUser(env, 'customer'); await topUp(d.id, 5000); return d; })(), 16, '14:00', 2, { useWallet: true }).expect(201)).body;
    expect(full).toMatchObject({ cardDue: 0, order: null }); expect((await rows(full.seriesId)).every((b) => b.status === 'confirmed')).toBe(true);
  });
});

describe('cancelling weeks of a series', () => {
  it('cancels one week with a refund of just that week from the single payment', async () => {
    const c = await registerUser(env, 'customer'); const r = (await series(c, 40, '10:00', 3).expect(201)).body; await pay(env, c, r.bookingId, r.order.id);
    const res = (await request(env.app).post(`/api/bookings/${r.bookings[1].id}/cancel`).set(c.auth).send({}).expect(200)).body;
    expect(res.refundAmount).toBe(800);
    const rf = (await env.db.query('SELECT booking_id, amount, payment_id FROM refunds ORDER BY created_at DESC LIMIT 1')).rows[0];
    expect(rf.booking_id).toBe(r.bookings[1].id); expect(Number(rf.amount)).toBe(800);
    const payId = (await env.db.query('SELECT id FROM payments WHERE booking_id=$1', [r.bookingId])).rows[0].id; expect(rf.payment_id).toBe(payId); // refunded against the one payment
    expect((await rows(r.seriesId)).map((b) => b.status)).toEqual(['confirmed', 'cancelled', 'confirmed']);
    await request(env.app).post(`/api/bookings/${r.bookings[1].id}/cancel`).set(c.auth).send({}).expect(409); // not twice
  });

  it('cancels this week and every later one, each by its own rules, to the wallet if asked', async () => {
    const c = await registerUser(env, 'customer'); const r = (await series(c, 38, '10:00', 4).expect(201)).body; await pay(env, c, r.bookingId, r.order.id);
    const res = (await request(env.app).post(`/api/bookings/${r.bookings[1].id}/cancel-series`).set(c.auth).send({ refundTo: 'wallet' }).expect(200)).body;
    expect(res).toMatchObject({ cancelled: 3, refundAmount: 2400, toWallet: 2400 }); expect(await wallet(c)).toBe(2400);
    expect((await rows(r.seriesId)).map((b) => b.status)).toEqual(['confirmed', 'cancelled', 'cancelled', 'cancelled']);
    expect((await request(env.app).post(`/api/bookings/${r.bookings[0].id}/cancel-series`).set(c.auth).send({}).expect(200)).body.cancelled).toBe(1); // only the first is left
    const single = await startBooking(env, c, fx, ist(dateIn(5), '10:00')); await pay(env, c, single.booking.body.bookingId, single.booking.body.order.id);
    await request(env.app).post(`/api/bookings/${single.booking.body.bookingId}/cancel-series`).set(c.auth).send({}).expect(409);
    await request(env.app).post(`/api/bookings/${r.bookings[2].id}/cancel-series`).set((await registerUser(env, 'customer')).auth).send({}).expect(403);
  });

  it('lets the venue cancel one week, refunding the card through the series payment', async () => {
    const c = await registerUser(env, 'customer'); const r = (await series(c, 50, '10:00', 2).expect(201)).body; await pay(env, c, r.bookingId, r.order.id);
    await request(env.app).post(`/api/owner/bookings/${r.bookings[1].id}/cancel`).set(fx.owner.auth).send({ reason: 'Ground flooded' }).expect(200);
    expect(Number((await env.db.query('SELECT amount FROM refunds WHERE booking_id=$1', [r.bookings[1].id])).rows[0].amount)).toBe(800);
    const tx = ((await request(env.app).get('/api/owner/transactions').set(fx.owner.auth).expect(200)).body.transactions as any[]).find((t) => t.booking_id === r.bookingId);
    expect(tx).toMatchObject({ series_count: 2, subtotal: 1600, amount: 1600 }); // one payment line for the whole series, with the whole series' figures
  });
});
