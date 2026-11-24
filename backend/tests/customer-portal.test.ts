import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createAdmin, createApprovedVenue, dateIn, ist, pay, registerUser, setup, startBooking, type TestEnv } from './helpers.js';

let env: TestEnv; let fx: Awaited<ReturnType<typeof createApprovedVenue>>; let admin: Awaited<ReturnType<typeof createAdmin>>;
beforeAll(async () => { env = await setup(); admin = await createAdmin(env); fx = await createApprovedVenue(env, admin); });

async function paidBooking(c: { auth: any }, hhmm: string, day = 5) {
  const { booking } = await startBooking(env, c, fx, ist(dateIn(day), hhmm));
  await pay(env, c, booking.body.bookingId, booking.body.order.id).then((r) => expect(r.status).toBe(200));
  return booking.body.bookingId as string;
}

describe('offers', () => {
  it('lists active coupons publicly and expired ones on request, with the customer\'s own usage', async () => {
    await env.db.query(`INSERT INTO coupons (code, description, discount_type, value, min_amount, valid_from, valid_to) VALUES ('WELCOME10','10% off','percent',10,0, now() - interval '1 day', now() + interval '10 days')`);
    await env.db.query(`INSERT INTO coupons (code, description, discount_type, value, min_amount, valid_from, valid_to) VALUES ('OLD5','old','flat',5,0, now() - interval '20 days', now() - interval '2 days')`);
    const open = (await request(env.app).get('/api/offers')).body.offers.map((o: any) => o.code);
    expect(open).toContain('WELCOME10'); expect(open).not.toContain('OLD5');
    expect((await request(env.app).get('/api/offers').query({ expired: '1' })).body.offers.map((o: any) => o.code)).toContain('OLD5');
  });
});

describe('payments and reviews', () => {
  it('shows only the customer\'s own payments, passes and reviewable bookings', async () => {
    const a = await registerUser(env, 'customer'); const b = await registerUser(env, 'customer');
    const id = await paidBooking(a, '10:00');
    const pays = (await request(env.app).get('/api/me/payments').set(a.auth)).body;
    expect(pays.payments).toHaveLength(1); expect(pays.summary).toMatchObject({ successful: 1, failed: 0 }); expect(pays.summary.paid_total).toBeGreaterThan(0);
    expect((await request(env.app).get('/api/me/payments').set(b.auth)).body.payments).toHaveLength(0); // not someone else's
    expect((await request(env.app).get('/api/me/passes').set(a.auth)).status).toBe(404); // the QR pass feature is gone
    expect((await request(env.app).get('/api/me/payments')).status).toBe(401);
  });

  it('reviews: only after the game, with category ratings; editable and deletable by the author only', async () => {
    const a = await registerUser(env, 'customer'); const b = await registerUser(env, 'customer');
    const id = await paidBooking(a, '12:00', 6);
    expect((await request(env.app).post('/api/me/reviews').set(a.auth).send({ bookingId: id, rating: 5 })).status).toBe(409); // not played yet
    await env.db.query(`UPDATE bookings SET status='completed' WHERE id=$1`, [id]);
    expect((await request(env.app).get('/api/me/reviews').set(a.auth)).body.toReview.map((x: any) => x.booking_id)).toContain(id);
    const made = await request(env.app).post('/api/me/reviews').set(a.auth).send({ bookingId: id, rating: 4, comment: 'Great turf', groundRating: 5, cleanlinessRating: 4, facilitiesRating: 4, staffRating: 3 });
    expect(made.status).toBe(201);
    const mine = (await request(env.app).get('/api/me/reviews').set(a.auth)).body;
    expect(mine.reviews[0]).toMatchObject({ rating: 4, ground_rating: 5, staff_rating: 3 }); expect(mine.toReview.map((x: any) => x.booking_id)).not.toContain(id);
    const rid = made.body.review.id;
    expect((await request(env.app).put(`/api/reviews/${rid}`).set(b.auth).send({ rating: 1 })).status).toBe(403);
    expect((await request(env.app).delete(`/api/reviews/${rid}`).set(b.auth)).status).toBe(403);
    await request(env.app).put(`/api/reviews/${rid}`).set(a.auth).send({ rating: 2, comment: 'Changed my mind' }).expect(200);
    expect((await env.db.query('SELECT rating_avg FROM venues WHERE id=$1', [fx.venue.id])).rows[0].rating_avg).toBe(2);
    await request(env.app).delete(`/api/reviews/${rid}`).set(a.auth).expect(204);
    expect((await request(env.app).get('/api/me/reviews').set(a.auth)).body.reviews).toHaveLength(0);
  });
});

describe('login history and booking filters', () => {
  it('lists recent sign-ins of the signed-in user only', async () => {
    const u = await registerUser(env, 'customer');
    await request(env.app).post('/api/auth/login').send({ email: u.email, password: 'Passw0rd!x' });
    const res = await request(env.app).get('/api/me/login-history').set(u.auth);
    expect(res.status).toBe(200); expect(Array.isArray(res.body.history)).toBe(true);
    expect((await request(env.app).get('/api/me/login-history')).status).toBe(401);
  });

  it('my bookings: completed / cancelled tabs and date, venue and payment filters', async () => {
    const c = await registerUser(env, 'customer');
    const done = await paidBooking(c, '15:00', 7); const gone = await paidBooking(c, '16:00', 7);
    await env.db.query(`UPDATE bookings SET status='completed' WHERE id=$1`, [done]);
    await env.db.query(`UPDATE bookings SET status='cancelled' WHERE id=$1`, [gone]);
    const ids = async (q: object) => (await request(env.app).get('/api/bookings').query(q).set(c.auth)).body.bookings.map((b: any) => b.id);
    expect(await ids({ tab: 'completed' })).toEqual([done]); expect(await ids({ tab: 'cancelled' })).toEqual([gone]);
    expect((await ids({ venueId: fx.venue.id })).sort()).toEqual([done, gone].sort());
    expect(await ids({ from: dateIn(30), to: dateIn(31) })).toEqual([]);
    expect(await ids({ payment: 'failed' })).toEqual([]);
  });
});

describe('venue search', () => {
  it('filters by facility and category and sorts by popularity; rows carry facilities', async () => {
    const facs = (await request(env.app).get('/api/facilities')).body.facilities as { id: number; name: string }[];
    await env.db.query(`UPDATE venues SET category='Football turf' WHERE id=$1`, [fx.venue.id]);
    await env.db.query(`INSERT INTO venue_facilities (venue_id, facility_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [fx.venue.id, facs[0].id]);
    const hit = (await request(env.app).get('/api/venues').query({ facilities: String(facs[0].id), category: 'Football turf', sort: 'popular' })).body.venues;
    expect(hit.map((v: any) => v.id)).toContain(fx.venue.id); expect(hit.find((v: any) => v.id === fx.venue.id).facilities).toContain(facs[0].name);
    expect((await request(env.app).get('/api/venues').query({ category: 'Nope' })).body.venues).toHaveLength(0);
  });

  it('filters by state', async () => {
    await env.db.query(`UPDATE venues SET state='Karnataka' WHERE id=$1`, [fx.venue.id]);
    expect((await request(env.app).get('/api/venues').query({ state: 'karnataka' })).body.venues.map((v: any) => v.id)).toContain(fx.venue.id);
    expect((await request(env.app).get('/api/venues').query({ state: 'Kerala' })).body.venues.map((v: any) => v.id)).not.toContain(fx.venue.id);
  });
});
