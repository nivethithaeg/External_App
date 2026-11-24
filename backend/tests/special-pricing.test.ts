import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { approveOwner, createAdmin, createApprovedVenue, dateIn, ist, pay, registerUser, setup, startBooking, type TestEnv } from './helpers.js';

let env: TestEnv; let admin: Awaited<ReturnType<typeof createAdmin>>; let fx: Awaited<ReturnType<typeof createApprovedVenue>>;
beforeAll(async () => { env = await setup(); admin = await createAdmin(env); fx = await createApprovedVenue(env, admin); });
const url = `/api/owner/venues`;
const add = (b: object, who: any = fx.owner) => request(env.app).post(`${url}/${fx.venue.id}/price-adjustments`).set(who.auth).send(b);
const slotsOn = async (day: number) => (await request(env.app).get(`/api/areas/${fx.area.id}/slots`).query({ date: dateIn(day), sportId: fx.football.id, duration: 60 }).expect(200)).body;
const priceAt = (body: any, day: number, hhmm: string) => body.slots.find((s: any) => new Date(s.startsAt).toISOString() === new Date(ist(dateIn(day), hhmm)).toISOString()).price;

describe('holiday and special-date pricing', () => {
  it('raises (or lowers) every slot on the chosen dates, and shows customers why', async () => {
    expect(priceAt(await slotsOn(40), 40, '10:00')).toBe(800); // normal price
    const made = await add({ label: 'Festival weekend', startDate: dateIn(40), endDate: dateIn(41), percent: 25 }).expect(201);
    expect(made.body.adjustment).toMatchObject({ label: 'Festival weekend', percent: 25 });
    const on = await slotsOn(40);
    expect(on.specialPricing).toEqual({ label: 'Festival weekend', percent: 25 });
    expect(priceAt(on, 40, '10:00')).toBe(1000); expect(priceAt(on, 40, '18:00')).toBe(1500); // morning 800 and evening 1200, both +25%
    expect(priceAt(await slotsOn(41), 41, '10:00')).toBe(1000);
    const off = await slotsOn(42); expect(off.specialPricing).toBeNull(); expect(priceAt(off, 42, '10:00')).toBe(800); // the day after is normal
  });

  it('is what the customer is actually charged, and works together with the venue discount', async () => {
    await request(env.app).put(`${url}/${fx.venue.id}/discount`).set(fx.owner.auth).send({ percent: 10 }).expect(200);
    const c = await registerUser(env, 'customer');
    const r = await startBooking(env, c, fx, ist(dateIn(40), '10:00'));
    expect(r.booking.status).toBe(201); // 1000 on the festival date, minus the venue's 10%
    const row = (await env.db.query('SELECT subtotal, venue_discount, total FROM bookings WHERE id=$1', [r.booking.body.bookingId])).rows[0];
    expect([Number(row.subtotal), Number(row.venue_discount), Number(row.total)]).toEqual([1000, 100, 900]);
    await request(env.app).put(`${url}/${fx.venue.id}/discount`).set(fx.owner.auth).send({ percent: 0 }).expect(200);
  });

  it('can be a reduction, is checked, cannot overlap, and can be removed', async () => {
    await add({ label: 'Off season', startDate: dateIn(50), endDate: dateIn(52), percent: -20 }).expect(201);
    expect(priceAt(await slotsOn(51), 51, '10:00')).toBe(640);
    for (const bad of [{ percent: 0 }, { percent: 201 }, { percent: -51 }, { label: 'x' }, { endDate: dateIn(30) }, { endDate: dateIn(100) }]) await add({ label: 'Test', startDate: dateIn(60), endDate: dateIn(61), percent: 10, ...bad }).expect(400);
    expect((await add({ label: 'Clash', startDate: dateIn(52), endDate: dateIn(53), percent: 10 }).expect(409)).body.error.code).toBe('overlap');
    const list = (await request(env.app).get(`${url}/${fx.venue.id}/price-adjustments`).set(fx.owner.auth).expect(200)).body.adjustments as any[];
    const off = list.find((a) => a.label === 'Off season')!;
    await request(env.app).delete(`${url}/${fx.venue.id}/price-adjustments/${off.id}`).set(fx.owner.auth).expect(204);
    expect(priceAt(await slotsOn(51), 51, '10:00')).toBe(800); // back to normal
    await request(env.app).delete(`${url}/${fx.venue.id}/price-adjustments/${off.id}`).set(fx.owner.auth).expect(404);
  });

  it('belongs to the venue\'s own owner', async () => {
    const other = await registerUser(env, 'owner'); await approveOwner(env, admin, other);
    await add({ label: 'Mine now', startDate: dateIn(70), endDate: dateIn(71), percent: 10 }, other).expect(403);
    await request(env.app).get(`${url}/${fx.venue.id}/price-adjustments`).set(other.auth).expect(403);
    await request(env.app).get(`${url}/${fx.venue.id}/price-adjustments`).set((await registerUser(env, 'customer')).auth).expect(403);
  });
});
