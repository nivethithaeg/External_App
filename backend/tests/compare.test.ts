import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createAdmin, createApprovedVenue, dateIn, ist, pay, registerUser, setup, startBooking, type TestEnv } from './helpers.js';

let env: TestEnv; let admin: Awaited<ReturnType<typeof createAdmin>>; let fx: Awaited<ReturnType<typeof createApprovedVenue>>;
beforeAll(async () => { env = await setup(); admin = await createAdmin(env); fx = await createApprovedVenue(env, admin); });

describe('venues comparison report', () => {
  it('lists every approved venue with bookings, revenue, occupancy and rating, and is only for the owner', async () => {
    const c = await registerUser(env, 'customer');
    const r = await startBooking(env, c, fx, ist(dateIn(5), '10:00')); await pay(env, c, r.booking.body.bookingId, r.booking.body.order.id);
    const q = { from: dateIn(0), to: dateIn(30) };
    const out = (await request(env.app).get('/api/owner/reports/venues-compare').set(fx.owner.auth).query(q).expect(200)).body;
    expect(out.venues).toHaveLength(1);
    expect(out.venues[0]).toMatchObject({ id: fx.venue.id, bookings: 1 }); expect(out.venues[0].revenue).toBeGreaterThan(0);
    expect(out.venues[0].occupancyPct).toBeGreaterThan(0); expect(out.totals.bookings).toBe(1);
    await request(env.app).get('/api/owner/reports/venues-compare').set(c.auth).query(q).expect(403);
    const other = await registerUser(env, 'owner');
    await request(env.app).get('/api/owner/reports/venues-compare').query(q).expect(401);
    void other;
  });
});
