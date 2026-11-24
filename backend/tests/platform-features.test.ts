import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { approveOwner, createAdmin, createApprovedVenue, dateIn, ist, pay, registerUser, setup, startBooking, type TestEnv } from './helpers.js';
import { runMaintenance } from '../src/lib/bookings.js';

let env: TestEnv; let admin: Awaited<ReturnType<typeof createAdmin>>; let fx: Awaited<ReturnType<typeof createApprovedVenue>>;
beforeAll(async () => { env = await setup(); admin = await createAdmin(env); fx = await createApprovedVenue(env, admin); });
beforeEach(() => { env.clock.offsetMs = 0; });
const hour = 3600000;
const setDiscount = (percent: number, who: any = fx.owner) => request(env.app).put(`/api/owner/venues/${fx.venue.id}/discount`).set(who.auth).send({ percent });
const reminders = async (userId: string) => (await env.db.query(`SELECT title FROM notifications WHERE user_id=$1 AND type='booking_reminder' ORDER BY created_at`, [userId])).rows.map((r: any) => r.title);

describe('venue discount', () => {
  it('is set by the owner, shown to customers, and comes off the price before a coupon', async () => {
    await setDiscount(91).expect(400); await setDiscount(-1).expect(400);
    const other = await registerUser(env, 'owner'); await approveOwner(env, admin, other); await setDiscount(10, other).expect(404); // not their venue
    expect((await setDiscount(25).expect(200)).body.discountPercent).toBe(25);
    expect(((await request(env.app).get('/api/venues').expect(200)).body.venues as any[])[0].discount_percent).toBe(25);
    const date = dateIn(8); const c = await registerUser(env, 'customer');
    const slots = await request(env.app).get(`/api/areas/${fx.area.id}/slots`).query({ date, sportId: fx.football.id, duration: 60 }).expect(200);
    expect(slots.body.discountPercent).toBe(25);
    const r = await startBooking(env, c, fx, ist(date, '10:00')); // 800/hr in the morning
    expect(r.booking.status).toBe(201); expect(r.booking.body.total).toBe(600); // 800 - 25%
    const row = (await env.db.query('SELECT subtotal, discount, venue_discount, total FROM bookings WHERE id=$1', [r.booking.body.bookingId])).rows[0];
    expect(Number(row.subtotal)).toBe(800); expect(Number(row.venue_discount)).toBe(200); expect(Number(row.discount)).toBe(200); expect(Number(row.total)).toBe(600);
  });

  it('stacks with a coupon, which is worked out on the already discounted price', async () => {
    await setDiscount(25).expect(200);
    await request(env.app).post('/api/owner/coupons').set(fx.owner.auth).send({ code: 'EXTRA10', venueId: fx.venue.id, discountType: 'percent', value: 10, validTo: new Date(Date.now() + 30 * 86400000).toISOString() }).expect(201);
    const c = await registerUser(env, 'customer');
    const r = await startBooking(env, c, fx, ist(dateIn(9), '10:00'), 60, 'EXTRA10');
    expect(r.booking.body.total).toBe(540); // 800 -> 600 after the venue discount -> 540 after 10%
    expect(Number((await env.db.query('SELECT discount FROM bookings WHERE id=$1', [r.booking.body.bookingId])).rows[0].discount)).toBe(260);
    await setDiscount(0).expect(200);
    expect(((await request(env.app).get('/api/venues').expect(200)).body.venues as any[])[0].discount_percent).toBe(0);
  });
});

describe('game reminders', () => {
  it('sends one reminder about a day before and one about two hours before, never twice', async () => {
    const c = await registerUser(env, 'customer'); const date = dateIn(12);
    const r = await startBooking(env, c, fx, ist(date, '18:00')); await pay(env, c, r.booking.body.bookingId, r.booking.body.order.id);
    const start = new Date(ist(date, '18:00')).getTime();
    env.clock.offsetMs = start - 30 * hour - Date.now(); await runMaintenance(env.ctx);
    expect(await reminders(c.id)).toEqual([]); // too early
    env.clock.offsetMs = start - 23 * hour - Date.now(); await runMaintenance(env.ctx); await runMaintenance(env.ctx);
    expect(await reminders(c.id)).toEqual(['Your game is tomorrow']); // once, even though maintenance ran twice
    env.clock.offsetMs = start - 90 * 60000 - Date.now(); await runMaintenance(env.ctx); await runMaintenance(env.ctx);
    expect(await reminders(c.id)).toEqual(['Your game is tomorrow', 'Your game starts soon']);
  });

  it('sends only the near reminder for a booking made inside the last day, and none for a cancelled one', async () => {
    const c = await registerUser(env, 'customer'); const date = dateIn(14);
    const a = await startBooking(env, c, fx, ist(date, '17:00')); await pay(env, c, a.booking.body.bookingId, a.booking.body.order.id);
    const b = await startBooking(env, c, fx, ist(date, '19:00')); await pay(env, c, b.booking.body.bookingId, b.booking.body.order.id);
    await request(env.app).post(`/api/bookings/${b.booking.body.bookingId}/cancel`).set(c.auth).send({}).expect(200);
    env.clock.offsetMs = new Date(ist(date, '17:00')).getTime() - hour - Date.now(); await runMaintenance(env.ctx);
    expect(await reminders(c.id)).toEqual(['Your game starts soon']);
  });
});

describe('owner payout dates and monthly statement', () => {
  it('shows when each booking is released, and lists the month in a CSV with totals', async () => {
    const c = await registerUser(env, 'customer'); const date = dateIn(16);
    const r = await startBooking(env, c, fx, ist(date, '10:00')); await pay(env, c, r.booking.body.bookingId, r.booking.body.order.id);
    const tx = async () => ((await request(env.app).get('/api/owner/transactions').set(fx.owner.auth).expect(200)).body.transactions as any[]).find((t) => t.booking_id === r.booking.body.bookingId);
    expect(await tx()).toMatchObject({ release_state: 'holding' }); // the game has not happened yet
    const end = new Date(ist(date, '11:00')).getTime();
    await env.db.query(`UPDATE bookings SET status='completed' WHERE id=$1`, [r.booking.body.bookingId]);
    env.clock.offsetMs = end + 49 * hour - Date.now();
    const t = await tx(); expect(t.release_state).toBe('released'); expect(new Date(t.release_at).getTime()).toBe(end + 48 * hour);
    const month = date.slice(0, 7);
    const res = await request(env.app).get('/api/owner/statements/monthly.csv').query({ month }).set(fx.owner.auth).expect(200);
    expect(res.headers['content-type']).toMatch(/csv/); expect(res.text).toContain(r.booking.body.reference); expect(res.text).toContain('TOTAL'); expect(res.text).toContain('released');
    await request(env.app).get('/api/owner/statements/monthly.csv').query({ month: '2026-13' }).set(fx.owner.auth).expect(400);
    expect((await request(env.app).get('/api/owner/statements/monthly.csv').query({ month: '2020-01' }).set(fx.owner.auth).expect(200)).text).toMatch(/No online bookings/);
  });
});

describe('admin audit search and coupon performance', () => {
  it('finds log entries by text, actor and date', async () => {
    await setDiscount(5).expect(200);
    const logs = async (q: Record<string, string>) => (await request(env.app).get('/api/admin/audit-logs').query(q).set(admin.auth).expect(200)).body.logs as any[];
    expect((await logs({ q: 'venue.discount' })).length).toBeGreaterThan(0);
    expect((await logs({ q: 'no-such-thing-anywhere' }))).toHaveLength(0);
    expect((await logs({ from: dateIn(1) }))).toHaveLength(0); // nothing is from the future
    expect((await logs({ from: dateIn(-1), to: dateIn(1), action: 'venue.discount' })).length).toBeGreaterThan(0);
    await request(env.app).get('/api/admin/audit-logs').query({ from: 'not-a-date' }).set(admin.auth).expect(400);
  });

  it('reports how a coupon is used: bookings, discount given, revenue and customers', async () => {
    await setDiscount(0).expect(200);
    await request(env.app).post('/api/owner/coupons').set(fx.owner.auth).send({ code: 'PERF20', venueId: fx.venue.id, discountType: 'percent', value: 20, validTo: new Date(Date.now() + 30 * 86400000).toISOString() }).expect(201);
    const c = await registerUser(env, 'customer');
    const r = await startBooking(env, c, fx, ist(dateIn(20), '10:00'), 60, 'PERF20'); await pay(env, c, r.booking.body.bookingId, r.booking.body.order.id);
    const perf = ((await request(env.app).get('/api/admin/coupons/performance').set(admin.auth).expect(200)).body.coupons as any[]).find((x) => x.code === 'PERF20');
    expect(perf).toMatchObject({ bookings: 1, customers: 1, discount_given: 160, revenue: 640 });
  });
});
