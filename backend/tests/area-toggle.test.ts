import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createAdmin, createApprovedVenue, registerUser, setup, type TestEnv } from './helpers.js';

let env: TestEnv; let admin: Awaited<ReturnType<typeof createAdmin>>; let fx: Awaited<ReturnType<typeof createApprovedVenue>>;
beforeAll(async () => { env = await setup(); admin = await createAdmin(env); fx = await createApprovedVenue(env, admin); });

const setActive = (isActive: boolean, who = fx.owner, areaId = fx.area.id) => request(env.app).put(`/api/owner/areas/${areaId}`).set(who.auth).send({ isActive });
const publicAreas = async () => (await request(env.app).get(`/api/venues/${fx.venue.id}`).expect(200)).body.venue.areas as any[];

describe('deactivating a playing area', () => {
  it('hides it from customers and stops new bookings, and activating brings it back', async () => {
    expect((await publicAreas()).some((a) => a.id === fx.area.id)).toBe(true);
    const c = await registerUser(env, 'customer');
    const body = { areaId: fx.area.id, sportId: fx.football.id, startsAt: new Date(Date.now() + 2 * 86400000).toISOString(), durationMinutes: 60 };

    expect((await setActive(false).expect(200)).body.area.is_active).toBe(false);
    expect((await publicAreas()).some((a) => a.id === fx.area.id)).toBe(false); // gone from the venue page
    const lock = await request(env.app).post('/api/slots/lock').set(c.auth).send(body).expect(409);
    expect(lock.body.error.code).toBe('area_unavailable'); // and cannot be booked even by someone who kept the page open
    expect((await request(env.app).get(`/api/areas/${fx.area.id}/slots`).query({ date: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10), sportId: fx.football.id, duration: 60 })).status).toBe(409);

    expect((await setActive(true).expect(200)).body.area.is_active).toBe(true);
    expect((await publicAreas()).some((a) => a.id === fx.area.id)).toBe(true);
  });

  it('does not touch bookings that were already made', async () => {
    const o = await registerUser(env, 'owner'); const g = await createApprovedVenue(env, admin, o);
    await env.db.query(`INSERT INTO bookings (reference, customer_id, venue_id, area_id, sport_id, during, status, subtotal, discount, total, owner_amount)
      SELECT 'KO-TOGGLE1', (SELECT id FROM users WHERE role='customer' LIMIT 1), $1, $2, $3, tstzrange(now() + interval '3 days', now() + interval '3 days 1 hour'), 'confirmed', 800, 0, 800, 720`, [g.venue.id, g.area.id, g.football.id]);
    await setActive(false, o, g.area.id).expect(409); // the owner must choose what happens to the upcoming booking
    await request(env.app).put(`/api/owner/areas/${g.area.id}`).set(o.auth).send({ isActive: false, bookings: 'keep' }).expect(200);
    expect((await env.db.query(`SELECT status FROM bookings WHERE reference='KO-TOGGLE1'`)).rows[0].status).toBe('confirmed');
  });

  it('only the owner of that area can switch it', async () => {
    const other = await registerUser(env, 'owner'); const c = await registerUser(env, 'customer');
    await setActive(false, other).expect(403);
    await setActive(false, c).expect(403);
    await request(env.app).put(`/api/owner/areas/${fx.area.id}`).send({ isActive: false }).expect(401);
    expect((await publicAreas()).some((a) => a.id === fx.area.id)).toBe(true);
  });
});
