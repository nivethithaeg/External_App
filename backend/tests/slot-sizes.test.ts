import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createAdmin, createApprovedVenue, dateIn, ist, setup, type TestEnv } from './helpers.js';

let env: TestEnv; let admin: Awaited<ReturnType<typeof createAdmin>>; let fx: Awaited<ReturnType<typeof createApprovedVenue>>;
beforeAll(async () => { env = await setup(); admin = await createAdmin(env); fx = await createApprovedVenue(env, admin); });
const mk = (body: object) => request(env.app).post(`/api/owner/venues/${fx.venue.id}/areas`).set(fx.owner.auth).send({ name: 'Area', sportIds: [fx.football.id], ...body });

describe('slot sizes from 30 minutes to 5 hours', () => {
  it('accepts 30 min, 1, 2, 3, 4 and 5 hours, and nothing else', async () => {
    for (const m of [30, 60, 120, 180, 240, 300]) await mk({ name: `A${m}`, slotMinutes: m, minDurationMinutes: m, maxDurationMinutes: 300 }).expect(201);
    await mk({ slotMinutes: 90 }).expect(400); await mk({ slotMinutes: 360 }).expect(400);
    await mk({ slotMinutes: 60, maxDurationMinutes: 360 }).expect(400); // never longer than 5 hours
  });

  it('a 2-hour area offers 2-hour slots and only 2, 4-hour bookings', async () => {
    const area = (await mk({ name: 'Two hour', slotMinutes: 120, minDurationMinutes: 120, maxDurationMinutes: 300 }).expect(201)).body.area;
    await env.db.query(`UPDATE playing_areas SET approval_status='approved' WHERE id=$1`, [area.id]);
    await request(env.app).put(`/api/owner/areas/${area.id}/pricing`).set(fx.owner.auth).send({ rules: [{ startTime: '06:00', endTime: '23:00', pricePerHour: 500 }] }).expect(204);
    await request(env.app).put(`/api/owner/areas/${area.id}/availability`).set(fx.owner.auth).send({ days: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, openTime: '06:00', closeTime: '22:00' })) }).expect(204);
    const slots = (await request(env.app).get(`/api/areas/${area.id}/slots`).query({ date: dateIn(10), sportId: fx.football.id, duration: 120 }).expect(200)).body.slots as any[];
    expect(slots.slice(0, 3).map((s) => new Date(s.startsAt).toISOString())).toEqual([ist(dateIn(10), '06:00'), ist(dateIn(10), '08:00'), ist(dateIn(10), '10:00')].map((x) => new Date(x).toISOString()));
    expect(slots[0].price).toBe(1000); // 2 hours at ₹500 an hour
    await request(env.app).get(`/api/areas/${area.id}/slots`).query({ date: dateIn(10), sportId: fx.football.id, duration: 60 }).expect(400); // not a multiple of the slot size
    expect((await request(env.app).get(`/api/areas/${area.id}/slots`).query({ date: dateIn(10), sportId: fx.football.id, duration: 240 }).expect(200)).body.slots.length).toBeGreaterThan(0);
  });
});
