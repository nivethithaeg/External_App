import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { approveOwner, createAdmin, createApprovedVenue, dateIn, ist, pay, registerUser, setup, startBooking, type TestEnv } from './helpers.js';
import { runMaintenance } from '../src/lib/bookings.js';

let env: TestEnv; let admin: Awaited<ReturnType<typeof createAdmin>>; let fx: Awaited<ReturnType<typeof createApprovedVenue>>;
beforeAll(async () => { env = await setup(); admin = await createAdmin(env); fx = await createApprovedVenue(env, admin); });

const slotsUrl = (date: string, d = 60) => `/api/areas/${fx.area.id}/slots?date=${date}&sportId=${fx.football.id}&duration=${d}`;
const lockReq = (c: { auth: any }, startsAt: string, durationMinutes = 60) =>
  request(env.app).post('/api/slots/lock').set(c.auth).send({ areaId: fx.area.id, sportId: fx.football.id, startsAt, durationMinutes });

describe('discovery & availability', () => {
  it('lists only approved venues and supports filters', async () => {
    const o2 = await registerUser(env, 'owner'); await approveOwner(env, admin, o2);
    await request(env.app).post('/api/owner/venues').set(o2.auth).send({ pincode: '560001', name: 'Hidden Draft', address: '1 Nowhere Lane', city: 'Bengaluru', lat: 12.9, lng: 77.5 }).expect(201);
    const all = await request(env.app).get('/api/venues?city=bengaluru').expect(200);
    expect(all.body.venues.map((v: any) => v.name)).toEqual(['Green Arena']);
    expect(all.body.venues[0].min_price).toBe(800);
    const nearby = await request(env.app).get('/api/venues?lat=12.97&lng=77.59&radiusKm=5&sort=distance&sport=football').expect(200);
    expect(nearby.body.venues).toHaveLength(1);
    expect(nearby.body.venues[0].distance_km).toBeLessThan(2);
    expect((await request(env.app).get('/api/venues?lat=28.6&lng=77.2&radiusKm=10').expect(200)).body.venues).toHaveLength(0);
    expect((await request(env.app).get('/api/venues?minPrice=5000').expect(200)).body.venues).toHaveLength(0);
    expect((await request(env.app).get(`/api/venues?date=${dateIn(5)}`).expect(200)).body.venues).toHaveLength(1);
    expect((await request(env.app).get('/api/venues?sport=tennis').expect(200)).body.venues).toHaveLength(0);
  });

  it('filters venues by the time the customer wants: a free, priced slot that starts in that time', async () => {
    const d = dateIn(6), q = (a: string) => request(env.app).get(`/api/venues?date=${d}&${a}`);
    expect((await q('from=18:00&to=19:00').expect(200)).body.venues).toHaveLength(1);
    expect((await q('from=18:00').expect(200)).body.venues).toHaveLength(1); // no end time: any slot from 6 pm on
    expect((await q('from=03:00&to=04:00').expect(200)).body.venues).toHaveLength(0); // before opening
    expect((await q('from=22:00&to=23:59').expect(200)).body.venues).toHaveLength(1); // the last slot starts at 10 pm
    expect((await q('from=23:00&to=23:59').expect(200)).body.venues).toHaveLength(0); // no slot starts after the last one
    await q('from=19:00&to=18:00').expect(400);
    await q('from=25:00').expect(400);
  });

  it('returns priced slots on the 60 min grid, blending peak pricing for longer durations', async () => {
    const date = dateIn(5);
    const one = await request(env.app).get(slotsUrl(date)).expect(200);
    expect(one.body.slots).toHaveLength(17); // 06:00..22:00 starts
    expect(one.body.slots[0].price).toBe(800);
    expect(one.body.slots.at(-1).price).toBe(1200);
    const two = await request(env.app).get(slotsUrl(date, 120)).expect(200);
    const at17 = two.body.slots.find((s: any) => s.startsAt === new Date(ist(date, '17:00')).toISOString());
    expect(at17.price).toBe(2000);
  });

  it('rejects durations off the grid and sports the area does not offer', async () => {
    await request(env.app).get(slotsUrl(dateIn(5), 90)).expect(400);
    await request(env.app).get(`/api/areas/${fx.area.id}/slots?date=${dateIn(5)}&sportId=9999&duration=60`).expect(400);
  });
});

describe('booking flow & payment verification', () => {
  it('lock -> order -> signed payment -> confirmed with QR; slot then shows as booked', async () => {
    const c = await registerUser(env, 'customer');
    const start = ist(dateIn(6), '10:00');
    const { lock, booking } = await startBooking(env, c, fx, start, 60);
    expect(lock.status).toBe(201);
    expect(booking.status).toBe(201);
    expect(booking.body.total).toBe(800);
    expect(booking.body.order.id).toMatch(/^order_/);
    expect(booking.body.order.keyId).toBe('rzp_test_key');
    const mid = await request(env.app).get(`/api/bookings/${booking.body.bookingId}`).set(c.auth).expect(200);
    expect(mid.body.booking.status).toBe('pending');

    const ok = await pay(env, c, booking.body.bookingId, booking.body.order.id);
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('confirmed');
    const done = await request(env.app).get(`/api/bookings/${booking.body.bookingId}`).set(c.auth).expect(200);
    expect(done.body.booking.status).toBe('confirmed');
    expect(done.body.booking.reference).toMatch(/^PX-[A-Z0-9]{7}$/);
    expect(done.body.qr).toBeUndefined(); // there is no QR code: people show the booking reference at the gate
    expect(env.emails.some((e) => e.to === c.email && e.subject === 'Booking confirmed')).toBe(true);
    const ownerNotes = await request(env.app).get('/api/me/notifications').set(fx.owner.auth).expect(200);
    expect(ownerNotes.body.notifications.some((n: any) => n.type === 'owner_new_booking')).toBe(true);

    const slots = await request(env.app).get(slotsUrl(dateIn(6))).expect(200);
    const s = slots.body.slots.find((x: any) => x.startsAt === new Date(start).toISOString());
    expect(s.available).toBe(false);
    expect(s.reason).toBe('booked');
    expect((await request(env.app).get('/api/bookings').set(c.auth).expect(200)).body.bookings.length).toBeGreaterThanOrEqual(1);
    expect((await request(env.app).get('/api/owner/bookings').set(fx.owner.auth).expect(200)).body.bookings[0].customer_name).toBeTruthy();

    const gate = await request(env.app).post('/api/owner/bookings/verify').set(fx.owner.auth).send({ reference: done.body.booking.reference.toLowerCase() }).expect(200);
    expect(gate.body.valid).toBe(true);
    await request(env.app).post('/api/owner/bookings/verify').set(fx.owner.auth).send({ reference: 'KO-NOPE123' }).expect(404);
  });

  it('lets the customer resume payment on a held booking, until the hold expires', async () => {
    const c = await registerUser(env, 'customer'), other = await registerUser(env, 'customer');
    const { booking } = await startBooking(env, c, fx, ist(dateIn(6), '09:00'));
    const o = await request(env.app).get(`/api/bookings/${booking.body.bookingId}/order`).set(c.auth).expect(200);
    expect(o.body.order.id).toBe(booking.body.order.id);
    await request(env.app).get(`/api/bookings/${booking.body.bookingId}/order`).set(other.auth).expect(409);
    env.clock.offsetMs = 11 * 60000;
    try { await request(env.app).get(`/api/bookings/${booking.body.bookingId}/order`).set(c.auth).expect(409); } finally { env.clock.offsetMs = 0; }
  });

  it('rejects a forged signature and leaves the booking unpaid', async () => {
    const c = await registerUser(env, 'customer');
    const { booking } = await startBooking(env, c, fx, ist(dateIn(6), '12:00'));
    const res = await request(env.app).post(`/api/bookings/${booking.body.bookingId}/verify-payment`).set(c.auth)
      .send({ razorpay_order_id: booking.body.order.id, razorpay_payment_id: 'pay_forged', razorpay_signature: 'a'.repeat(64) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('bad_signature');
    expect((await env.db.query('SELECT status FROM bookings WHERE id=$1', [booking.body.bookingId])).rows[0].status).toBe('pending');
  });

  it("does not let one customer verify or read another customer's booking", async () => {
    const a = await registerUser(env, 'customer'), b = await registerUser(env, 'customer');
    const { booking } = await startBooking(env, a, fx, ist(dateIn(6), '14:00'));
    await request(env.app).get(`/api/bookings/${booking.body.bookingId}`).set(b.auth).expect(403);
    expect((await pay(env, b, booking.body.bookingId, booking.body.order.id)).status).toBe(404);
  });

  it('is idempotent when verification is called twice', async () => {
    const c = await registerUser(env, 'customer');
    const { booking } = await startBooking(env, c, fx, ist(dateIn(6), '15:00'));
    const first = await pay(env, c, booking.body.bookingId, booking.body.order.id, 'pay_same');
    const again = await pay(env, c, booking.body.bookingId, booking.body.order.id, 'pay_same');
    expect([first.status, again.status]).toEqual([200, 200]);
    const n = await env.db.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND type='booking_confirmed'`, [c.id]);
    expect(n.rows[0].n).toBe(1);
  });

  it('requires a verified email to book', async () => {
    const c = await registerUser(env, 'customer', { verified: false });
    const res = await lockReq(c, ist(dateIn(7), '10:00'));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('email_unverified');
  });

  it('rejects past times, off-grid starts, closed hours and bad durations', async () => {
    const c = await registerUser(env, 'customer');
    expect((await lockReq(c, ist(dateIn(-1), '10:00'))).status).toBe(400);
    expect((await lockReq(c, ist(dateIn(7), '10:30'))).status).toBe(400);
    expect((await lockReq(c, ist(dateIn(7), '03:00'))).status).toBe(400);
    expect((await lockReq(c, ist(dateIn(7), '22:00'), 120)).status).toBe(400);
    expect((await lockReq(c, ist(dateIn(7), '10:00'), 240)).status).toBe(400);
    expect((await lockReq(c, ist(dateIn(300), '10:00'))).status).toBe(400);
  });
});

describe('double-booking prevention', () => {
  it('a second customer cannot lock a held slot or an overlapping longer one, but adjacent slots are fine', async () => {
    const a = await registerUser(env, 'customer'), b = await registerUser(env, 'customer');
    const day = dateIn(8);
    expect((await lockReq(a, ist(day, '18:00'))).status).toBe(201);
    expect((await lockReq(b, ist(day, '18:00'))).status).toBe(409);
    expect((await lockReq(b, ist(day, '17:00'), 120)).status).toBe(409);
    expect((await lockReq(b, ist(day, '19:00'))).status).toBe(201); // [18,19) and [19,20) do not conflict
  });

  it('simultaneous lock attempts on one slot yield exactly one winner', async () => {
    const users = await Promise.all(Array.from({ length: 6 }, () => registerUser(env, 'customer')));
    const startsAt = ist(dateIn(9), '20:00');
    const results = await Promise.all(users.map((u) => lockReq(u, startsAt)));
    const codes = results.map((r) => r.status);
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(5);
  });

  it('the database itself rejects overlapping active bookings (constraint, not app logic)', async () => {
    const day = dateIn(11);
    const cust = await registerUser(env, 'customer');
    const insert = (s: string, e: string, status = 'confirmed') => env.db.query(
      `INSERT INTO bookings (reference, customer_id, venue_id, area_id, sport_id, during, status) VALUES ($1,$2,$3,$4,$5,tstzrange($6::timestamptz,$7::timestamptz,'[)'),$8)`,
      [`DB-${Math.random().toString(36).slice(2, 9)}`, cust.id, fx.venue.id, fx.area.id, fx.football.id, s, e, status]);
    await insert(ist(day, '10:00'), ist(day, '11:00'));
    await expect(insert(ist(day, '10:30'), ist(day, '11:30'))).rejects.toThrow(/bookings_no_overlap/);
    await insert(ist(day, '11:00'), ist(day, '12:00')); // touching ranges are fine
    await insert(ist(day, '10:00'), ist(day, '11:00'), 'cancelled'); // cancelled rows do not block
  });

  it('the database rejects overlapping slot locks too', async () => {
    const day = dateIn(11);
    const cust = await registerUser(env, 'customer');
    const insert = (s: string, e: string) => env.db.query(
      `INSERT INTO slot_locks (area_id, user_id, sport_id, during, expires_at) VALUES ($1,$2,$3,tstzrange($4::timestamptz,$5::timestamptz,'[)'), now() + interval '5 minutes')`,
      [fx.area.id, cust.id, fx.football.id, s, e]);
    await insert(ist(day, '17:00'), ist(day, '18:00'));
    await expect(insert(ist(day, '17:30'), ist(day, '18:30'))).rejects.toThrow(/slot_locks_no_overlap/);
  });

  it('expired holds release the slot and the late payer cannot create the booking', async () => {
    const a = await registerUser(env, 'customer'), b = await registerUser(env, 'customer');
    const startsAt = ist(dateIn(10), '09:00');
    const lock = await lockReq(a, startsAt).expect(201);
    env.clock.offsetMs = 11 * 60000; // past the 10-minute hold
    try {
      const mine = await request(env.app).post('/api/bookings').set(a.auth).send({ lockId: lock.body.lockId });
      expect(mine.status).toBe(410);
      expect(mine.body.error.code).toBe('lock_expired');
      expect((await lockReq(b, startsAt)).status).toBe(201);
    } finally { env.clock.offsetMs = 0; }
  });

  it('unpaid pending bookings auto-expire; late payment revives if free, else auto-refunds', async () => {
    const day = dateIn(12);
    const a = await registerUser(env, 'customer'), b = await registerUser(env, 'customer');
    const r1 = await startBooking(env, a, fx, ist(day, '08:00'));
    env.clock.offsetMs = 15 * 60000;
    try {
      await runMaintenance(env.ctx);
      expect((await env.db.query('SELECT status FROM bookings WHERE id=$1', [r1.booking.body.bookingId])).rows[0].status).toBe('expired');
      const late = await pay(env, a, r1.booking.body.bookingId, r1.booking.body.order.id);
      expect(late.body.status).toBe('confirmed'); // slot was still free -> revived

      env.clock.offsetMs = 0;
      const r2 = await startBooking(env, a, fx, ist(day, '13:00'));
      env.clock.offsetMs = 15 * 60000;
      await runMaintenance(env.ctx);
      const taker = await startBooking(env, b, fx, ist(day, '13:00'));
      expect(taker.booking.status).toBe(201);
      const refundsBefore = env.gatewayCalls.refunds.length;
      const late2 = await pay(env, a, r2.booking.body.bookingId, r2.booking.body.order.id);
      expect(late2.status).toBe(200);
      expect(late2.body.status).toBe('refunded');
      expect(env.gatewayCalls.refunds.length).toBe(refundsBefore + 1);
      expect(env.gatewayCalls.refunds.at(-1).amount).toBe(800);
      expect((await env.db.query('SELECT status FROM bookings WHERE id=$1', [taker.booking.body.bookingId])).rows[0].status).toBe('pending');
    } finally { env.clock.offsetMs = 0; }
  });

  it('owner blocks hide slots, and a block cannot overlap an existing booking', async () => {
    const day = dateIn(13);
    const c = await registerUser(env, 'customer');
    const bk = await startBooking(env, c, fx, ist(day, '16:00'));
    await pay(env, c, bk.booking.body.bookingId, bk.booking.body.order.id);
    await request(env.app).post(`/api/owner/areas/${fx.area.id}/blocks`).set(fx.owner.auth).send({ startsAt: ist(day, '15:30'), endsAt: ist(day, '16:30') }).expect(409);
    const blk = await request(env.app).post(`/api/owner/areas/${fx.area.id}/blocks`).set(fx.owner.auth).send({ startsAt: ist(day, '07:00'), endsAt: ist(day, '09:00'), reason: 'Maintenance' }).expect(201);
    const slots = await request(env.app).get(slotsUrl(day)).expect(200);
    expect(slots.body.slots.find((s: any) => s.startsAt === new Date(ist(day, '07:00')).toISOString()).reason).toBe('blocked');
    const other = await registerUser(env, 'customer');
    expect((await lockReq(other, ist(day, '08:00'))).status).toBe(409);
    await request(env.app).delete(`/api/owner/blocks/${blk.body.block.id}`).set(fx.owner.auth).expect(204);
    expect((await lockReq(other, ist(day, '08:00'))).status).toBe(201);
  });
});

describe('coupons', () => {
  it('applies percent discounts with caps, enforces per-user limits and releases on cancel', async () => {
    const c = await registerUser(env, 'customer');
    await request(env.app).post('/api/admin/coupons').set(admin.auth).send({
      code: 'WELCOME20', discountType: 'percent', value: 20, maxDiscount: 100, minAmount: 500, validTo: new Date(Date.now() + 30 * 86400000).toISOString(), perUserLimit: 1, usageLimit: 5,
    }).expect(201);
    const v = await request(env.app).post('/api/coupons/validate').set(c.auth).send({ code: 'welcome20', venueId: fx.venue.id, amount: 800 }).expect(200);
    expect(v.body.discount).toBe(100); // 20% of 800 = 160, capped at 100
    const r1 = await startBooking(env, c, fx, ist(dateIn(14), '10:00'), 60, 'WELCOME20');
    expect(r1.booking.body.total).toBe(700);
    const r2 = await startBooking(env, c, fx, ist(dateIn(14), '12:00'), 60, 'WELCOME20');
    expect(r2.booking.status).toBe(400);
    expect(r2.booking.body.error.code).toBe('coupon_used');
    expect((await env.db.query(`SELECT used_count FROM coupons WHERE code='WELCOME20'`)).rows[0].used_count).toBe(1);
    await request(env.app).post(`/api/bookings/${r1.booking.body.bookingId}/cancel`).set(c.auth).send({}).expect(200);
    expect((await env.db.query(`SELECT used_count FROM coupons WHERE code='WELCOME20'`)).rows[0].used_count).toBe(0);
    await request(env.app).post('/api/coupons/validate').set(c.auth).send({ code: 'NOPE123', venueId: fx.venue.id, amount: 800 }).expect(400);
  });

  it('a 100% coupon confirms immediately without a payment order', async () => {
    const c = await registerUser(env, 'customer');
    await request(env.app).post('/api/admin/coupons').set(admin.auth).send({ code: 'FREEGAME', discountType: 'percent', value: 100, validTo: new Date(Date.now() + 86400000 * 30).toISOString() }).expect(201);
    const r = await startBooking(env, c, fx, ist(dateIn(15), '10:00'), 60, 'FREEGAME');
    expect(r.booking.body.total).toBe(0);
    expect(r.booking.body.order).toBeNull();
    expect((await env.db.query('SELECT status FROM bookings WHERE id=$1', [r.booking.body.bookingId])).rows[0].status).toBe('confirmed');
  });
});

describe('cancellation & refunds', () => {
  it('full refund outside the cancellation window, processed through the gateway', async () => {
    const c = await registerUser(env, 'customer');
    const r = await startBooking(env, c, fx, ist(dateIn(20), '10:00'));
    await pay(env, c, r.booking.body.bookingId, r.booking.body.order.id);
    const res = await request(env.app).post(`/api/bookings/${r.booking.body.bookingId}/cancel`).set(c.auth).send({ reason: 'Plans changed' }).expect(200);
    expect(res.body.refundAmount).toBe(800);
    expect(res.body.refund.status).toBe('processed');
    const det = await request(env.app).get(`/api/bookings/${r.booking.body.bookingId}`).set(c.auth).expect(200);
    expect(det.body.booking.status).toBe('cancelled');
    expect(det.body.refunds[0].status).toBe('processed');
    expect(det.body.booking.payment_status).toBe('refunded');
    expect((await startBooking(env, await registerUser(env, 'customer'), fx, ist(dateIn(20), '10:00'))).booking.status).toBe(201); // slot is free again
    await request(env.app).post(`/api/bookings/${r.booking.body.bookingId}/cancel`).set(c.auth).send({}).expect(409);
  });

  it('no refund inside the 24h window; venue-initiated cancellation always refunds in full', async () => {
    const c1 = await registerUser(env, 'customer'), c2 = await registerUser(env, 'customer');
    const day = dateIn(25);
    const r1 = await startBooking(env, c1, fx, ist(day, '10:00'));
    const r2 = await startBooking(env, c2, fx, ist(day, '12:00'));
    await pay(env, c1, r1.booking.body.bookingId, r1.booking.body.order.id);
    await pay(env, c2, r2.booking.body.bookingId, r2.booking.body.order.id);
    env.clock.offsetMs = new Date(ist(day, '10:00')).getTime() - 3 * 3600000 - Date.now(); // "now" is 3h before the first game
    try {
      const late = await request(env.app).post(`/api/bookings/${r1.booking.body.bookingId}/cancel`).set(c1.auth).send({}).expect(200);
      expect(late.body.refundAmount).toBe(0);
      expect(late.body.refund).toBeNull();
      const byOwner = await request(env.app).post(`/api/owner/bookings/${r2.booking.body.bookingId}/cancel`).set(fx.owner.auth).send({ reason: 'Ground waterlogged' }).expect(200);
      expect(byOwner.body.refundAmount).toBe(800);
      expect(byOwner.body.refund.status).toBe('processed');
    } finally { env.clock.offsetMs = 0; }
  });

  it('a gateway refund failure is recorded as failed and can be retried by finance', async () => {
    const c = await registerUser(env, 'customer');
    const r = await startBooking(env, c, fx, ist(dateIn(21), '10:00'));
    await pay(env, c, r.booking.body.bookingId, r.booking.body.order.id);
    env.gatewayCalls.failRefund = true;
    const res = await request(env.app).post(`/api/bookings/${r.booking.body.bookingId}/cancel`).set(c.auth).send({}).expect(200);
    env.gatewayCalls.failRefund = false;
    expect(res.body.refund.status).toBe('failed');
    const fin = await createAdmin(env, 'finance');
    const retry = await request(env.app).post(`/api/admin/refunds/${res.body.refund.id}/retry`).set(fin.auth).expect(200);
    expect(retry.body.refund.status).toBe('processed');
  });

  it("another customer cannot cancel someone else's booking", async () => {
    const a = await registerUser(env, 'customer'), b = await registerUser(env, 'customer');
    const r = await startBooking(env, a, fx, ist(dateIn(22), '10:00'));
    await request(env.app).post(`/api/bookings/${r.booking.body.bookingId}/cancel`).set(b.auth).send({}).expect(403);
  });
});

describe('reviews', () => {
  it('only allows reviews for played bookings, once, and updates the venue rating', async () => {
    const c = await registerUser(env, 'customer');
    const r = await startBooking(env, c, fx, ist(dateIn(2), '10:00'));
    await pay(env, c, r.booking.body.bookingId, r.booking.body.order.id);
    await request(env.app).post('/api/me/reviews').set(c.auth).send({ bookingId: r.booking.body.bookingId, rating: 5 }).expect(409);
    env.clock.offsetMs = 4 * 86400000;
    try {
      await runMaintenance(env.ctx);
      await request(env.app).post('/api/me/reviews').set(c.auth).send({ bookingId: r.booking.body.bookingId, rating: 4, comment: 'Great pitch' }).expect(201);
      await request(env.app).post('/api/me/reviews').set(c.auth).send({ bookingId: r.booking.body.bookingId, rating: 5 }).expect(409);
    } finally { env.clock.offsetMs = 0; }
    const v = await request(env.app).get(`/api/venues/${fx.venue.id}`).expect(200);
    expect(Number(v.body.venue.rating_avg)).toBe(4);
    expect(v.body.venue.rating_count).toBe(1);
    const featured = await request(env.app).get('/api/reviews/featured').expect(200);
    expect(featured.body.reviews).toHaveLength(1);
    expect(featured.body.reviews[0]).toMatchObject({ comment: 'Great pitch', rating: 4, venue_name: 'Green Arena', author: 'Test c.' });
    expect(JSON.stringify(featured.body)).not.toContain(c.email); // no private data exposed
  });
});
