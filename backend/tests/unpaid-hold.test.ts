import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createAdmin, createApprovedVenue, dateIn, ist, registerUser, setup, startBooking, type TestEnv } from './helpers.js';

let env: TestEnv; let admin: Awaited<ReturnType<typeof createAdmin>>; let fx: Awaited<ReturnType<typeof createApprovedVenue>>;
beforeAll(async () => { env = await setup(); admin = await createAdmin(env); fx = await createApprovedVenue(env, admin); });
beforeEach(() => { env.clock.offsetMs = 0; });
const slot = async (c: any | null, day: number, hhmm: string) => {
  const req = request(env.app).get(`/api/areas/${fx.area.id}/slots`).query({ date: dateIn(day), sportId: fx.football.id, duration: 60 }); if (c) req.set(c.auth);
  const s = ((await req.expect(200)).body.slots as any[]).find((x) => new Date(x.startsAt).toISOString() === new Date(ist(dateIn(day), hhmm)).toISOString())!; return s;
};
const status = async (id: string) => (await env.db.query('SELECT status FROM bookings WHERE id=$1', [id])).rows[0].status;

describe('an unpaid booking holds the slot only for a while', () => {
  it('stays held for others, but is free again for the customer who started it, who can simply pick it again', async () => {
    const me = await registerUser(env, 'customer'); const other = await registerUser(env, 'customer');
    const first = await startBooking(env, me, fx, ist(dateIn(30), '10:00')); const id = first.booking.body.bookingId;
    expect(await status(id)).toBe('pending'); // started, never paid
    expect((await slot(other, 30, '10:00')).available).toBe(false);   // held for everyone else
    expect((await slot(other, 30, '10:00')).reason).toBe('held');
    expect((await slot(me, 30, '10:00')).available).toBe(true);       // but not blocked for me
    const again = await startBooking(env, me, fx, ist(dateIn(30), '10:00')); // pick it again: the old unpaid hold is replaced
    expect(await status(id)).toBe('expired'); expect(await status(again.booking.body.bookingId)).toBe('pending');
  });

  it('is free for everyone as soon as the hold has run out, even before the clean-up job runs', async () => {
    const me = await registerUser(env, 'customer'); const other = await registerUser(env, 'customer');
    const first = await startBooking(env, me, fx, ist(dateIn(31), '10:00')); const id = first.booking.body.bookingId;
    expect((await slot(other, 31, '10:00')).available).toBe(false);
    env.clock.offsetMs = 11 * 60_000; // past the 10 minute hold; no maintenance run
    expect(await status(id)).toBe('pending');
    expect((await slot(other, 31, '10:00')).available).toBe(true);
    const taken = await startBooking(env, other, fx, ist(dateIn(31), '10:00'));
    expect(await status(id)).toBe('expired'); expect(await status(taken.booking.body.bookingId)).toBe('pending');
  });
});
