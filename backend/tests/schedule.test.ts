import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { rateAt, type PriceRule } from '../src/lib/pricing.js';
import { createAdmin, createApprovedVenue, registerUser, setup, type TestEnv } from './helpers.js';

const rule = (o: Partial<PriceRule>): PriceRule => ({ sport_id: null, day_type: 'all', day_of_week: null, start_time: '06:00', end_time: '23:00', price_per_hour: 100, ...o });

describe('price rules for one day of the week', () => {
  it('a rule for one weekday beats weekday/weekend and "every day"; a sport rule still beats them all', () => {
    const rules = [rule({ price_per_hour: 100 }), rule({ day_type: 'weekday', price_per_hour: 200 }), rule({ day_of_week: 1, price_per_hour: 300 }), rule({ sport_id: 5, day_of_week: null, price_per_hour: 400 })];
    expect(rateAt(rules, 1, 9, 600)).toBe(300); // Monday: the Monday rule
    expect(rateAt(rules, 2, 9, 600)).toBe(200); // Tuesday: weekday rule
    expect(rateAt(rules, 0, 9, 600)).toBe(100); // Sunday: every-day rule
    expect(rateAt(rules, 1, 5, 600)).toBe(400); // the sport-specific rule wins even on Monday
  });
  it('only applies on its own day and inside its own time window', () => {
    const rules = [rule({ day_of_week: 3, start_time: '09:00', end_time: '10:00', price_per_hour: 500 })];
    expect(rateAt(rules, 3, 1, 9 * 60 + 30)).toBe(500);
    expect(rateAt(rules, 3, 1, 10 * 60)).toBeNull(); expect(rateAt(rules, 4, 1, 9 * 60 + 30)).toBeNull();
  });
});

let env: TestEnv; let admin: Awaited<ReturnType<typeof createAdmin>>; let fx: Awaited<ReturnType<typeof createApprovedVenue>>;
beforeAll(async () => { env = await setup(); admin = await createAdmin(env); fx = await createApprovedVenue(env, admin); });

const nextDay = (dow: number) => { const d = new Date(Date.now() + 3 * 86400000); while (d.getUTCDay() !== dow) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
const day = (dayOfWeek: number, o = '06:00', c = '10:00', isClosed = false) => ({ dayOfWeek, openTime: o, closeTime: c, isClosed });
const allDays = (o = '06:00', c = '10:00') => Array.from({ length: 7 }, (_, d) => day(d, o, c));
const put = (body: any, who = fx.owner, areaId = fx.area.id) => request(env.app).put(`/api/owner/areas/${areaId}/schedule`).set(who.auth).send(body);
const slots = async (date: string) => (await request(env.app).get(`/api/areas/${fx.area.id}/slots`).query({ date, sportId: fx.football.id, duration: 60 }).expect(200)).body.slots as any[];

describe('saving opening hours and slot prices together', () => {
  it('shows exactly the slots between opening and closing, each with the price set for that day', async () => {
    await put({ days: allDays('06:00', '10:00'), rules: [
      { sportId: null, dayOfWeek: 1, startTime: '06:00', endTime: '08:00', pricePerHour: 500 }, { sportId: null, dayOfWeek: 1, startTime: '08:00', endTime: '10:00', pricePerHour: 700 },
      { sportId: null, dayOfWeek: 2, startTime: '06:00', endTime: '10:00', pricePerHour: 900 }] }).expect(204);
    const mon = await slots(nextDay(1));
    expect(mon.map((s: any) => s.price)).toEqual([500, 500, 700, 700]); // 4 one-hour slots, 6am to 10am, priced individually
    expect(new Date(mon[0].startsAt).toISOString()).toBe(new Date(`${nextDay(1)}T06:00:00+05:30`).toISOString());
    expect((await slots(nextDay(2))).map((s: any) => s.price)).toEqual([900, 900, 900, 900]); // Tuesday has its own price
  });

  it('a day with no price rule shows its slots as unpriced instead of guessing a price', async () => {
    await put({ days: allDays(), rules: [{ sportId: null, dayOfWeek: 1, startTime: '06:00', endTime: '10:00', pricePerHour: 500 }] }).expect(204);
    const wed = await slots(nextDay(3));
    expect(wed).toHaveLength(4); expect(wed.every((s: any) => s.price === null && s.available === false && s.reason === 'unpriced')).toBe(true);
  });

  it('a closed day has no slots, and changing the hours changes the slots', async () => {
    await put({ days: [...allDays().filter((d) => d.dayOfWeek !== 4), day(4, '06:00', '10:00', true)], rules: [{ sportId: null, startTime: '06:00', endTime: '10:00', pricePerHour: 500 }] }).expect(204);
    expect(await slots(nextDay(4))).toHaveLength(0);
    await put({ days: allDays('07:00', '09:00'), rules: [{ sportId: null, startTime: '06:00', endTime: '10:00', pricePerHour: 500 }] }).expect(204);
    expect((await slots(nextDay(1))).length).toBe(2);
  });

  it('is all-or-nothing: a bad price rule leaves the old hours and prices untouched', async () => {
    await put({ days: allDays('06:00', '10:00'), rules: [{ sportId: null, startTime: '06:00', endTime: '10:00', pricePerHour: 500 }] }).expect(204);
    await put({ days: allDays('08:00', '12:00'), rules: [{ sportId: null, startTime: '10:00', endTime: '09:00', pricePerHour: 500 }] }).expect(400); // end before start
    expect((await slots(nextDay(1))).map((s: any) => s.price)).toEqual([500, 500, 500, 500]); // still 6 to 10
    await put({ days: allDays(), rules: [{ sportId: null, dayOfWeek: 1, dayType: 'weekday', startTime: '06:00', endTime: '10:00', pricePerHour: 500 }] }).expect(400); // a day rule cannot also be "weekday"
    await put({ days: [day(1), day(1)], rules: [] }).expect(400); // duplicate day
  });

  it('only the area\'s owner can save it', async () => {
    const other = await registerUser(env, 'owner'); const c = await registerUser(env, 'customer');
    await put({ days: allDays(), rules: [] }, other).expect(403);
    await put({ days: allDays(), rules: [] }, c).expect(403);
    await request(env.app).put(`/api/owner/areas/${fx.area.id}/schedule`).send({ days: allDays(), rules: [] }).expect(401);
  });

  it('the owner and customer views carry the day of the week on each rule', async () => {
    await put({ days: allDays(), rules: [{ sportId: null, dayOfWeek: 5, startTime: '06:00', endTime: '10:00', pricePerHour: 650 }] }).expect(204);
    const detail = (await request(env.app).get(`/api/owner/venues/${fx.venue.id}`).set(fx.owner.auth).expect(200)).body.venue;
    expect(detail.areas.find((a: any) => a.id === fx.area.id).pricing[0]).toMatchObject({ dayOfWeek: 5, pricePerHour: 650, startTime: '06:00' });
    const pub = (await request(env.app).get(`/api/venues/${fx.venue.id}`).expect(200)).body.venue;
    expect(pub.areas.find((a: any) => a.id === fx.area.id).pricing[0]).toMatchObject({ day_of_week: 5 });
  });
});
